/**
 * M07-G5: budgets. Measured on the requests the fake LLM received: a triage request is
 * at most 20,000 tokens with at most six frames (three to six when the packet has them),
 * every image's long edge at most 1,280 px; a report request is at most 16,000 tokens;
 * an oversize ledger is summarised deterministically and never cut mid-record; a request
 * that cannot fit is never sent.
 */
import sharp from 'sharp';
import { utf8, type BreakPacket, type ReportInput, type RunEvent } from '@argus/contracts';
import {
  recordGateMetrics,
  startFakeLlm,
  type FakeLlmServer,
  type LlmRequestRecord,
} from '@argus/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventPriority, findDataBlocks, ledgerRecord } from '../src/index.js';
import {
  analystFor,
  decision,
  draft,
  frameImages,
  image,
  ledger,
  packet,
  providerFor,
  reportInput,
  runFinished,
  runStarted,
  SHAPES,
  stepEvents,
} from './support.js';

const TRIAGE_BUDGET = 20_000;
const REPORT_BUDGET = 16_000;

interface Measured {
  tokens: number;
  images: number;
  maxLongEdge: number;
  texts: string[];
}

/** Independent estimate of a received request: text at 3 bytes a token, images by size. */
async function measure(record: LlmRequestRecord): Promise<Measured> {
  const body = record.body as Record<string, unknown>;
  const texts: string[] = [];
  const images: string[] = [];
  let schema: unknown;
  if (record.shape === 'anthropic') {
    texts.push(String(body.system));
    for (const message of body.messages as { content: Record<string, unknown>[] }[]) {
      for (const block of message.content) {
        if (block.type === 'text') texts.push(String(block.text));
        if (block.type === 'image')
          images.push(String((block.source as Record<string, unknown>).data));
      }
    }
    schema = ((body.output_config as Record<string, unknown>).format as Record<string, unknown>)
      .schema;
  } else {
    for (const message of body.messages as { content: unknown }[]) {
      if (typeof message.content === 'string') {
        texts.push(message.content);
        continue;
      }
      for (const part of message.content as Record<string, unknown>[]) {
        if (part.type === 'text') texts.push(String(part.text));
        if (part.type === 'image_url') {
          images.push(
            String((part.image_url as Record<string, unknown>).url).replace(/^data:[^,]+,/, ''),
          );
        }
      }
    }
    schema = (
      (body.response_format as Record<string, unknown>).json_schema as Record<string, unknown>
    ).schema;
  }
  let tokens = Math.ceil(utf8(texts.join('') + JSON.stringify(schema)).length / 3);
  let maxLongEdge = 0;
  for (const data of images) {
    const meta = await sharp(Buffer.from(data, 'base64')).metadata();
    const width = meta.width;
    const height = meta.height;
    maxLongEdge = Math.max(maxLongEdge, width, height);
    const shortScale = Math.min(1, 768 / Math.min(width, height));
    const tiles = Math.ceil((width * shortScale) / 512) * Math.ceil((height * shortScale) / 512);
    tokens += Math.max(Math.ceil((width * height) / 750), 85 + 170 * tiles);
  }
  return { tokens, images: images.length, maxLongEdge, texts };
}

const long = (seed: string, length: number): string =>
  seed.repeat(Math.ceil(length / seed.length)).slice(0, length);

/** A packet with every list and text at its schema maximum. */
function oversizePacket(): BreakPacket {
  const base = packet();
  const page = {
    headings: Array.from({ length: 64 }, (_, i) => long(`Heading ${String(i)} `, 300)),
    dialogs: Array.from({ length: 16 }, (_, i) => long(`Dialog ${String(i)} text `, 1000)),
    alerts: Array.from({ length: 32 }, (_, i) => long(`Alert ${String(i)} `, 1000)),
    loading: { inflightRequests: 3, spinners: 1 },
    textDigest: long('C12 Running | C13 Stopped | Alarm table row | ', 20_000),
  };
  return {
    ...base,
    script: {
      ...base.script,
      previousIntents: Array.from({ length: 500 }, (_, i) =>
        long(`Step ${String(i)} intent `, 300),
      ),
    },
    signals: {
      ...base.signals,
      checks: Array.from({ length: 64 }, (_, i) => ({
        kind: 'dom' as const,
        outcome: i % 3 === 0 ? ('fail' as const) : ('pass' as const),
        detail: long(`check ${String(i)} detail `, 2000),
      })),
      actionError: long('Element detached ', 2000),
    },
    observations: {
      before: {
        ...base.observations.before,
        digestHash: base.observations.before?.digestHash ?? '',
        page,
      },
      after: {
        ...base.observations.after,
        digestHash: base.observations.after?.digestHash ?? '',
        page,
      },
    },
    console: Array.from({ length: 50 }, (_, i) => ({
      level: (['error', 'warning', 'info', 'debug'] as const)[i % 4] ?? 'info',
      text: long(`console ${String(i)} `, 4000),
    })),
    network: Array.from({ length: 50 }, (_, i) => ({
      method: 'GET',
      url: `https://hmi.test/api/${long(`segment${String(i)}/`, 2000)}`,
      status: i % 5 === 0 ? 500 : 200,
    })),
  };
}

/** A ledger of about `size` events over 25 steps, mostly routine telemetry. */
function oversizeInput(size: number): ReportInput {
  const perStep = Math.floor(size / 25) - 2;
  const filler = (stepId: string, i: number) => {
    switch (i % 8) {
      case 0:
        return {
          type: 'navigator.verify' as const,
          stepId,
          data: {
            answers: { expect_0: 0.93, probe_error_ui: 0.02, probe_loading: 0.1 },
            latencyMs: 300,
            inputTokens: 5400,
          },
        };
      case 1:
        return {
          type: 'observation.captured' as const,
          stepId,
          data: {
            obsId: `obs_${stepId}_${String(i)}`,
            digestHash: `sha256:${'cd'.repeat(32)}`,
            artifacts: [`art://runs/r1/${stepId}/f${String(i)}.jpg`],
          },
        };
      case 2:
        return {
          type: 'artifact.stored' as const,
          stepId,
          data: {
            kind: 'frame' as const,
            ref: `art://runs/r1/${stepId}/f${String(i)}.jpg`,
            bytes: 48_000,
            sha256: `sha256:${'ef'.repeat(32)}`,
          },
        };
      case 3:
        return {
          type: 'usage.recorded' as const,
          stepId,
          data: { operation: 'step' as const, quantity: 1 },
        };
      case 4:
        return {
          type: 'check.evaluated' as const,
          stepId,
          data: {
            kind: 'dom' as const,
            index: 0,
            outcome: 'pass' as const,
            measured: { text: 'Running' },
          },
        };
      case 5:
        return {
          type: 'decision.made' as const,
          stepId,
          data: { rule: 5, decision: 'WAIT' as const, reason: null },
        };
      case 6:
        return {
          type: 'navigator.ground' as const,
          stepId,
          data: {
            requestHash: `sha256:${'12'.repeat(32)}`,
            pick: 'c17',
            confidence: 0.94,
            top: [{ cid: 'c17', p: 0.96 }],
            targetPresent: 0.99,
            source: 'jev' as const,
            latencyMs: 280,
            inputTokens: 4100,
          },
        };
      default:
        return {
          type: 'action.performed' as const,
          stepId,
          data: {
            type: 'click' as const,
            locator: 'getByTestId("start-c12")',
            durationMs: 90,
            error: null,
          },
        };
    }
  };
  const bodies = [runStarted()];
  for (let s = 0; s < 25; s++) {
    const stepId = `s${String(s + 1)}`;
    const extra = Array.from({ length: perStep }, (_, i) => filler(stepId, i));
    bodies.push(...stepEvents(stepId, s, s === 12 ? 'failed' : 'passed', extra));
  }
  bodies.push(runFinished());
  const base = reportInput();
  return {
    ...base,
    script: {
      ...base.script,
      steps: Array.from({ length: 25 }, (_, s) => ({
        id: `s${String(s + 1)}`,
        intent: `Step ${String(s + 1)} of the conveyor test`,
      })),
    },
    events: ledger(bodies),
  };
}

let llm: FakeLlmServer;

beforeAll(async () => {
  llm = await startFakeLlm();
});

afterAll(async () => {
  await llm.close();
});

describe('M07-G5 budgets', () => {
  it('keeps triage requests within 20,000 tokens and three to six frames', async () => {
    let maxTriageTokens = 0;
    let maxTriageImages = 0;
    let minTriageImages = Number.POSITIVE_INFINITY;
    let maxLongEdge = 0;
    let triageRequests = 0;
    const big = oversizePacket();
    const bigFrames = await frameImages(big.frames, 3840, 2160);
    const normal = packet();
    const normalFrames = await frameImages(normal.frames, 1920, 1080);
    for (const shape of SHAPES) {
      for (const [p, frames] of [
        [big, bigFrames],
        [normal, normalFrames],
      ] as const) {
        llm.clearRequests();
        // A bad first answer forces the repair request, which must fit too.
        llm.setScript({
          outcomes: [
            { response: { json: { decision: 'SKIP' } } },
            { response: { json: decision() } },
          ],
        });
        const analyst = await analystFor(providerFor(shape, llm));
        const result = await analyst.triage(p, { frameImages: frames });
        expect(result.ok).toBe(true);
        expect(llm.requests).toHaveLength(2);
        for (const record of llm.requests) {
          const m = await measure(record);
          triageRequests++;
          maxTriageTokens = Math.max(maxTriageTokens, m.tokens);
          maxTriageImages = Math.max(maxTriageImages, m.images);
          minTriageImages = Math.min(minTriageImages, m.images);
          maxLongEdge = Math.max(maxLongEdge, m.maxLongEdge);
        }
      }
    }
    // Only two frame images: both are sent, nothing is invented.
    llm.clearRequests();
    llm.setScript({ response: { json: decision() } });
    const few = await (
      await analystFor(providerFor('anthropic', llm))
    ).triage(normal, { frameImages: normalFrames.slice(2, 4) });
    expect(few.ok).toBe(true);
    const fewMeasured = await measure(llm.requests[0] as LlmRequestRecord);

    // A request that cannot fit is never sent.
    llm.clearRequests();
    const tight = await analystFor(providerFor('openai', llm), {
      limits: { triageTokenBudget: 5000 },
    });
    const refused = await tight.triage(big, { frameImages: bigFrames });
    const overBudgetCalls = llm.requests.length;
    recordGateMetrics({
      triageRequests,
      maxTriageTokens,
      maxTriageImages,
      minTriageImages,
      maxLongEdge,
      fewFramesSent: fewMeasured.images,
      overBudgetRefused: !refused.ok && refused.error.code === 'invalid_request',
      overBudgetCalls,
    });
    expect(maxTriageTokens).toBeLessThanOrEqual(TRIAGE_BUDGET);
    expect(maxTriageImages).toBeLessThanOrEqual(6);
    expect(minTriageImages).toBeGreaterThanOrEqual(3);
    expect(maxLongEdge).toBeLessThanOrEqual(1280);
    expect(fewMeasured.images).toBe(2);
    expect(refused.ok).toBe(false);
    expect(overBudgetCalls).toBe(0);
  });

  it('summarises an oversize ledger deterministically within 16,000 tokens, never cutting a record', async () => {
    const input = oversizeInput(30_000);
    const events = input.events as unknown as RunEvent[];
    const keyFrames = await Promise.all(
      Array.from({ length: 12 }, async (_, i) => ({
        ref: `art://runs/r1/key/k${String(i)}.png`,
        stepId: 's13',
        image: await image(1920, 1080, i),
      })),
    );
    const withFrames: ReportInput = { ...input, keyFrames };
    let maxReportTokens = 0;
    let maxReportImages = 0;
    let recordsCut = 0;
    let unknownRecords = 0;
    let accountedEvents = 0;
    let keptRecords = 0;
    let omittedEvents = 0;
    let essentialDropped = 0;
    const bodies: string[] = [];
    for (const shape of [...SHAPES, ...SHAPES]) {
      llm.clearRequests();
      llm.setScript({
        response: {
          json: {
            ...draft(),
            defects: [
              {
                stepId: 's13',
                title: 'Jam alarm static',
                severity: 'major',
                classification: 'PRODUCT_DEFECT',
              },
            ],
          },
        },
      });
      const analyst = await analystFor(providerFor(shape, llm));
      const result = await analyst.report(withFrames);
      expect(result.ok).toBe(true);
      const record = llm.requests[0] as LlmRequestRecord;
      bodies.push(`${shape}:${JSON.stringify(record.body)}`);
      const m = await measure(record);
      maxReportTokens = Math.max(maxReportTokens, m.tokens);
      maxReportImages = Math.max(maxReportImages, m.images);
      const block = m.texts
        .flatMap((text) => findDataBlocks(text))
        .find((b) => b.name === 'ledger');
      expect(block).toBeDefined();
      const bySeq = new Map(events.map((event) => [event.seq, event]));
      const seen = new Set<number>();
      keptRecords = 0;
      omittedEvents = 0;
      for (const line of (block?.body ?? '').split('\n')) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          recordsCut++;
          continue;
        }
        const omitted = parsed.omitted as
          { fromSeq: number; toSeq: number; count: number } | undefined;
        if (omitted !== undefined) {
          omittedEvents += omitted.count;
          for (let seq = omitted.fromSeq; seq <= omitted.toSeq; seq++) {
            if (seen.has(seq)) unknownRecords++;
            seen.add(seq);
            const event = bySeq.get(seq);
            if (event !== undefined && eventPriority(event) === 0) essentialDropped++;
          }
          continue;
        }
        const event = bySeq.get(parsed.seq as number);
        if (event === undefined || JSON.stringify(ledgerRecord(event)) !== JSON.stringify(parsed)) {
          recordsCut++;
          continue;
        }
        keptRecords++;
        seen.add(event.seq);
      }
      accountedEvents = seen.size;
    }
    const deterministic = bodies[0] === bodies[2] && bodies[1] === bodies[3];

    // A ledger that fits is sent whole.
    llm.clearRequests();
    llm.setScript({ response: { json: draft() } });
    const small = await (await analystFor(providerFor('anthropic', llm))).report(reportInput());
    expect(small.ok).toBe(true);
    const smallLedger = (await measure(llm.requests[0] as LlmRequestRecord)).texts
      .flatMap((text) => findDataBlocks(text))
      .find((b) => b.name === 'ledger');
    const smallLines = (smallLedger?.body ?? '').split('\n').length;

    recordGateMetrics({
      ledgerEvents: events.length,
      maxReportTokens,
      maxReportImages,
      keptRecords,
      omittedEvents,
      accountedEvents,
      recordsCut,
      duplicateOrUnknownRecords: unknownRecords,
      essentialDropped,
      deterministic,
      smallLedgerWhole: smallLines === reportInput().events.length,
    });
    expect(maxReportTokens).toBeLessThanOrEqual(REPORT_BUDGET);
    expect(recordsCut).toBe(0);
    expect(unknownRecords).toBe(0);
    expect(accountedEvents).toBe(events.length);
    expect(keptRecords + omittedEvents).toBe(events.length);
    expect(essentialDropped).toBe(0);
    expect(deterministic).toBe(true);
    expect(smallLines).toBe(reportInput().events.length);
  }, 180_000);
});
