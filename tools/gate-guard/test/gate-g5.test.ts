/**
 * M00-G5: protected paths are protected. `pnpm gate-guard` exits 1 on a fixture diff
 * touching gates/ and src/ together and 0 when it touches one side only; the git modes
 * (merge-request diff and per-commit range) agree on a real repository.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { recordGateMetrics } from '@argus/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Case {
  readonly list: string;
  readonly exit: number;
  readonly why: string;
}

const root = resolve(import.meta.dirname, '../../..');
const fixtures = join(import.meta.dirname, 'fixtures', 'g5');
const cases = JSON.parse(
  readFileSync(join(import.meta.dirname, '__golden__', 'g5-cases.json'), 'utf8'),
) as Case[];

const metrics = {
  cases: 0,
  correct: 0,
  mixedExit: -1,
  oneSideExit: -1,
  gitModes: 0,
  gitModesCorrect: 0,
};

function guard(args: readonly string[], input?: string): { status: number; output: string } {
  const run = spawnSync('pnpm', ['--silent', 'gate-guard', ...args], {
    cwd: root,
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });
  return { status: run.status ?? -1, output: `${run.stdout}${run.stderr}` };
}

afterAll(() => {
  recordGateMetrics(metrics);
});

describe('M00-G5 gate-guard on fixture file lists', () => {
  it.each(cases)('$list exits $exit: $why', ({ list, exit }) => {
    const run = guard(['--files', join(fixtures, list)]);
    metrics.cases += 1;
    if (run.status === exit) {
      metrics.correct += 1;
    }
    if (list === 'gates-and-src.txt') {
      metrics.mixedExit = run.status;
    }
    if (list === 'gates-only.txt') {
      metrics.oneSideExit = run.status;
    }
    expect(run.status, run.output).toBe(exit);
    if (exit === 1) {
      expect(run.output).toMatch(/VIOLATION/);
    }
  });

  it('reads a file list from standard input', () => {
    expect(
      guard(['--files', '-'], 'gates/M01.yaml\npackages/contracts/src/index.ts\n').status,
    ).toBe(1);
    expect(guard(['--files', '-'], 'gates/M01.yaml\n').status).toBe(0);
  });
});

describe('M00-G5 gate-guard on a git repository', () => {
  let repo = '';
  const git = (...args: string[]): string =>
    execFileSync(
      'git',
      ['-C', repo, '-c', 'user.name=Gate Test', '-c', 'user.email=gate@test.invalid', ...args],
      {
        encoding: 'utf8',
      },
    ).trim();
  const commit = (message: string, files: Record<string, string>): string => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const expectMode = (args: string[], exit: number): void => {
    const run = guard([...args, '--repo', repo]);
    metrics.gitModes += 1;
    if (run.status === exit) {
      metrics.gitModesCorrect += 1;
    }
    expect(run.status, run.output).toBe(exit);
  };
  let base = '';
  let gatesCommit = '';
  let implementationCommit = '';

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'argus-g5-'));
    git('init', '-q', '-b', 'main');
    base = commit('chore(M00): skeleton', { 'README.md': 'argus\n' });
    git('checkout', '-q', '-b', 'mod/M06');
    gatesCommit = commit('test(M06): gates and failing tests', {
      'gates/M06.yaml': 'module: M06\n',
      'packages/navigator/test/gate-g1.test.ts': 'export {};\n',
    });
    implementationCommit = commit('feat(M06): navigator', {
      'packages/navigator/src/index.ts': 'export {};\n',
    });
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('passes a gates-first branch commit by commit', () => {
    expectMode(
      ['--range', `${base}..${implementationCommit}`, '--per-commit', '--conventional'],
      0,
    );
  });

  it('fails the combined merge-request diff of the same branch', () => {
    expectMode(['--diff', base, implementationCommit], 1);
    expectMode(['--range', `${base}..${implementationCommit}`], 1);
  });

  it('passes each side on its own in merge-request mode', () => {
    expectMode(['--diff', base, gatesCommit], 0);
    expectMode(['--diff', gatesCommit, implementationCommit], 0);
  });

  it('fails a commit that mixes a gate change with implementation', () => {
    const mixed = commit('feat(M06): loosen the gate', {
      'gates/M06.yaml': 'module: M06\n# changed\n',
      'packages/navigator/src/index.ts': 'export const x = 1;\n',
    });
    expectMode(['--range', `${implementationCommit}..${mixed}`, '--per-commit'], 1);
  });

  it('skips merge commits and checks commit subjects', () => {
    git('checkout', '-q', 'main');
    commit('docs(M00): note', { 'docs/note.md': 'n\n' });
    git('merge', '-q', '--no-ff', '-m', 'Merge mod/M06', gatesCommit);
    const head = git('rev-parse', 'HEAD');
    expectMode(['--range', `${base}..${head}`, '--per-commit', '--conventional'], 0);
    const loose = commit('did stuff', { 'docs/other.md': 'o\n' });
    expectMode(['--range', `${head}..${loose}`, '--per-commit', '--conventional'], 1);
    expectMode(['--range', `${head}..${loose}`, '--per-commit'], 0);
  });
});
