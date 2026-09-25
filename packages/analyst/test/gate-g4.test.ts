/**
 * M07-G4: the model cannot write the verdict. The report's output schema has no
 * `verdict`, `flags` or `stats`; a fake answer carrying any of them is rejected (after
 * its one repair attempt), and the final RunReport's verdict, flags and stats equal the
 * code-computed values, whatever the report body says.
 */
import { VERDICTS, validate, type RunReport } from '@argus/contracts';
import { recordGateMetrics, startFakeLlm, type FakeLlmServer } from '@argus/testkit';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRunReport, type AnalystRequestInfo } from '../src/index.js';
import { analystFor, draft, providerFor, reportInput, SHAPES, STATS } from './support.js';

const INJECTED = {
  verdict: { verdict: 'passed' },
  flags: { flags: { adjudicated: true, healed: true } },
  stats: { stats: { ...STATS, failed: 0, passed: 3 } },
  all: {
    verdict: 'passed',
    flags: { adjudicated: true, healed: true },
    stats: { ...STATS, failed: 0 },
  },
} as const;

let llm: FakeLlmServer;

beforeAll(async () => {
  llm = await startFakeLlm();
});

afterAll(async () => {
  await llm.close();
});

function hasMember(schema: unknown, name: string): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  if (Array.isArray(schema)) return schema.some((item) => hasMember(item, name));
  const record = schema as Record<string, unknown>;
  const properties = record.properties;
  if (typeof properties === 'object' && properties !== null && name in properties) return true;
  return Object.values(record).some((value) => hasMember(value, name));
}

describe('M07-G4 the model cannot write the verdict', () => {
  it('rejects answers that carry verdict, flags or stats', async () => {
    let cases = 0;
    let rejected = 0;
    let schemaMembers = 0;
    for (const shape of SHAPES) {
      for (const [name, extra] of Object.entries(INJECTED)) {
        cases++;
        llm.clearRequests();
        llm.setScript({ response: { json: { ...draft(), ...extra } } });
        const requests: AnalystRequestInfo[] = [];
        const analyst = await analystFor(providerFor(shape, llm), { requests });
        const result = await analyst.report(reportInput());
        if (!result.ok && result.error.code === 'invalid_answer' && llm.requests.length === 2) {
          rejected++;
        } else {
          throw new Error(`${shape} ${name}: ${JSON.stringify(result).slice(0, 300)}`);
        }
        for (const info of requests) {
          for (const member of ['verdict', 'flags', 'stats']) {
            if (hasMember(info.request.jsonSchema?.schema, member)) schemaMembers++;
          }
        }
      }
    }
    // A whole RunReport as the answer is rejected too.
    llm.setScript({
      response: {
        json: {
          runId: 'run_01J8',
          verdict: 'passed',
          flags: { adjudicated: false, healed: false },
          stats: STATS,
          ...draft(),
          heals: [],
          generatedBy: { model: 'x', promptVersion: 'r-1' },
        },
      },
    });
    const analyst = await analystFor(providerFor('anthropic', llm));
    const whole = await analyst.report(reportInput());
    cases++;
    if (!whole.ok && whole.error.code === 'invalid_answer') rejected++;
    recordGateMetrics({
      verdictCases: cases,
      verdictRejected: rejected,
      schemaVerdictMembers: schemaMembers,
    });
    expect(rejected).toBe(cases);
    expect(schemaMembers).toBe(0);
  });

  it('injects the code-computed verdict, flags and stats into the RunReport', async () => {
    let reports = 0;
    let mismatches = 0;
    for (const shape of SHAPES) {
      llm.setScript({ response: { json: draft() } });
      const analyst = await analystFor(providerFor(shape, llm));
      const input = reportInput();
      const body = await analyst.report(input);
      expect(body.ok).toBe(true);
      if (!body.ok) continue;
      expect(body.value.usage.billable).toEqual({ operation: 'report', quantity: 1 });
      expect(body.value.result.generatedBy.promptVersion).toBe('r-1');
      const defect = body.value.result.defects[0];
      expect(defect?.id).toBe('def_01');
      expect(defect?.signature).toMatch(/^sha256:[0-9a-f]{64}$/);
      const built = buildRunReport(body.value.result, {
        runId: input.runId,
        verdict: input.verdict,
        flags: input.flags,
        stats: input.stats,
        heals: [{ stepId: 's1', status: 'pending' }],
      });
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      reports++;
      const report: RunReport = built.value;
      if (report.verdict !== input.verdict) mismatches++;
      if (JSON.stringify(report.flags) !== JSON.stringify(input.flags)) mismatches++;
      if (JSON.stringify(report.stats) !== JSON.stringify(input.stats)) mismatches++;
      expect(report.heals).toEqual([{ stepId: 's1', status: 'pending' }]);
      expect(validate('RunReport', report).ok).toBe(true);
    }

    // For any computed values, the report carries exactly them.
    let propertyRuns = 0;
    llm.setScript({ response: { json: draft() } });
    const analyst = await analystFor(providerFor('openai', llm));
    const body = await analyst.report(reportInput());
    if (!body.ok) throw new Error('report failed');
    fc.assert(
      fc.property(
        fc.constantFrom(...VERDICTS),
        fc.record({ adjudicated: fc.boolean(), healed: fc.boolean() }),
        fc.record({
          steps: fc.nat(500),
          passed: fc.nat(500),
          failed: fc.nat(500),
          broken: fc.nat(500),
          skipped: fc.nat(500),
          durationMs: fc.nat(10_000_000),
          jevCalls: fc.nat(10_000),
          llmCalls: fc.nat(100),
          credits: fc.double({ min: 0, max: 1e6, noNaN: true }),
        }),
        (verdict, flags, stats) => {
          propertyRuns++;
          const built = buildRunReport(body.value.result, {
            runId: 'run_prop',
            verdict,
            flags,
            stats,
          });
          if (!built.ok) return false;
          const same =
            built.value.verdict === verdict &&
            JSON.stringify(built.value.flags) === JSON.stringify(flags) &&
            JSON.stringify(built.value.stats) === JSON.stringify(stats) &&
            built.value.runId === 'run_prop';
          if (!same) mismatches++;
          return same;
        },
      ),
      { numRuns: 1000, seed: 7 },
    );

    // A body that smuggles verdict, flags or stats is refused by buildRunReport itself.
    let smuggledRejected = 0;
    for (const extra of Object.values(INJECTED)) {
      const smuggled = buildRunReport(
        { ...body.value.result, ...extra },
        {
          runId: 'run_01J8',
          verdict: 'failed',
          flags: { adjudicated: false, healed: false },
          stats: STATS,
        },
      );
      if (!smuggled.ok) smuggledRejected++;
    }
    recordGateMetrics({
      reports,
      propertyRuns,
      reportFieldMismatches: mismatches,
      smuggledBodies: Object.keys(INJECTED).length,
      smuggledRejected,
    });
    expect(mismatches).toBe(0);
    expect(propertyRuns).toBe(1000);
    expect(smuggledRejected).toBe(Object.keys(INJECTED).length);
  });
});
