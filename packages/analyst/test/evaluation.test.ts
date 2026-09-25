/** The live-quality instrument (M07-G7) against the fake LLM: parsing, running, scoring. */
import { startFakeLlm } from '@argus/testkit';
import { describe, expect, it } from 'vitest';
import { parseLabelledBreaks, runTriageEvaluation, scoreTriage } from '../src/index.js';
import { analystFor, decision, frameImages, packet, providerFor } from './support.js';

describe('parseLabelledBreaks', () => {
  it('reads a dataset and reports every bad line', async () => {
    const p = packet();
    const frames = await frameImages(p.frames.slice(0, 1), 64, 48);
    const lines = [
      JSON.stringify({
        id: 'b1',
        packet: p,
        frameImages: frames,
        label: { decision: 'MARK_FAILED_CONTINUE', classification: 'PRODUCT_DEFECT' },
      }),
      '',
      JSON.stringify({
        id: 'b2',
        packet: packet({ reason: 'BLOCKING_MODAL' }),
        label: { decision: 'PATCH', classification: 'ENVIRONMENT' },
      }),
    ];
    const parsed = parseLabelledBreaks(lines.join('\n'));
    expect(parsed.ok && parsed.value.map((c) => [c.id, c.frameImages.length])).toEqual([
      ['b1', 1],
      ['b2', 0],
    ]);
    const bad = parseLabelledBreaks(
      [
        'not json',
        JSON.stringify({ packet: p }),
        lines[0] ?? '',
        lines[0] ?? '',
        JSON.stringify({ id: 'b3', packet: { ...p, attempt: 0 }, label: {} }),
        JSON.stringify({
          id: 'b4',
          packet: p,
          label: { decision: 'WHATEVER', classification: 'PRODUCT_DEFECT' },
        }),
        JSON.stringify({
          id: 'b5',
          packet: p,
          frameImages: [{ ref: 1 }],
          label: { decision: 'RETRY_STEP', classification: 'TRANSIENT' },
        }),
      ].join('\n'),
    );
    expect(!bad.ok && bad.error.map((e) => e.split(':')[0])).toEqual([
      'line 1',
      'line 2',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
    ]);
  });
});

describe('runTriageEvaluation and scoreTriage', () => {
  it('scores matches, repairs and failures', async () => {
    const llm = await startFakeLlm({
      script: {
        outcomes: [
          { response: { json: decision() } },
          { response: { json: { decision: 'bad' } } },
          {
            response: {
              json: decision({ decision: 'RETRY_STEP', classification: 'TRANSIENT', defect: null }),
            },
          },
          { response: { json: { decision: 'bad' } } },
          { response: { json: { decision: 'still bad' } } },
          { status: 401 },
        ],
      },
    });
    try {
      const analyst = await analystFor(providerFor('openai', llm));
      const cases = ['c1', 'c2', 'c3', 'c4'].map((id) => ({
        id,
        packet: packet(),
        frameImages: [],
        label: {
          decision: 'MARK_FAILED_CONTINUE' as const,
          classification: 'PRODUCT_DEFECT' as const,
        },
      }));
      const outcomes = await runTriageEvaluation(analyst, cases);
      expect(outcomes.map((o) => [o.decision, o.error, o.calls])).toEqual([
        ['MARK_FAILED_CONTINUE', null, 1],
        ['RETRY_STEP', null, 2],
        [null, 'invalid_answer', 0],
        [null, 'unavailable', 0],
      ]);
      const quality = scoreTriage(
        [...cases, { ...cases[0], id: 'missing' } as (typeof cases)[number]],
        outcomes,
      );
      expect(quality).toMatchObject({
        cases: 5,
        answered: 2,
        decisionMatches: 1,
        classificationMatches: 1,
        decisionMatch: 0.2,
        invalidAfterRepair: 1,
        unavailable: 1,
        repaired: 1,
      });
      expect(quality.maxInputTokens).toBeGreaterThan(0);
      expect(scoreTriage([], []).decisionMatch).toBe(0);
    } finally {
      await llm.close();
    }
  });
});
