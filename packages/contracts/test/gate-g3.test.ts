/**
 * M01-G3: every lint rule fires. For each rule L1 to L8 one fixture fails with exactly the
 * expected finding codes and step ids, and one passes with no finding at all.
 */
import { recordGateMetrics } from '@argus/testkit';
import { afterAll, describe, expect, it } from 'vitest';
import { LINT_CODES, lintScript, validate, type LintContext } from '../src/index.js';
import { lintFixtures } from './support/goldens.js';

const fixtures = lintFixtures();
const mismatches: string[] = [];
const failing = new Set<string>();
const passing = new Set<string>();

function contextOf(raw: (typeof fixtures)[number]['context']): LintContext {
  const previous = raw.previous === undefined ? undefined : validate('TestScript', raw.previous);
  if (previous !== undefined && !previous.ok) {
    throw new Error(`previous script is invalid: ${JSON.stringify(previous.error)}`);
  }
  return {
    criticalVerbs: raw.criticalVerbs,
    allowedOrigins: raw.allowedOrigins,
    allowedHttpHosts: raw.allowedHttpHosts,
    runTimeoutMs: raw.runTimeoutMs,
    ...(previous === undefined ? {} : { previous: previous.value }),
  };
}

describe('M01-G3 lint fixtures', () => {
  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))('%s', (name, fixture) => {
    const match = /^(L[1-8])-(fail|pass)$/.exec(name);
    expect(match).not.toBeNull();
    const [, rule, kind] = match ?? [];
    const script = validate('TestScript', fixture.script);
    expect(script.ok ? [] : script.error).toEqual([]);
    if (!script.ok) return;
    const findings = lintScript(script.value, contextOf(fixture.context));
    const actual = findings.map((finding) => ({ code: finding.code, stepId: finding.stepId }));
    const expected = fixture.expected;
    if (kind === 'fail') {
      expect(expected.length).toBeGreaterThan(0);
      expect(expected.every((finding) => finding.code === rule)).toBe(true);
    } else {
      expect(expected).toEqual([]);
    }
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    if (!same)
      mismatches.push(
        `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    else if (kind === 'fail' && rule !== undefined) failing.add(rule);
    else if (rule !== undefined) passing.add(rule);
    expect(actual).toEqual(expected);
    for (const finding of findings) {
      expect(finding.severity).toBe('error');
      expect(finding.message.length).toBeGreaterThan(0);
      expect(finding.path).toMatch(/^(\/[^/]*)*$/);
      expect(validate('LintFinding', finding).ok).toBe(true);
    }
  });

  it('has one failing and one passing fixture per rule', () => {
    const names = new Set(fixtures.map((fixture) => fixture.name));
    for (const code of LINT_CODES) {
      expect(names.has(`${code}-fail`)).toBe(true);
      expect(names.has(`${code}-pass`)).toBe(true);
    }
  });
});

afterAll(() => {
  recordGateMetrics({
    rules: LINT_CODES.length,
    fixtures: fixtures.length,
    failingFixtures: failing.size,
    passingFixtures: passing.size,
    mismatches: mismatches.length,
    mismatchList: mismatches,
  });
});
