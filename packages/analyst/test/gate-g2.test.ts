/**
 * M07-G2: bad answers cannot act. At least 25 malformed or out-of-menu answers (unknown
 * decision, patch outside the origins, four patch actions, evidence missing from the
 * packet, missing defect, …) are each rejected, get exactly one repair attempt that
 * carries the validator errors, and end as `invalid_answer` (ANALYST_INVALID), in both
 * provider shapes.
 */
import type { AnalystDecision, BreakPacket } from '@argus/contracts';
import { recordGateMetrics, startFakeLlm, type FakeLlmServer, type LlmFault } from '@argus/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  analystBreakReason,
  findDataBlocks,
  validateDecision,
  type AnalystRequestInfo,
  type DecisionRule,
} from '../src/index.js';
import { analystFor, decision, ORIGIN, packet, providerFor, SHAPES } from './support.js';

interface BadCase {
  readonly name: string;
  readonly packet: BreakPacket;
  /** The answer the fake gives on both calls. */
  readonly answer: unknown;
  readonly fault?: LlmFault;
  /** The rule `validateDecision` reports, for answers that parse. */
  readonly rule?: DecisionRule;
}

const uncertain = packet();
const failedCheck = packet({ reason: 'EXPECTATION_FAILED' });
const ambiguous = packet({ reason: 'GROUNDING_AMBIGUOUS' });
const strict = packet({ strict: true });
const critical = packet({ critical: true });
const fillable = packet({ patchActions: ['click', 'fill'] });
const noBefore: BreakPacket = {
  ...packet(),
  observations: { ...packet().observations, before: null },
};

const patchDecision = (patch: NonNullable<AnalystDecision['patch']>): AnalystDecision =>
  decision({ decision: 'PATCH', classification: 'TEST_DRIFT', patch, defect: null });

const click = {
  type: 'click' as const,
  target: { description: 'Close button of the notice dialog' },
};

function without(value: AnalystDecision, key: keyof AnalystDecision): unknown {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

const CASES: readonly BadCase[] = [
  {
    name: 'unknown decision',
    packet: uncertain,
    answer: { ...decision(), decision: 'SKIP_STEP' },
    rule: 'schema',
  },
  {
    name: 'MARK_PASSED on a failed expectation',
    packet: failedCheck,
    answer: decision({ decision: 'MARK_PASSED', classification: 'TRANSIENT', defect: null }),
    rule: 'menu',
  },
  {
    name: 'MARK_PASSED under strict',
    packet: strict,
    answer: decision({ decision: 'MARK_PASSED', classification: 'TRANSIENT', defect: null }),
    rule: 'menu',
  },
  {
    name: 'MARK_FAILED_CONTINUE on a critical step',
    packet: critical,
    answer: decision(),
    rule: 'menu',
  },
  {
    name: 'RESOLVE_TARGET outside ambiguous grounding',
    packet: uncertain,
    answer: decision({
      decision: 'RESOLVE_TARGET',
      classification: 'TEST_DRIFT',
      resolveTarget: { cid: 'c17' },
      defect: null,
    }),
    rule: 'menu',
  },
  {
    name: 'RESOLVE_TARGET with an unknown candidate',
    packet: ambiguous,
    answer: decision({
      decision: 'RESOLVE_TARGET',
      classification: 'TEST_DRIFT',
      resolveTarget: { cid: 'c99' },
      defect: null,
    }),
    rule: 'resolve-target',
  },
  {
    name: 'RESOLVE_TARGET without a candidate',
    packet: ambiguous,
    answer: decision({ decision: 'RESOLVE_TARGET', classification: 'TEST_DRIFT', defect: null }),
    rule: 'resolve-target',
  },
  {
    name: 'PATCH on a failed expectation',
    packet: failedCheck,
    answer: patchDecision([click]),
    rule: 'menu',
  },
  {
    name: 'navigation to another origin',
    packet: uncertain,
    answer: patchDecision([{ type: 'navigate', url: 'https://evil.example/exfil' }]),
    rule: 'patch-origin',
  },
  {
    name: 'protocol-relative navigation',
    packet: uncertain,
    answer: patchDecision([{ type: 'navigate', url: '//evil.example/exfil' }]),
    rule: 'patch-origin',
  },
  {
    name: 'javascript: navigation',
    packet: uncertain,
    answer: patchDecision([{ type: 'navigate', url: 'javascript:alert(1)' }]),
    rule: 'patch-origin',
  },
  {
    name: 'navigation with another scheme',
    packet: uncertain,
    answer: patchDecision([{ type: 'navigate', url: 'http://hmi.test/overview' }]),
    rule: 'patch-origin',
  },
  {
    name: 'navigation with credentials',
    packet: uncertain,
    answer: patchDecision([{ type: 'navigate', url: 'https://operator:secret@hmi.test/' }]),
    rule: 'patch-origin',
  },
  {
    name: 'four patch actions',
    packet: uncertain,
    answer: patchDecision([click, click, click, click]),
    rule: 'patch-budget',
  },
  {
    name: 'patch action not allowed',
    packet: uncertain,
    answer: patchDecision([
      { type: 'fill', target: { description: 'Search field' }, value: 'C12' },
    ]),
    rule: 'patch-action',
  },
  {
    name: 'PATCH without actions',
    packet: uncertain,
    answer: patchDecision([]),
    rule: 'patch-required',
  },
  {
    name: 'patch actions on RETRY_STEP',
    packet: uncertain,
    answer: decision({
      decision: 'RETRY_STEP',
      classification: 'TRANSIENT',
      patch: [click],
      defect: null,
    }),
    rule: 'patch-forbidden',
  },
  {
    name: 'secret template in a patch',
    packet: fillable,
    answer: patchDecision([
      { type: 'fill', target: { description: 'Password field' }, value: '${secret.PASSWORD}' },
    ]),
    rule: 'patch-template',
  },
  {
    name: 'patch target with a locator',
    packet: uncertain,
    answer: patchDecision([
      {
        type: 'click',
        target: { description: 'Start', locator: '#start' },
      } as unknown as typeof click,
    ]),
    rule: 'schema',
  },
  {
    name: 'evidence frame missing from the packet',
    packet: uncertain,
    answer: decision({ evidence: [{ frame: 'art://runs/r1/ring/f999.jpg', note: 'invented' }] }),
    rule: 'evidence',
  },
  {
    name: 'evidence check missing from the packet',
    packet: uncertain,
    answer: decision({ evidence: [{ check: 7, note: 'invented' }] }),
    rule: 'evidence',
  },
  {
    name: 'evidence console entry missing',
    packet: uncertain,
    answer: decision({ evidence: [{ console: 3, note: 'invented' }] }),
    rule: 'evidence',
  },
  {
    name: 'evidence network entry missing',
    packet: uncertain,
    answer: decision({ evidence: [{ network: 1, note: 'invented' }] }),
    rule: 'evidence',
  },
  {
    name: 'evidence observation missing',
    packet: noBefore,
    answer: decision({ evidence: [{ observation: 'before', note: 'invented' }] }),
    rule: 'evidence',
  },
  {
    name: 'MARK_FAILED_CONTINUE product defect without defect',
    packet: uncertain,
    answer: without(decision(), 'defect'),
    rule: 'defect',
  },
  {
    name: 'MARK_FAILED_ABORT product defect with a null defect',
    packet: uncertain,
    answer: decision({ decision: 'MARK_FAILED_ABORT', defect: null }),
    rule: 'defect',
  },
  {
    name: 'missing rationale',
    packet: uncertain,
    answer: without(decision(), 'rationale'),
    rule: 'schema',
  },
  {
    name: 'unknown classification',
    packet: uncertain,
    answer: { ...decision(), classification: 'OPERATOR_ERROR' },
    rule: 'schema',
  },
  {
    name: 'extra verdict member',
    packet: uncertain,
    answer: { ...decision(), verdict: 'passed' },
    rule: 'schema',
  },
  { name: 'malformed JSON', packet: uncertain, answer: decision(), fault: 'malformed-json' },
  { name: 'schema-invalid JSON', packet: uncertain, answer: decision(), fault: 'schema-invalid' },
  { name: 'refusal', packet: uncertain, answer: decision(), fault: 'refusal' },
  { name: 'over-long answer', packet: uncertain, answer: decision(), fault: 'over-long' },
];

let llm: FakeLlmServer;

beforeAll(async () => {
  llm = await startFakeLlm();
});

afterAll(async () => {
  await llm.close();
});

describe('M07-G2 bad answers cannot act', () => {
  it('every bad answer breaks the rule it targets, and a valid one passes', () => {
    for (const item of CASES) {
      if (item.rule === undefined) continue;
      const result = validateDecision(item.packet, item.answer);
      expect(result.ok, item.name).toBe(false);
      if (!result.ok) {
        expect(
          result.error.map((issue) => issue.rule),
          item.name,
        ).toContain(item.rule);
      }
    }
    expect(validateDecision(uncertain, decision()).ok).toBe(true);
    expect(
      validateDecision(uncertain, patchDecision([{ type: 'navigate', url: '/alarms?filter=C12' }]))
        .ok,
    ).toBe(true);
    expect(
      validateDecision(uncertain, patchDecision([{ type: 'navigate', url: `${ORIGIN}/alarms` }]))
        .ok,
    ).toBe(true);
    expect(
      validateDecision(
        ambiguous,
        decision({
          decision: 'RESOLVE_TARGET',
          classification: 'TEST_DRIFT',
          resolveTarget: { cid: 'c17' },
          defect: null,
        }),
      ).ok,
    ).toBe(true);
  });

  it('rejects each bad answer, repairs exactly once with the errors, then ANALYST_INVALID', async () => {
    let runs = 0;
    let rejected = 0;
    let exactlyOneRepair = 0;
    let repairsCarryingErrors = 0;
    let analystInvalid = 0;
    const failures: string[] = [];
    for (const shape of SHAPES) {
      for (const item of CASES) {
        runs++;
        llm.clearRequests();
        llm.setScript({
          response: { json: item.answer },
          ...(item.fault === undefined ? {} : { fault: item.fault }),
        });
        const requests: AnalystRequestInfo[] = [];
        const analyst = await analystFor(providerFor(shape, llm), { requests });
        const result = await analyst.triage(item.packet);
        if (!result.ok && result.error.code === 'invalid_answer') {
          rejected++;
          if (analystBreakReason(result.error) === 'ANALYST_INVALID') analystInvalid++;
        } else {
          failures.push(`${shape} ${item.name}: ${JSON.stringify(result).slice(0, 300)}`);
        }
        if (llm.requests.length === 2 && requests.map((r) => r.attempt).join(',') === '1,2') {
          exactlyOneRepair++;
        } else {
          failures.push(`${shape} ${item.name}: ${String(llm.requests.length)} provider calls`);
        }
        const repair = requests[1]?.request.messages.at(-1)?.content[0];
        const errorsBlock =
          repair?.type === 'text'
            ? findDataBlocks(repair.text).find((block) => block.name === 'errors')
            : undefined;
        const errors = errorsBlock === undefined ? [] : (JSON.parse(errorsBlock.body) as string[]);
        const rule = item.rule;
        if (
          errors.length > 0 &&
          (rule === undefined || errors.some((error) => error.includes(`[${rule}]`)))
        ) {
          repairsCarryingErrors++;
        } else {
          failures.push(`${shape} ${item.name}: repair errors ${JSON.stringify(errors)}`);
        }
      }
    }
    recordGateMetrics({
      cases: CASES.length,
      shapes: SHAPES.length,
      runs,
      rejected,
      exactlyOneRepair,
      repairsCarryingErrors,
      analystInvalid,
    });
    expect(failures).toEqual([]);
    expect(CASES.length).toBeGreaterThanOrEqual(25);
  });

  it('accepts an answer that the repair fixes, after exactly two calls', async () => {
    let repaired = 0;
    for (const shape of SHAPES) {
      llm.clearRequests();
      llm.setScript({
        outcomes: [
          {
            response: { json: patchDecision([{ type: 'navigate', url: 'https://evil.example/' }]) },
          },
          { response: { json: decision() } },
        ],
      });
      const analyst = await analystFor(providerFor(shape, llm));
      const result = await analyst.triage(uncertain);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.result.decision).toBe('MARK_FAILED_CONTINUE');
        expect(result.value.usage.calls).toBe(2);
        expect(result.value.usage.billable).toEqual({ operation: 'escalation', quantity: 1 });
        repaired++;
      }
      expect(llm.requests).toHaveLength(2);
    }
    recordGateMetrics({ repairedAccepted: repaired });
  });
});
