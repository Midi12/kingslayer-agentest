/**
 * Protected-path rule (CLAUDE.md section 2, ADR-0015): protected paths never change in
 * the same commit, or merge request, as other paths. Neutral paths may accompany either
 * side: gate evidence and gate-change notes. Tests (a project's root `test/` directory
 * and `*.test.*`/`*.spec.*` files; a `test/` directory inside `src/` is implementation
 * code) accompany implementation freely, but accompany protected paths only in the
 * commits whose job that is: the gates-first commit `test(<MOD>): ...` and a gate change
 * `chore(<MOD>): gate-change <n>`. When the commit subject is unknown (a file list
 * without `--subject`, a merge-request diff, a range checked as a whole) tests stay
 * neutral.
 */
import { globToRegExp, matchesAny, normalizePath } from './globs.js';

export const PROTECTED_GLOBS = [
  'gates/*.yaml',
  '**/__golden__/**',
  'thresholds/**',
  'prompts/**',
  'packages/navigator/src/questions.ts',
] as const;

/** Neutral in every change. */
export const NEUTRAL_GLOBS = ['gates/evidence/**', 'docs/gate-changes/**'] as const;

/** Neutral next to protected paths only in gates-first and gate-change commits. */
export const TEST_GLOBS = [
  'apps/*/test/**',
  'packages/*/test/**',
  'tools/*/test/**',
  '**/*.test.*',
  '**/*.spec.*',
] as const;

const protectedPatterns = PROTECTED_GLOBS.map(globToRegExp);
const neutralPatterns = NEUTRAL_GLOBS.map(globToRegExp);
const testPatterns = TEST_GLOBS.map(globToRegExp);

/** `test(<scope>): ...` or `chore(<scope>): gate-change ...`. */
const GATE_COMMIT_SUBJECT = /^(?:test\([^)]+\)!?: \S|chore\([^)]+\)!?: gate-change\b)/;

/** Whether a commit with this subject may change tests together with protected paths. */
export function isGateCommitSubject(subject: string): boolean {
  return GATE_COMMIT_SUBJECT.test(subject);
}

export type PathClass = 'protected' | 'neutral' | 'test' | 'implementation';

/** Protected wins over neutral and test, so a golden file under test/ stays protected. */
export function classifyPath(path: string): PathClass {
  const normalized = normalizePath(path);
  if (matchesAny(normalized, protectedPatterns)) {
    return 'protected';
  }
  if (matchesAny(normalized, neutralPatterns)) {
    return 'neutral';
  }
  if (matchesAny(normalized, testPatterns)) {
    return 'test';
  }
  return 'implementation';
}

export interface Classification {
  readonly protected: readonly string[];
  readonly neutral: readonly string[];
  readonly tests: readonly string[];
  readonly implementation: readonly string[];
  /** False when the commit subject is known and is not a gates-first or gate-change one. */
  readonly testsNeutral: boolean;
  /** True when protected paths change together with implementation, or with non-neutral tests. */
  readonly violation: boolean;
}

export interface ChangeContext {
  /** Subject of the single commit the paths belong to, when known. */
  readonly subject?: string | undefined;
}

export function classifyChange(
  paths: readonly string[],
  context: ChangeContext = {},
): Classification {
  const buckets: Record<PathClass, string[]> = {
    protected: [],
    neutral: [],
    test: [],
    implementation: [],
  };
  for (const path of new Set(paths.map(normalizePath).filter((p) => p !== ''))) {
    buckets[classifyPath(path)].push(path);
  }
  const testsNeutral = context.subject === undefined || isGateCommitSubject(context.subject);
  const others = buckets.implementation.length + (testsNeutral ? 0 : buckets.test.length);
  return {
    protected: buckets.protected,
    neutral: buckets.neutral,
    tests: buckets.test,
    implementation: buckets.implementation,
    testsNeutral,
    violation: buckets.protected.length > 0 && others > 0,
  };
}
