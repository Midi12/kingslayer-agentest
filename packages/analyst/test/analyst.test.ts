/** LlmAnalyst beyond the gates: vision operations, pinned prompts, failures. */
import { startFakeLlm, type FakeLlmServer } from '@argus/testkit';
import type { InlineImage, VisionAssertRequest, VisualGroundRequest } from '@argus/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LlmAnalyst,
  SharpImageScaler,
  analystBreakReason,
  findDataBlocks,
  type AnalystRequestInfo,
  type AnalystResponseInfo,
  type ImageScaler,
  type LlmProvider,
} from '../src/index.js';
import {
  analystFor,
  decision,
  draft,
  image,
  packet,
  providerFor,
  reportInput,
  repositoryPrompts,
} from './support.js';

let llm: FakeLlmServer;
let screenshot: InlineImage;

beforeAll(async () => {
  llm = await startFakeLlm({ timeoutHoldMs: 2000 });
  screenshot = await image(2560, 1440, 3);
});

afterAll(async () => {
  await llm.close();
});

function groundRequest(labels = true): VisualGroundRequest {
  return {
    runId: 'run_01J8',
    stepId: 's3',
    step: {
      intent: 'Start conveyor C12',
      target: { description: 'Start button in the row of conveyor C12' },
    },
    image: screenshot,
    marks: ['1', '2', '3'].map((mark) => (labels ? { mark, label: `Start ${mark}` } : { mark })),
  };
}

function assertRequest(frames: InlineImage[] = []): VisionAssertRequest {
  return {
    runId: 'run_01J8',
    stepId: 's5',
    question: 'Does the alarm row of conveyor C12 blink?',
    expected: true,
    image: screenshot,
    ...(frames.length === 0 ? {} : { frames }),
  };
}

describe('groundVisually', () => {
  it('returns a mark from the closed set and bills an AI vision operation', async () => {
    llm.setScript({
      response: { json: { mark: '2', certainty: 'high', rationale: 'Mark 2 is in the C12 row.' } },
    });
    const requests: AnalystRequestInfo[] = [];
    const analyst = await analystFor(providerFor('anthropic', llm), { requests });
    const result = await analyst.groundVisually(groundRequest());
    expect(result.ok && result.value.result.mark).toBe('2');
    expect(result.ok && result.value.usage.billable).toEqual({
      operation: 'ai_vision',
      quantity: 1,
    });
    expect(requests[0]?.images).toBe(1);
    expect(requests[0]?.request.jsonSchema?.schema).toMatchObject({
      properties: { mark: { anyOf: [{ enum: ['1', '2', '3'] }, { type: 'null' }] } },
    });
  });

  it('accepts null and rejects a mark outside the set after one repair', async () => {
    llm.setScript({
      response: { json: { mark: null, certainty: 'low', rationale: 'Two marks fit.' } },
    });
    const analyst = await analystFor(providerFor('openai', llm));
    const none = await analyst.groundVisually(groundRequest());
    expect(none.ok && none.value.result.mark).toBeNull();
    llm.clearRequests();
    llm.setScript({ response: { json: { mark: '9', certainty: 'high', rationale: 'Mark 9.' } } });
    const outside = await analyst.groundVisually(groundRequest());
    expect(outside.ok).toBe(false);
    expect(!outside.ok && outside.error.code).toBe('invalid_answer');
    expect(llm.requests).toHaveLength(2);
  });

  it('drops mark labels, then refuses, when the request exceeds the budget', async () => {
    llm.setScript({ response: { json: { mark: '1', certainty: 'medium', rationale: 'Mark 1.' } } });
    const requests: AnalystRequestInfo[] = [];
    const labelled = {
      ...groundRequest(),
      marks: Array.from({ length: 200 }, (_, i) => ({ mark: String(i), label: 'x'.repeat(300) })),
    };
    const analyst = await analystFor(providerFor('anthropic', llm), {
      requests,
      limits: { visionTokenBudget: 9000 },
    });
    const result = await analyst.groundVisually(labelled);
    expect(result.ok).toBe(true);
    expect(requests[0]?.omitted).toEqual({ markLabels: true });
    const tiny = await analystFor(providerFor('anthropic', llm), {
      limits: { visionTokenBudget: 3000 },
    });
    const refused = await tiny.groundVisually(labelled);
    expect(!refused.ok && refused.error.code).toBe('invalid_request');
  });

  it('refuses an invalid request or an image that does not decode', async () => {
    const analyst = await analystFor(providerFor('anthropic', llm));
    const invalid = await analyst.groundVisually({ ...groundRequest(), marks: [] });
    expect(!invalid.ok && invalid.error.code).toBe('invalid_request');
    const broken = await analyst.groundVisually({
      ...groundRequest(),
      image: { mediaType: 'image/png', data: 'AAAAAAAA' },
    });
    expect(!broken.ok && broken.error.message).toMatch(/does not decode/);
  });
});

describe('assertVisually', () => {
  it('answers with the screenshot and the frames, and never sends the expected answer', async () => {
    llm.setScript({
      response: {
        json: { answer: 'no', certainty: 'high', rationale: 'The row is static in every frame.' },
      },
    });
    const requests: AnalystRequestInfo[] = [];
    const frames = await Promise.all([1, 2, 3].map((seed) => image(640, 360, seed, 'image/jpeg')));
    const analyst = await analystFor(providerFor('openai', llm), { requests });
    const result = await analyst.assertVisually(assertRequest(frames));
    expect(result.ok && result.value.result.answer).toBe('no');
    expect(requests[0]?.images).toBe(4);
    const text = requests[0]?.request.messages[0]?.content[0];
    const question =
      text?.type === 'text'
        ? findDataBlocks(text.text).find((b) => b.name === 'question')
        : undefined;
    expect(JSON.parse(question?.body ?? '{}')).toEqual({
      stepId: 's5',
      question: 'Does the alarm row of conveyor C12 blink?',
    });
  });

  it('drops frames to fit the budget, then refuses', async () => {
    llm.setScript({
      response: { json: { answer: 'yes', certainty: 'low', rationale: 'Blinks.' } },
    });
    const frames = await Promise.all(
      [1, 2, 3, 4].map((seed) => image(1920, 1080, seed, 'image/jpeg')),
    );
    const requests: AnalystRequestInfo[] = [];
    const analyst = await analystFor(providerFor('anthropic', llm), {
      requests,
      limits: { visionTokenBudget: 8000 },
    });
    const result = await analyst.assertVisually(assertRequest(frames));
    expect(result.ok).toBe(true);
    expect(requests[0]?.omitted).toEqual({ frames: 2 });
    const tiny = await analystFor(providerFor('anthropic', llm), {
      limits: { visionTokenBudget: 2000 },
    });
    expect((await tiny.assertVisually(assertRequest(frames))).ok).toBe(false);
  });

  it('refuses invalid requests and undecodable screenshots', async () => {
    const analyst = await analystFor(providerFor('anthropic', llm));
    const invalid = await analyst.assertVisually({ ...assertRequest(), question: '' });
    expect(!invalid.ok && invalid.error.code).toBe('invalid_request');
    const broken = await analyst.assertVisually({
      ...assertRequest(),
      image: { mediaType: 'image/jpeg', data: 'AAAAAAAA' },
    });
    expect(!broken.ok && broken.error.code).toBe('invalid_request');
  });
});

describe('triage and report edge cases', () => {
  it('refuses an invalid packet without calling the provider', async () => {
    llm.clearRequests();
    const analyst = await analystFor(providerFor('anthropic', llm));
    const result = await analyst.triage({ ...packet(), attempt: 0 });
    expect(!result.ok && result.error.code).toBe('invalid_request');
    expect(llm.requests).toHaveLength(0);
  });

  it('leaves out frames whose image does not decode', async () => {
    llm.setScript({ response: { json: decision() } });
    const requests: AnalystRequestInfo[] = [];
    const p = packet();
    const analyst = await analystFor(providerFor('anthropic', llm), { requests });
    const good = await image(320, 200, 1, 'image/jpeg');
    const result = await analyst.triage(p, {
      frameImages: [
        { ref: p.frames[4]?.ref ?? '', image: good },
        { ref: p.frames[5]?.ref ?? '', image: { mediaType: 'image/jpeg', data: 'AAAAAAAA' } },
      ],
    });
    expect(result.ok).toBe(true);
    expect(requests[0]?.images).toBe(1);
  });

  it('maps provider failures to unavailable and invalid_request', async () => {
    const analyst = await analystFor(providerFor('openai', llm), {
      limits: { triageTimeoutMs: 300 },
    });
    llm.setScript({ fault: 'timeout' });
    const timedOut = await analyst.triage(packet());
    expect(!timedOut.ok && timedOut.error.code).toBe('unavailable');
    expect(!timedOut.ok && analystBreakReason(timedOut.error)).toBe('ANALYST_UNAVAILABLE');
    llm.setScript({ outcomes: [{ status: 400 }] });
    const rejected = await analyst.triage(packet());
    expect(!rejected.ok && rejected.error.code).toBe('invalid_request');
  });

  it('reports the repair call failing as unavailable', async () => {
    llm.setScript({ outcomes: [{ response: { json: { decision: 'NOPE' } } }, { status: 401 }] });
    const responses: AnalystResponseInfo[] = [];
    const analyst = await analystFor(providerFor('anthropic', llm), {
      onResponse: (info) => responses.push(info),
    });
    const result = await analyst.triage(packet());
    expect(!result.ok && result.error.code).toBe('unavailable');
    // The completed first call is still reported, so a failed escalation is metered.
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ operation: 'triage', attempt: 1 });
    expect(responses[0]?.inputTokens).toBeGreaterThan(0);
  });

  it('reports the usage of both calls when the answer stays invalid', async () => {
    llm.setScript({ response: { json: { decision: 'NOPE' } } });
    const responses: AnalystResponseInfo[] = [];
    const analyst = await analystFor(providerFor('openai', llm), {
      onResponse: (info) => responses.push(info),
    });
    const result = await analyst.triage(packet());
    expect(!result.ok && result.error.code).toBe('invalid_answer');
    expect(responses.map((info) => info.attempt)).toEqual([1, 2]);
    expect(responses.every((info) => info.outputTokens > 0)).toBe(true);
  });

  it('shrinks the quoted answer until the repair fits, escaping included', async () => {
    llm.setScript({ response: { json: decision() } });
    const first: AnalystRequestInfo[] = [];
    await (await analystFor(providerFor('anthropic', llm), { requests: first })).triage(packet());
    llm.clearRequests();
    // Every character escapes to six bytes inside the data block: 3,000 of them need
    // about 9,000 tokens, far beyond the 2,500 the budget keeps for the repair.
    llm.setScript({ response: { text: '<'.repeat(3000) } });
    const requests: AnalystRequestInfo[] = [];
    const analyst = await analystFor(providerFor('anthropic', llm), {
      requests,
      limits: { triageTokenBudget: (first[0]?.estimatedTokens ?? 0) + 2500 },
    });
    const result = await analyst.triage(packet());
    expect(!result.ok && result.error.code).toBe('invalid_answer');
    expect(llm.requests).toHaveLength(2);
    const repair = requests[1];
    expect(repair?.estimatedTokens).toBeLessThanOrEqual(repair?.budget ?? 0);
    const text = repair?.request.messages.at(-1)?.content[0];
    const previous =
      text?.type === 'text'
        ? findDataBlocks(text.text).find((b) => b.name === 'previous')
        : undefined;
    expect(previous?.body).toMatch(/more characters not shown/);
  });

  it('quotes a long rejected answer only in part', async () => {
    llm.setScript({ response: { text: `not json ${'x'.repeat(9000)}` } });
    const requests: AnalystRequestInfo[] = [];
    const analyst = await analystFor(providerFor('anthropic', llm), { requests });
    await analyst.triage(packet());
    const repair = requests[1]?.request.messages.at(-1)?.content[0];
    const previous =
      repair?.type === 'text'
        ? findDataBlocks(repair.text).find((b) => b.name === 'previous')
        : undefined;
    expect(previous?.body).toMatch(/more characters not shown/);
  });

  it('refuses a repair that would exceed the budget', async () => {
    llm.clearRequests();
    llm.setScript({ response: { text: `not json ${'z'.repeat(70_000)}` } });
    const first: AnalystRequestInfo[] = [];
    await (await analystFor(providerFor('anthropic', llm), { requests: first })).triage(packet());
    llm.clearRequests();
    // A budget the first request exactly fills leaves no room for any repair message.
    const analyst = await analystFor(providerFor('anthropic', llm), {
      limits: {
        repairReserveTokens: 0,
        repairAnswerChars: 100_000,
        triageTokenBudget: first[0]?.estimatedTokens ?? 0,
      },
    });
    const result = await analyst.triage(packet());
    expect(llm.requests).toHaveLength(1);
    expect(!result.ok && result.error.code).toBe('invalid_answer');
    expect(!result.ok && result.error.message).toMatch(/exceeds the budget/);
  });

  it('pins a report prompt version and refuses an unknown one', async () => {
    llm.setScript({ response: { json: draft() } });
    const analyst = await analystFor(providerFor('anthropic', llm));
    const pinned = await analyst.report({ ...reportInput(), promptVersion: 'r-1' });
    expect(pinned.ok && pinned.value.result.generatedBy.promptVersion).toBe('r-1');
    const unknown = await analyst.report({ ...reportInput(), promptVersion: 'r-9' });
    expect(!unknown.ok && unknown.error.code).toBe('invalid_request');
    const invalid = await analyst.report({ ...reportInput(), runId: '' });
    expect(!invalid.ok && invalid.error.code).toBe('invalid_request');
  });

  it('refuses a report whose outline alone exceeds the budget', async () => {
    const analyst = await analystFor(providerFor('anthropic', llm), {
      limits: { reportTokenBudget: 3000 },
    });
    const result = await analyst.report(reportInput());
    expect(!result.ok && result.error.code).toBe('invalid_request');
  });

  it('keeps key frames that fit and skips those without image', async () => {
    llm.setScript({ response: { json: draft() } });
    const requests: AnalystRequestInfo[] = [];
    const analyst = await analystFor(providerFor('anthropic', llm), { requests });
    const keyFrames = [
      { ref: 'art://runs/r1/key/a.png', stepId: 's2', image: await image(1920, 1080, 1) },
      { ref: 'art://runs/r1/key/b.png', stepId: null },
    ];
    const result = await analyst.report({ ...reportInput(), keyFrames });
    expect(result.ok).toBe(true);
    expect(requests[0]?.images).toBe(1);
  });
});

describe('LlmAnalyst.create', () => {
  const provider: LlmProvider = {
    kind: 'anthropic',
    complete: () => Promise.reject(new Error('unused')),
  };
  const scaler: ImageScaler = new SharpImageScaler();

  it('needs a template of each kind and a model', async () => {
    const prompts = await repositoryPrompts();
    const missing = LlmAnalyst.create({
      provider,
      scaler,
      prompts: prompts.filter((p) => p.kind !== 'report'),
      model: ' ',
    });
    expect(!missing.ok && missing.error).toEqual([
      'no report prompt is loaded',
      'the model id is empty',
    ]);
    const pinned = LlmAnalyst.create({
      provider,
      scaler,
      prompts,
      model: 'm',
      promptVersions: { triage: 't-7' },
    });
    expect(!pinned.ok && pinned.error).toEqual(['prompt t-7 (triage) is not loaded']);
    const created = LlmAnalyst.create({ provider, scaler, prompts, model: 'm' });
    expect(created.ok && created.value.promptVersions).toEqual({
      triage: 't-1',
      report: 'r-1',
      vision: 'v-1',
    });
  });
});
