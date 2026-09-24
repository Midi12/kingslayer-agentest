import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CONVENTIONAL_TYPES,
  GUARD_USAGE,
  NEUTRAL_GLOBS,
  PROTECTED_GLOBS,
  classifyChange,
  classifyPath,
  globToRegExp,
  isConventionalSubject,
  normalizePath,
  parseFileList,
  parseGuardArgs,
} from '../src/index.js';

describe('globToRegExp', () => {
  it('matches single-segment wildcards', () => {
    const pattern = globToRegExp('gates/*.yaml');
    expect(pattern.test('gates/M00.yaml')).toBe(true);
    expect(pattern.test('gates/evidence/M00.yaml')).toBe(false);
    expect(pattern.test('gates/M00.yml')).toBe(false);
    expect(globToRegExp('src/?.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/?.ts').test('src/ab.ts')).toBe(false);
  });

  it('matches ** across any number of directories', () => {
    const golden = globToRegExp('**/__golden__/**');
    expect(golden.test('__golden__/a.json')).toBe(true);
    expect(golden.test('packages/x/test/__golden__/deep/b.txt')).toBe(true);
    expect(golden.test('packages/x/test/golden/b.txt')).toBe(false);
    expect(globToRegExp('thresholds/**').test('thresholds/jev.json')).toBe(true);
    expect(globToRegExp('thresholds/**').test('thresholds')).toBe(true);
    expect(globToRegExp('a/**b').test('a/x/yb')).toBe(true);
  });

  it('escapes regular expression characters', () => {
    expect(globToRegExp('a+b(c).ts').test('a+b(c).ts')).toBe(true);
    expect(globToRegExp('a.ts').test('abts')).toBe(false);
  });
});

describe('classification', () => {
  it('lists the protected and neutral globs of CLAUDE.md', () => {
    expect(PROTECTED_GLOBS).toEqual([
      'gates/*.yaml',
      '**/__golden__/**',
      'thresholds/**',
      'prompts/**',
      'packages/navigator/src/questions.ts',
    ]);
    expect(NEUTRAL_GLOBS).toContain('gates/evidence/**');
    expect(NEUTRAL_GLOBS).toContain('docs/gate-changes/**');
  });

  it('classifies paths, protected before neutral', () => {
    expect(classifyPath('gates/M00.yaml')).toBe('protected');
    expect(classifyPath('packages/x/test/__golden__/a.json')).toBe('protected');
    expect(classifyPath('gates/evidence/M00.json')).toBe('neutral');
    expect(classifyPath('packages/x/test/a.test.ts')).toBe('neutral');
    expect(classifyPath('packages/x/src/a.spec.ts')).toBe('neutral');
    expect(classifyPath('packages/x/src/a.ts')).toBe('implementation');
    expect(classifyPath('.\\gates\\M01.yaml')).toBe('protected');
  });

  it('flags a change only when protected and implementation paths meet', () => {
    expect(classifyChange(['gates/M00.yaml', 'src/a.ts']).violation).toBe(true);
    expect(classifyChange(['gates/M00.yaml', 'gates/evidence/M00.json']).violation).toBe(false);
    expect(classifyChange(['', 'src/a.ts', 'src/a.ts'])).toEqual({
      protected: [],
      neutral: [],
      implementation: ['src/a.ts'],
      violation: false,
    });
  });

  it('never flags a change made of one side plus neutral paths', () => {
    const neutral = fc.constantFrom(
      'gates/evidence/M01.json',
      'docs/gate-changes/M01-1.md',
      'packages/a/test/x.test.ts',
    );
    const protectedPath = fc.constantFrom(
      'gates/M01.yaml',
      'prompts/c-1.md',
      'thresholds/t.json',
      'a/__golden__/g.txt',
    );
    const implementation = fc.constantFrom(
      'packages/a/src/x.ts',
      'README.md',
      'apps/api/src/main.ts',
    );
    fc.assert(
      fc.property(
        fc.array(protectedPath),
        fc.array(neutral),
        (p, n) => !classifyChange([...p, ...n]).violation,
      ),
    );
    fc.assert(
      fc.property(
        fc.array(implementation),
        fc.array(neutral),
        (i, n) => !classifyChange([...i, ...n]).violation,
      ),
    );
    fc.assert(
      fc.property(
        fc.array(protectedPath, { minLength: 1 }),
        fc.array(implementation, { minLength: 1 }),
        (p, i) => classifyChange([...i, ...p]).violation,
      ),
    );
  });

  it('normalises paths', () => {
    expect(normalizePath('  ././a\\b.ts ')).toBe('a/b.ts');
  });
});

describe('conventional subjects', () => {
  it('accepts scoped and unscoped conventional subjects', () => {
    expect(isConventionalSubject('feat(M06): stage-two confirmation')).toBe(true);
    expect(isConventionalSubject('chore(M00)!: gate-change 1')).toBe(true);
    expect(isConventionalSubject('docs: readme')).toBe(true);
    expect(CONVENTIONAL_TYPES).toContain('test');
  });

  it('rejects other subjects', () => {
    expect(isConventionalSubject('Initial commit')).toBe(false);
    expect(isConventionalSubject('feat(M06):missing space')).toBe(false);
    expect(isConventionalSubject('feature(M06): x')).toBe(false);
  });
});

describe('parseGuardArgs', () => {
  it('parses each mode', () => {
    expect(parseGuardArgs(['--diff', 'a', 'b'])).toEqual({
      ok: true,
      value: { kind: 'diff', base: 'a', head: 'b', repo: undefined },
    });
    expect(
      parseGuardArgs(['--range', 'a..b', '--per-commit', '--conventional', '--repo', '/r']),
    ).toEqual({
      ok: true,
      value: { kind: 'range', range: 'a..b', perCommit: true, conventional: true, repo: '/r' },
    });
    expect(parseGuardArgs(['--files', 'list.txt'])).toEqual({
      ok: true,
      value: { kind: 'files', list: 'list.txt' },
    });
    expect(parseGuardArgs(['-h'])).toEqual({ ok: true, value: { kind: 'help' } });
    expect(GUARD_USAGE).toMatch(/--per-commit/);
  });

  it.each([
    [[], /choose --diff, --range or --files/],
    [['--diff', 'a'], /needs <base> <head>/],
    [['--range', 'a...b'], /needs <base>..<head>/],
    [['--range'], /needs <base>..<head>/],
    [['--files'], /needs a file list/],
    [['--diff', 'a', 'b', '--files', 'x'], /cannot be combined/],
    [['--files', 'x', '--per-commit'], /apply to --range only/],
    [['--files', 'x', '--repo', 'r'], /does not apply to --files/],
    [['--repo'], /needs a directory/],
    [['--bogus'], /unexpected argument --bogus/],
  ])('rejects %j', (argv, message) => {
    const parsed = parseGuardArgs(argv);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toMatch(message);
  });

  it('reads file lists without blanks and comments', () => {
    expect(parseFileList('# c\n a.ts \r\n\nb.ts\n')).toEqual(['a.ts', 'b.ts']);
  });
});
