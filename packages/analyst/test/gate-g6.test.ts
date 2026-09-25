/**
 * M07-G6: both provider adapters honour the port. One contract suite runs against the
 * Anthropic adapter and the OpenAI-compatible adapter on the fake LLM: JSON mode,
 * images, timeout, 5xx and 429 retry within a bounded budget, no retry on client
 * errors, usage accounting, stop reasons and model reporting.
 */
import type { InlineImage } from '@argus/contracts';
import { recordGateMetrics, startFakeLlm, type FakeLlmServer, type LlmShape } from '@argus/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AnthropicProvider,
  OpenAiCompatibleProvider,
  type LlmProvider,
  type LlmRequest,
} from '../src/index.js';
import { image, InstantClock, providerFor, SHAPES } from './support.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'score'],
  properties: { answer: { type: 'string' }, score: { type: 'integer' } },
};

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: 'fake-llm',
    system: 'Answer with JSON.',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'What is the state of conveyor C12?' }] },
    ],
    jsonSchema: { name: 'state', schema: SCHEMA },
    maxTokens: 256,
    timeoutMs: 5000,
    ...overrides,
  };
}

type Contract = (shape: LlmShape, llm: FakeLlmServer) => Promise<void>;

let png: InlineImage;
let jpeg: InlineImage;

const CONTRACTS: Readonly<Record<string, Contract>> = {
  'json mode sends the schema and parses the answer': async (shape, llm) => {
    llm.setScript({ response: { json: { answer: 'running', score: 3 } } });
    const result = await providerFor(shape, llm).complete(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.json).toEqual({ answer: 'running', score: 3 });
    expect(result.value.stopReason).toBe('end');
    const view = llm.requests[0]?.view;
    expect(view?.jsonMode).toBe('schema');
    expect(view?.jsonSchema).toEqual(SCHEMA);
    expect(view?.system).toBe('Answer with JSON.');
  },
  'plain text without a schema': async (shape, llm) => {
    llm.setScript({ response: { text: 'C12 is running.' } });
    const { jsonSchema: _drop, ...plain } = request();
    const result = await providerFor(shape, llm).complete(plain);
    expect(result.ok && result.value.text).toBe('C12 is running.');
    expect(result.ok && result.value.json).toBeUndefined();
    expect(llm.requests[0]?.view?.jsonMode).toBe('none');
  },
  'images are sent in order': async (shape, llm) => {
    llm.setScript({ response: { json: { answer: 'two', score: 2 } } });
    const result = await providerFor(shape, llm).complete(
      request({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Frame one:' },
              { type: 'image', image: png },
              { type: 'text', text: 'Frame two:' },
              { type: 'image', image: jpeg },
            ],
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    expect(llm.requests[0]?.view?.messages[0]?.images).toBe(2);
    const body = JSON.stringify(llm.requests[0]?.body);
    if (shape === 'anthropic') {
      expect(body).toContain('"media_type":"image/png"');
      expect(body).toContain('"media_type":"image/jpeg"');
    } else {
      expect(body).toContain('data:image/png;base64,');
      expect(body).toContain('data:image/jpeg;base64,');
    }
    expect(body.indexOf(png.data)).toBeLessThan(body.indexOf(jpeg.data));
  },
  'a call that outlives its timeout is unavailable and not retried': async (shape, llm) => {
    llm.setScript({ fault: 'timeout' });
    const started = Date.now();
    const result = await providerFor(shape, llm).complete(request({ timeoutMs: 400 }));
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unavailable');
      expect(result.error.attempts).toBe(1);
    }
    expect(elapsed).toBeLessThan(3000);
    expect(llm.requests).toHaveLength(1);
  },
  '5xx is retried and then succeeds': async (shape, llm) => {
    llm.setScript({
      response: { json: { answer: 'ok', score: 1 } },
      outcomes: [{ status: 500 }, { status: 503 }],
    });
    const clock = new InstantClock();
    const result = await providerFor(shape, llm, { clock }).complete(request());
    expect(result.ok && result.value.attempts).toBe(3);
    expect(llm.requests.map((r) => r.status)).toEqual([500, 503, 200]);
    expect(clock.sleeps).toHaveLength(2);
  },
  '429 and 529 are retried': async (shape, llm) => {
    llm.setScript({
      response: { json: { answer: 'ok', score: 1 } },
      outcomes: [{ status: 429 }, { status: 529 }],
    });
    const result = await providerFor(shape, llm, { clock: new InstantClock() }).complete(request());
    expect(result.ok && result.value.attempts).toBe(3);
  },
  'retries stop at the attempt budget': async (shape, llm) => {
    llm.setScript({ outcomes: Array.from({ length: 6 }, () => ({ status: 503 })) });
    const result = await providerFor(shape, llm, {
      clock: new InstantClock(),
      retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50 },
    }).complete(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unavailable');
      expect(result.error.attempts).toBe(3);
      expect(result.error.status).toBe(503);
    }
    expect(llm.requests).toHaveLength(3);
  },
  'retries stop at the time budget': async (shape, llm) => {
    llm.setScript({ outcomes: Array.from({ length: 6 }, () => ({ status: 500 })) });
    const clock = new InstantClock();
    const result = await providerFor(shape, llm, {
      clock,
      retry: { maxAttempts: 10, budgetMs: 2500, baseDelayMs: 1000, maxDelayMs: 8000 },
    }).complete(request());
    expect(result.ok).toBe(false);
    // Waits of 1 s then 2 s would pass 2.5 s: one retry only.
    expect(llm.requests).toHaveLength(2);
    expect(clock.sleeps).toEqual([1000]);
  },
  'client errors are not retried': async (shape, llm) => {
    llm.setScript({ outcomes: [{ status: 400 }] });
    const result = await providerFor(shape, llm, { clock: new InstantClock() }).complete(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_request');
      expect(result.error.attempts).toBe(1);
    }
    expect(llm.requests).toHaveLength(1);
  },
  'usage is accounted as reported': async (shape, llm) => {
    llm.setScript({
      response: {
        json: { answer: 'ok', score: 1 },
        usage: { inputTokens: 1234, outputTokens: 56 },
      },
    });
    const result = await providerFor(shape, llm).complete(request());
    expect(result.ok && result.value.usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
  },
  'refusal and output limit are reported as stop reasons': async (shape, llm) => {
    const provider = providerFor(shape, llm);
    llm.setScript({ response: { json: { answer: 'x', score: 0 } }, fault: 'refusal' });
    const refused = await provider.complete(request());
    expect(refused.ok && refused.value.stopReason).toBe('refusal');
    expect(refused.ok && refused.value.json).toBeUndefined();
    llm.setScript({ response: { json: { answer: 'x', score: 0 } }, fault: 'over-long' });
    const cut = await provider.complete(request({ maxTokens: 64 }));
    expect(cut.ok && cut.value.stopReason).toBe('max_tokens');
    expect(cut.ok && cut.value.usage.outputTokens).toBe(64);
  },
  'model, max tokens and temperature pass through': async (shape, llm) => {
    llm.setScript({ response: { json: { answer: 'ok', score: 1 } } });
    const provider: LlmProvider = providerFor(shape, llm);
    const withTemperature = await provider.complete(
      request({ model: 'claude-sonnet-5', temperature: 0, maxTokens: 777 }),
    );
    expect(withTemperature.ok && withTemperature.value.model).toBe('claude-sonnet-5');
    const body = llm.requests[0]?.body as Record<string, unknown>;
    expect(body.temperature).toBe(0);
    expect(llm.requests[0]?.view?.maxTokens).toBe(777);
    await provider.complete(request());
    expect((llm.requests[1]?.body as Record<string, unknown>).temperature).toBeUndefined();
  },
  'a wrong key is unavailable without retries': async (shape, llm) => {
    llm.setScript({ response: { json: { answer: 'ok', score: 1 } } });
    const wrong: LlmProvider =
      shape === 'anthropic'
        ? new AnthropicProvider({ apiKey: 'wrong', baseURL: llm.url, refusalFallback: false })
        : new OpenAiCompatibleProvider({ apiKey: 'wrong', baseURL: `${llm.url}/v1` });
    const result = await wrong.complete(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unavailable');
      expect(result.error.status).toBe(401);
      expect(result.error.attempts).toBe(1);
    }
  },
};

let llm: FakeLlmServer;

beforeAll(async () => {
  llm = await startFakeLlm({ timeoutHoldMs: 5000 });
  png = await image(64, 48, 1, 'image/png');
  jpeg = await image(64, 48, 2, 'image/jpeg');
});

afterAll(async () => {
  await llm.close();
});

describe('M07-G6 both adapters honour the port', () => {
  const passed: Record<string, number> = { anthropic: 0, openai: 0 };
  const failed: string[] = [];
  for (const shape of SHAPES) {
    for (const [name, contract] of Object.entries(CONTRACTS)) {
      it(`${shape}: ${name}`, async () => {
        llm.clearRequests();
        try {
          await contract(shape, llm);
          passed[shape] = (passed[shape] ?? 0) + 1;
        } catch (error) {
          failed.push(`${shape}: ${name}`);
          throw error;
        }
      });
    }
  }
  it('records the metrics', () => {
    recordGateMetrics({
      adapters: SHAPES.length,
      contracts: Object.keys(CONTRACTS).length,
      anthropicPassed: passed.anthropic ?? 0,
      openaiPassed: passed.openai ?? 0,
      failures: failed.length,
    });
    expect(failed).toEqual([]);
    expect(passed.anthropic).toBe(Object.keys(CONTRACTS).length);
    expect(passed.openai).toBe(Object.keys(CONTRACTS).length);
  });
});
