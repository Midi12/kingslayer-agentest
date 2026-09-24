import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type CommitInfo,
  GitRepository,
  type GuardIo,
  NodeGuardIo,
  type Repository,
  RepositoryError,
  guardCli,
} from '../src/index.js';
import { guardMain } from '../src/main.js';

class MemoryIo implements GuardIo {
  readonly lines: string[] = [];
  constructor(private readonly lists: Record<string, string> = {}) {}
  readList(path: string): Promise<string> {
    const text = this.lists[path];
    if (text === undefined) {
      return Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' }));
    }
    return Promise.resolve(text);
  }
  info(line: string): void {
    this.lines.push(line);
  }
  error(line: string): void {
    this.lines.push(line);
  }
}

class FakeRepository implements Repository {
  constructor(
    private readonly history: readonly (CommitInfo & { files: string[] })[],
    private readonly diff: string[] = [],
  ) {}
  diffFiles(): Promise<string[]> {
    return Promise.resolve(this.diff);
  }
  commits(): Promise<CommitInfo[]> {
    return Promise.resolve(
      this.history.map(({ sha, parents, subject }) => ({ sha, parents, subject })),
    );
  }
  commitFiles(sha: string): Promise<string[]> {
    return Promise.resolve(this.history.find((commit) => commit.sha === sha)?.files ?? []);
  }
}

const history = [
  {
    sha: 'a'.repeat(40),
    parents: ['0'.repeat(40)],
    subject: 'test(M06): gates',
    files: ['gates/M06.yaml'],
  },
  {
    sha: 'b'.repeat(40),
    parents: ['a'.repeat(40)],
    subject: 'feat(M06): code',
    files: ['packages/n/src/a.ts'],
  },
];

function deps(io: MemoryIo, repository: Repository = new FakeRepository(history)) {
  return { io, openRepository: () => repository };
}

describe('guardCli', () => {
  it('prints usage for help and on errors', async () => {
    const io = new MemoryIo();
    expect(await guardCli(['--help'], deps(io))).toBe(0);
    expect(await guardCli([], deps(io))).toBe(2);
    expect(io.lines.join('\n')).toMatch(/Usage/);
  });

  it('checks file lists', async () => {
    const io = new MemoryIo({ mixed: 'gates/M01.yaml\nsrc/a.ts\n', clean: 'src/a.ts\n' });
    expect(await guardCli(['--files', 'mixed'], deps(io))).toBe(1);
    expect(io.lines.join('\n')).toMatch(/protected {7}gates\/M01.yaml/);
    expect(await guardCli(['--files', 'clean'], deps(io))).toBe(0);
    expect(await guardCli(['--files', 'absent'], deps(io))).toBe(2);
  });

  it('uses the commit subject for tests next to protected paths', async () => {
    const io = new MemoryIo({ both: 'gates/M01.yaml\npackages/c/test/gate-g1.test.ts\n' });
    expect(await guardCli(['--files', 'both'], deps(io))).toBe(0);
    expect(
      await guardCli(
        ['--files', 'both', '--subject', 'test(M01): gates and failing tests'],
        deps(io),
      ),
    ).toBe(0);
    expect(await guardCli(['--files', 'both', '--subject', 'fix(M01): relax'], deps(io))).toBe(1);
    expect(io.lines.join('\n')).toMatch(/test {12}packages\/c\/test\/gate-g1.test.ts/);
    expect(io.lines.join('\n')).toMatch(/gate-change commits/);
    const weakened = new FakeRepository([
      ...history,
      {
        sha: 'c'.repeat(40),
        parents: ['b'.repeat(40)],
        subject: 'fix(M06): relax the gate',
        files: ['gates/M06.yaml', 'packages/n/test/gate-g1.test.ts'],
      },
    ]);
    expect(await guardCli(['--range', 'x..y', '--per-commit'], deps(io, weakened))).toBe(1);
  });

  it('checks a range per commit or combined', async () => {
    const io = new MemoryIo();
    expect(await guardCli(['--range', 'x..y', '--per-commit'], deps(io))).toBe(0);
    expect(await guardCli(['--range', 'x..y'], deps(io))).toBe(1);
    expect(await guardCli(['--range', 'x..y'], deps(io, new FakeRepository([])))).toBe(0);
    expect(io.lines.join('\n')).toMatch(/no commits/);
  });

  it('checks merge-request diffs', async () => {
    const io = new MemoryIo();
    expect(
      await guardCli(
        ['--diff', 'x', 'y'],
        deps(io, new FakeRepository([], ['prompts/a.md', 'b.ts'])),
      ),
    ).toBe(1);
    expect(
      await guardCli(['--diff', 'x', 'y'], deps(io, new FakeRepository([], ['prompts/a.md']))),
    ).toBe(0);
  });

  it('reports repository errors with exit 2 and rethrows bugs', async () => {
    const io = new MemoryIo();
    const failing: Repository = {
      diffFiles: () => Promise.reject(new RepositoryError('bad revision')),
      commits: () => Promise.reject(new Error('bug')),
      commitFiles: () => Promise.resolve([]),
    };
    expect(await guardCli(['--diff', 'x', 'y'], deps(io, failing))).toBe(2);
    expect(io.lines.join('\n')).toMatch(/bad revision/);
    await expect(guardCli(['--range', 'x..y'], deps(io, failing))).rejects.toThrow('bug');
  });
});

describe('GitRepository and guardMain', () => {
  const repo = mkdtempSync(join(tmpdir(), 'argus-guard-'));
  const git = (...args: string[]): string =>
    execFileSync(
      'git',
      ['-C', repo, '-c', 'user.name=T', '-c', 'user.email=t@test.invalid', ...args],
      {
        encoding: 'utf8',
      },
    ).trim();

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('lists commits, their files and diffs', async () => {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.txt'), 'a');
    git('add', '-A');
    git('commit', '-q', '-m', 'chore: root');
    const first = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'b c.txt'), 'b');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: second');
    const second = git('rev-parse', 'HEAD');
    const repository = new GitRepository(repo);
    expect(await repository.commitFiles(first)).toEqual(['a.txt']);
    expect(await repository.commits(`${first}..${second}`)).toEqual([
      { sha: second, parents: [first], subject: 'feat: second' },
    ]);
    expect(await repository.diffFiles(first, second)).toEqual(['b c.txt']);
    await expect(repository.commits('nope..nada')).rejects.toBeInstanceOf(RepositoryError);
    expect(await guardMain(['--range', `${first}..${second}`, '--per-commit'], repo)).toBe(0);
    expect(await guardMain(['--diff', first, second, '--repo', repo])).toBe(0);
  });

  it('reads file lists from disk', async () => {
    const list = join(repo, 'list.txt');
    writeFileSync(list, 'gates/M00.yaml\n');
    expect(await new NodeGuardIo().readList(list)).toBe('gates/M00.yaml\n');
    expect(await guardMain(['--files', list])).toBe(0);
  });
});
