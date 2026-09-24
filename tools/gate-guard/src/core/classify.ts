/**
 * Protected-path rule (CLAUDE.md section 2, ADR-0015): protected paths never change in
 * the same commit, or merge request, as other paths. Neutral paths may accompany either
 * side: gate evidence, gate-change notes, and tests, because the gates-first commit
 * carries the gate tests and implementation commits may extend them.
 */
import { globToRegExp, matchesAny, normalizePath } from './globs.js';

export const PROTECTED_GLOBS = [
  'gates/*.yaml',
  '**/__golden__/**',
  'thresholds/**',
  'prompts/**',
  'packages/navigator/src/questions.ts',
] as const;

export const NEUTRAL_GLOBS = [
  'gates/evidence/**',
  'docs/gate-changes/**',
  '**/test/**',
  '**/*.test.*',
  '**/*.spec.*',
] as const;

const protectedPatterns = PROTECTED_GLOBS.map(globToRegExp);
const neutralPatterns = NEUTRAL_GLOBS.map(globToRegExp);

export type PathClass = 'protected' | 'neutral' | 'implementation';

/** Protected wins over neutral, so a golden file under test/ stays protected. */
export function classifyPath(path: string): PathClass {
  const normalized = normalizePath(path);
  if (matchesAny(normalized, protectedPatterns)) {
    return 'protected';
  }
  if (matchesAny(normalized, neutralPatterns)) {
    return 'neutral';
  }
  return 'implementation';
}

export interface Classification {
  readonly protected: readonly string[];
  readonly neutral: readonly string[];
  readonly implementation: readonly string[];
  /** True when protected and implementation paths change together. */
  readonly violation: boolean;
}

export function classifyChange(paths: readonly string[]): Classification {
  const buckets: Record<PathClass, string[]> = { protected: [], neutral: [], implementation: [] };
  for (const path of new Set(paths.map(normalizePath).filter((p) => p !== ''))) {
    buckets[classifyPath(path)].push(path);
  }
  return {
    protected: buckets.protected,
    neutral: buckets.neutral,
    implementation: buckets.implementation,
    violation: buckets.protected.length > 0 && buckets.implementation.length > 0,
  };
}
