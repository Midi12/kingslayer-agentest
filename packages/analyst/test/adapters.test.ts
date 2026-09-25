/** Adapter options beyond the contract suite: sharp, prompt files, dialects, failures. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_FAKE_LLM_API_KEY, startFakeLlm, type FakeLlmServer } from '@argus/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AnthropicProvider,
  OpenAiCompatibleProvider,
  REFUSAL_FALLBACK_BETA,
  SharpImageScaler,
  classify,
  loadPromptDirectory,
  type LlmRequest,
} from '../src/index.js';
import { InstantClock, image, PROMPTS_DIR } from './support.js';

const REQUEST: LlmRequest = {
  model: 'fake-llm',
  system: 'Answer with JSON.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'State?' }] }],
  jsonSchema: {
    name: 'state',
    schema: { type: 'object', properties: { a: { type: 'integer' } }, additionalProperties: false },
  },
  maxTokens: 100,
  timeoutMs: 5000,
};

let llm: FakeLlmServer;

beforeAll(async () => {
  llm = await startFakeLlm({ script: { response: { json: { a: 1 } } } });
});

afterAll(async () => {
  await llm.close();
});

describe('SharpImageScaler', () => {
  const scaler = new SharpImageScaler();

  it('scales the long edge down in every media type and passes small images through', async () => {
    for (const mediaType of ['image/png', 'image/jpeg', 'image/webp'] as const) {
      const big = await image(3000, 1000, 1, mediaType);
      const fitted = await scaler.fit(big, 1280);
      expect(fitted.ok).toBe(true);
      if (!fitted.ok) continue;
      expect([fitted.value.width, fitted.value.height]).toEqual([1280, 427]);
      expect(fitted.value.image.mediaType).toBe(mediaType);
      const meta = await sharp(Buffer.from(fitted.value.image.data, 'base64')).metadata();
      expect(meta.format).toBe(mediaType.slice('image/'.length));
    }
    const small = await image(640, 480, 2);
    const same = await scaler.fit(small, 1280);
    expect(same.ok && same.value.image).toBe(small);
  });

  it('reports an image that does not decode', async () => {
    const broken = await scaler.fit({ mediaType: 'image/png', data: 'AAAAAAAA' }, 1280);
    expect(!broken.ok && broken.error.code).toBe('invalid_image');
  });
});

describe('loadPromptDirectory', () => {
  it('loads the repository prompts', async () => {
    const loaded = await loadPromptDirectory(PROMPTS_DIR);
    expect(loaded.ok && loaded.value.map((p) => p.id).sort()).toEqual(['r-1', 't-1', 'v-1']);
  });

  it('reports a missing directory, an empty one and a broken template', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'argus-prompts-'));
    try {
      expect((await loadPromptDirectory(join(dir, 'missing'))).ok).toBe(false);
      await writeFile(join(dir, 'notes.md'), 'not a template');
      expect(await loadPromptDirectory(dir)).toEqual({
        ok: false,
        error: [`${dir} holds no prompt template`],
      });
      await writeFile(join(dir, 't-1.md'), '=== system ===\nno declaration\n');
      const broken = await loadPromptDirectory(dir);
      expect(!broken.ok && broken.error.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('AnthropicProvider', () => {
  it('sends server-side refusal fallbacks when enabled', async () => {
    llm.clearRequests();
    const provider = new AnthropicProvider({
      apiKey: DEFAULT_FAKE_LLM_API_KEY,
      baseURL: llm.url,
      refusalFallback: true,
    });
    const result = await provider.complete(REQUEST);
    expect(result.ok && result.value.json).toEqual({ a: 1 });
    const record = llm.requests[0];
    expect((record?.body as Record<string, unknown>).fallbacks).toBe('default');
    expect(record?.headers['anthropic-beta']).toBe(REFUSAL_FALLBACK_BETA);
  });

  it('can leave structured output to the prompt', async () => {
    llm.clearRequests();
    const provider = new AnthropicProvider({
      apiKey: DEFAULT_FAKE_LLM_API_KEY,
      baseURL: llm.url,
      structuredOutput: false,
      refusalFallback: false,
    });
    const params = provider.params(REQUEST);
    expect(params.output_config).toBeUndefined();
    expect((await provider.complete(REQUEST)).ok).toBe(true);
    expect(llm.requests[0]?.view?.jsonMode).toBe('none');
  });

  it('classifies SDK failures', () => {
    expect(classify(new Anthropic.APIUserAbortError(), 0, 10)).toMatchObject({
      kind: 'fatal',
      code: 'unavailable',
    });
    expect(classify(new Anthropic.APIConnectionError({ message: 'reset' }), 0, 10)).toMatchObject({
      kind: 'retryable',
    });
    const headers = new Headers({ 'retry-after': '3' });
    expect(
      classify(
        Anthropic.APIError.generate(429, { error: { message: 'slow down' } }, 'slow down', headers),
        0,
        10,
      ),
    ).toMatchObject({
      kind: 'retryable',
      status: 429,
      retryAfterMs: 3000,
    });
    expect(
      classify(Anthropic.APIError.generate(403, undefined, 'forbidden', new Headers()), 0, 10),
    ).toMatchObject({ code: 'unavailable', status: 403 });
    expect(
      classify(Anthropic.APIError.generate(404, undefined, 'no model', new Headers()), 0, 10),
    ).toMatchObject({ code: 'invalid_request' });
    expect(classify('weird', 0, 10)).toMatchObject({
      kind: 'fatal',
      message: 'unexpected provider failure: weird',
    });
  });
});

describe('OpenAiCompatibleProvider dialects', () => {
  it('uses Azure-style api-key auth, query parameters and max_completion_tokens', async () => {
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
      [];
    const fetchStub: typeof fetch = (input, init) => {
      calls.push({
        url: input instanceof Request ? input.url : input.toString(),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(init?.body as string) as Record<string, unknown>,
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"a":2}' }, finish_reason: 'stop' }] }),
          { status: 200 },
        ),
      );
    };
    const provider = new OpenAiCompatibleProvider({
      baseURL: 'https://example.openai.azure.com/openai/deployments/analyst/',
      apiKey: 'k',
      auth: 'api-key',
      query: { 'api-version': '2024-10-21' },
      maxTokensField: 'max_completion_tokens',
      structuredOutput: 'json_object',
      fetch: fetchStub,
    });
    const result = await provider.complete(REQUEST);
    expect(result.ok && result.value).toMatchObject({
      json: { a: 2 },
      model: 'fake-llm',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(calls[0]?.url).toBe(
      'https://example.openai.azure.com/openai/deployments/analyst/chat/completions?api-version=2024-10-21',
    );
    expect(calls[0]?.headers['api-key']).toBe('k');
    expect(calls[0]?.headers.authorization).toBeUndefined();
    expect(calls[0]?.body.max_completion_tokens).toBe(100);
    expect(calls[0]?.body.response_format).toEqual({ type: 'json_object' });
  });

  it('works keyless and without a response format, and reports filtered content as a refusal', async () => {
    let headers: Record<string, string> = {};
    let body: Record<string, unknown> = {};
    const provider = new OpenAiCompatibleProvider({
      baseURL: 'http://127.0.0.1:1/v1',
      structuredOutput: 'none',
      fetch: (_input, init) => {
        headers = init?.headers as Record<string, string>;
        body = JSON.parse(init?.body as string) as Record<string, unknown>;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model: 'qwen',
              choices: [{ message: { content: null }, finish_reason: 'content_filter' }],
            }),
          ),
        );
      },
    });
    const result = await provider.complete(REQUEST);
    expect(result.ok && result.value).toMatchObject({
      stopReason: 'refusal',
      text: '',
      model: 'qwen',
    });
    expect(headers.authorization).toBeUndefined();
    expect(body.response_format).toBeUndefined();
  });

  it('treats a 200 without a completion as unavailable and a dropped connection as retryable', async () => {
    const empty = new OpenAiCompatibleProvider({
      baseURL: 'http://127.0.0.1:1/v1',
      fetch: () => Promise.resolve(new Response('<html>proxy</html>')),
    });
    const emptyResult = await empty.complete(REQUEST);
    expect(!emptyResult.ok && emptyResult.error.code).toBe('unavailable');
    let calls = 0;
    const dropped = new OpenAiCompatibleProvider({
      baseURL: 'http://127.0.0.1:1/v1',
      clock: new InstantClock(),
      retry: { maxAttempts: 2 },
      fetch: () => {
        calls++;
        return Promise.reject(new TypeError('fetch failed'));
      },
    });
    const droppedResult = await dropped.complete(REQUEST);
    expect(!droppedResult.ok && droppedResult.error.message).toMatch(
      /connection failed: fetch failed/,
    );
    expect(calls).toBe(2);
    const html = new OpenAiCompatibleProvider({
      baseURL: 'http://127.0.0.1:1/v1',
      clock: new InstantClock(),
      retry: { maxAttempts: 1 },
      fetch: () =>
        Promise.resolve(
          new Response('bad gateway', { status: 502, headers: { 'retry-after': '1' } }),
        ),
    });
    const htmlResult = await html.complete(REQUEST);
    expect(!htmlResult.ok && htmlResult.error.message).toMatch(/HTTP 502: bad gateway/);
    const plain = new OpenAiCompatibleProvider({
      baseURL: 'http://127.0.0.1:1/v1',
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ message: 'model not found' }), { status: 404 }),
        ),
    });
    const plainResult = await plain.complete(REQUEST);
    expect(!plainResult.ok && plainResult.error).toMatchObject({
      code: 'invalid_request',
      message: 'HTTP 404: model not found',
    });
  });

  it('reports a refusal field in the message', async () => {
    const provider = new OpenAiCompatibleProvider({
      baseURL: 'http://127.0.0.1:1/v1',
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                { message: { content: null, refusal: 'I cannot help.' }, finish_reason: 'stop' },
              ],
              usage: { prompt_tokens: 12, completion_tokens: 3 },
            }),
          ),
        ),
    });
    const result = await provider.complete(REQUEST);
    expect(result.ok && result.value).toMatchObject({
      stopReason: 'refusal',
      text: 'I cannot help.',
      usage: { inputTokens: 12, outputTokens: 3 },
    });
    expect(result.ok && result.value.json).toBeUndefined();
  });
});
