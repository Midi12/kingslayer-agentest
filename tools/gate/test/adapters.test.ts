import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  CommandToolVersions,
  ConsoleOutput,
  GitSourceControl,
  NodeFileSystem,
  NodeProcessRunner,
  ShellRequirementProbe,
  SystemClock,
  YamlDocumentLoader,
  findRepositoryRoot,
  loadDepcruiseExcludes,
} from '../src/index.js';

const scratch = mkdtempSync(join(tmpdir(), 'argus-adapters-'));
// The whole environment: pnpm may run through corepack, which needs COREPACK_HOME.
const env = { ...process.env };
const processes = new NodeProcessRunner();

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('NodeProcessRunner', () => {
  it('captures exit codes and a tail of combined output', async () => {
    const lines: string[] = [];
    const result = await processes.run({
      argv: [
        'bash',
        '-c',
        'for i in 1 2 3 4 5; do echo out$i; done; echo err >&2; printf partial; exit 7',
      ],
      cwd: scratch,
      env,
      timeoutMs: 10_000,
      tailLines: 3,
      onLine: (line) => lines.push(line),
    });
    expect(result).toMatchObject({ exitCode: 7, signal: null, timedOut: false, totalLines: 7 });
    expect(result.tail).toHaveLength(3);
    expect(result.tail).toContain('partial');
    expect(lines).toContain('err');
    expect(lines).toHaveLength(7);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('kills the whole process group on timeout', async () => {
    const marker = join(scratch, 'survived');
    const result = await processes.run({
      argv: ['bash', '-c', `(sleep 3; touch ${marker}) & sleep 30`],
      cwd: scratch,
      env,
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe('SIGTERM');
    await new Promise((done) => setTimeout(done, 3500));
    expect(() => readFileSync(marker)).toThrow();
  }, 15_000);

  it('reports programs that cannot start', async () => {
    const result = await processes.run({
      argv: ['definitely-not-a-program-argus'],
      cwd: scratch,
      env,
      timeoutMs: 5000,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.spawnError).toMatch(/ENOENT/);
    const empty = await processes.run({ argv: [], cwd: scratch, env, timeoutMs: 5000 });
    expect(empty).toMatchObject({ exitCode: null, spawnError: 'empty command' });
  });
});

describe('NodeFileSystem', () => {
  const fs = new NodeFileSystem();

  it('reads, writes, lists and walks', async () => {
    const dir = join(scratch, 'fs');
    await fs.writeText(join(dir, 'b', 'c.txt'), 'c');
    await fs.writeText(join(dir, 'a.txt'), 'a');
    await fs.writeText(join(dir, 'node_modules', 'x.txt'), 'x');
    expect(await fs.readText(join(dir, 'a.txt'))).toBe('a');
    expect(await fs.readTextIfExists(join(dir, 'missing'))).toBeNull();
    await expect(fs.readTextIfExists(dir)).rejects.toThrow();
    expect(await fs.exists(join(dir, 'a.txt'))).toBe(true);
    expect(await fs.exists(join(dir, 'nope'))).toBe(false);
    expect(await fs.isDirectory(dir)).toBe(true);
    expect(await fs.isDirectory(join(dir, 'a.txt'))).toBe(false);
    expect(await fs.isDirectory(join(dir, 'nope'))).toBe(false);
    expect(await fs.list(dir)).toEqual(['a.txt', 'b', 'node_modules']);
    expect(await fs.walk(dir, ['node_modules'])).toEqual([
      join(dir, 'a.txt'),
      join(dir, 'b', 'c.txt'),
    ]);
    await fs.mkdirp(join(dir, 'deep', 'er'));
    const temp = await fs.makeTempDir('argus-fs-');
    expect(await fs.isDirectory(temp)).toBe(true);
    await fs.remove(temp);
    expect(await fs.exists(temp)).toBe(false);
  });
});

describe('YamlDocumentLoader', () => {
  const loader = new YamlDocumentLoader();

  it('parses YAML and reports unreadable or invalid files', async () => {
    const file = join(scratch, 'doc.yaml');
    writeFileSync(file, 'a: 1\nb: [x]\n');
    expect(await loader.loadYaml(file)).toEqual({ ok: true, value: { a: 1, b: ['x'] } });
    writeFileSync(file, 'a: 1\na: 2\n');
    expect(await loader.loadYaml(file)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/invalid YAML/) as unknown,
    });
    expect(await loader.loadYaml(join(scratch, 'none.yaml'))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/cannot read/) as unknown,
    });
  });
});

describe('system adapters', () => {
  it('reads the clock and writes to the console', () => {
    expect(new SystemClock().now()).toBeInstanceOf(Date);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const console = new ConsoleOutput();
    console.info('hello');
    console.error('oops');
    expect(out).toHaveBeenCalledWith('hello\n');
    expect(err).toHaveBeenCalledWith('oops\n');
    out.mockRestore();
    err.mockRestore();
  });

  it('reads the commit and the working tree state', async () => {
    const repo = join(scratch, 'repo');
    mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-C', repo, '-c', 'user.name=T', '-c', 'user.email=t@test.invalid', ...args],
        { encoding: 'utf8' },
      );
    git('init', '-q');
    writeFileSync(join(repo, 'a'), 'a');
    git('add', '-A');
    git('commit', '-q', '-m', 'chore: a');
    const source = new GitSourceControl(processes, env);
    expect(await source.shortCommit(repo)).toBe(git('rev-parse', '--short', 'HEAD').trim());
    expect(await source.isClean(repo)).toBe(true);
    writeFileSync(join(repo, 'b'), 'b');
    expect(await source.isClean(repo)).toBe(false);
    const outside = mkdtempSync(join(tmpdir(), 'argus-nogit-'));
    expect(await source.shortCommit(outside)).toBeNull();
    expect(await source.isClean(outside)).toBeNull();
    writeFileSync(join(repo, '.gitignore'), 'logs/\n');
    expect(await source.isIgnored(repo, join(repo, 'logs', 'M00'))).toBe(true);
    expect(await source.isIgnored(repo, 'logs/M00/M00-G1.log')).toBe(true);
    expect(await source.isIgnored(repo, join(repo, 'a'))).toBe(false);
    expect(await source.isIgnored(repo, join(outside, 'x'))).toBeNull();
    expect(await source.isIgnored(outside, 'x')).toBeNull();
    rmSync(outside, { recursive: true, force: true });
  });

  it('probes environment variables and tools', async () => {
    const probe = new ShellRequirementProbe(processes, { ...env, SET: 'x', EMPTY: '' }, scratch);
    expect(probe.hasEnv('SET')).toBe(true);
    expect(probe.hasEnv('EMPTY')).toBe(false);
    expect(probe.hasEnv('UNSET')).toBe(false);
    expect(await probe.toolProblem('bash')).toBeUndefined();
    expect(await probe.toolProblem('no-such-tool-argus')).toBe('not on PATH');
    const unreachable = new ShellRequirementProbe(
      processes,
      { ...env, DOCKER_HOST: 'unix:///nonexistent/docker.sock' },
      scratch,
    );
    expect(['not on PATH', 'docker daemon unreachable']).toContain(
      await unreachable.toolProblem('docker'),
    );
  });

  it('collects tool versions', async () => {
    const versions = await new CommandToolVersions(processes, env, scratch).collect();
    expect(versions.node).toBe(process.versions.node);
    expect(versions.pnpm).toMatch(/^\d+\.\d+\.\d+$/);
    const bare = await new CommandToolVersions(
      processes,
      { PATH: '/nonexistent' },
      scratch,
    ).collect();
    expect(bare).toEqual({ node: process.versions.node });
  });
});

describe('repository helpers', () => {
  const root = resolve(import.meta.dirname, '../../..');

  it('finds the workspace root', () => {
    expect(findRepositoryRoot(join(root, 'tools', 'gate', 'src'))).toBe(root);
    expect(() => findRepositoryRoot('/')).toThrow(/no pnpm-workspace.yaml/);
  });

  it('loads the dependency-cruiser excludes', () => {
    expect(loadDepcruiseExcludes(root)).toEqual(['^(packages|apps|tools)/[^/]+/(dist|coverage)/']);
    const other = join(scratch, 'cfg');
    mkdirSync(other);
    writeFileSync(join(other, 'package.json'), '{}');
    writeFileSync(join(other, '.dependency-cruiser.cjs'), 'module.exports = { options: {} };');
    expect(loadDepcruiseExcludes(other)).toEqual([]);
    const single = join(scratch, 'cfg2');
    mkdirSync(single);
    writeFileSync(join(single, 'package.json'), '{}');
    writeFileSync(
      join(single, '.dependency-cruiser.cjs'),
      "module.exports = { options: { exclude: { path: 'x' } } };",
    );
    expect(loadDepcruiseExcludes(single)).toEqual(['x']);
  });
});
