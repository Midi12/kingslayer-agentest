/**
 * M00-G3: dependency rules bite. A fixture package importing an adapter from core makes
 * `pnpm depcruise` exit non-zero, one fixture per rule fires exactly that rule, a
 * compliant fixture passes, and the real tree exits 0.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { recordGateMetrics } from '@argus/testkit';
import { afterAll, describe, expect, it } from 'vitest';

interface Case {
  readonly fixture: string;
  readonly why: string;
  readonly rules: readonly string[];
}

interface DepcruiseReport {
  readonly summary: {
    readonly error: number;
    readonly violations: readonly { readonly rule: { readonly name: string } }[];
  };
}

const root = resolve(import.meta.dirname, '../../..');
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'depcruise');
const cases = JSON.parse(
  readFileSync(join(import.meta.dirname, '__golden__', 'g3-depcruise-cases.json'), 'utf8'),
) as Case[];
const scratch = mkdtempSync(join(tmpdir(), 'argus-g3-'));

const metrics = {
  realTreeExit: -1,
  coreAdapterFixtureExit: 0,
  coreAdapterRuleFired: false,
  ruleCases: 0,
  ruleCasesCorrect: 0,
};

afterAll(() => {
  recordGateMetrics(metrics);
  rmSync(scratch, { recursive: true, force: true });
});

function depcruise(args: readonly string[]): { status: number; output: string } {
  const run = spawnSync('pnpm', ['--silent', 'depcruise', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: run.status ?? -1, output: `${run.stdout}${run.stderr}` };
}

describe('M00-G3 dependency rules bite', () => {
  it('passes on the real tree', () => {
    const run = depcruise([]);
    metrics.realTreeExit = run.status;
    expect(run.status, run.output).toBe(0);
    expect(run.output).toMatch(/no dependency violations found/);
  });

  it.each(cases)('$fixture: $why', ({ fixture, rules }) => {
    const report = join(scratch, `${fixture}.json`);
    const run = depcruise(['--json', report, relative(root, join(fixtureRoot, fixture))]);
    const parsed = JSON.parse(readFileSync(report, 'utf8')) as DepcruiseReport;
    const fired = [
      ...new Set(parsed.summary.violations.map((violation) => violation.rule.name)),
    ].sort();
    metrics.ruleCases += 1;
    const correct =
      JSON.stringify(fired) === JSON.stringify([...rules].sort()) &&
      (rules.length === 0 ? run.status === 0 : run.status !== 0);
    if (correct) {
      metrics.ruleCasesCorrect += 1;
    }
    if (fixture === 'core-to-adapter') {
      metrics.coreAdapterFixtureExit = run.status;
      metrics.coreAdapterRuleFired = fired.includes('core-not-to-adapters');
    }
    expect(fired).toEqual([...rules].sort());
    if (rules.length === 0) {
      expect(run.status, run.output).toBe(0);
    } else {
      expect(run.status, run.output).not.toBe(0);
    }
  });

  it('names the violating core import in its human-readable report', () => {
    const run = depcruise([relative(root, join(fixtureRoot, 'core-to-adapter'))]);
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/core-not-to-adapters/);
    expect(run.output).toMatch(/src\/core\/logic\.ts/);
  });
});
