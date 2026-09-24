import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestError, TypeSafeClient } from '@typesafe-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FAKE_JEV_API_KEY,
  FAKE_JEV_ERROR,
  FileCassetteStore,
  MemoryCassetteStore,
  cassetteFileName,
  recordingKey,
  cassetteKey,
  encodeBody,
  startFakeJev,
  type FakeJevServer,
  type JevRequestRecord,
} from '../src/index.js';

let server: FakeJevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const auth = { authorization: `Bearer ${DEFAULT_FAKE_JEV_API_KEY}` };
const body = { model: 'jev-1.13.0', state: 'page', questions: { q: { type: 'noul' } } };

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  if (server === undefined) throw new Error('no server');
  const response = await fetch(`${server.url}${path}`, init);
  const text = await response.text();
  return {
    status: response.status,
    json: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
    headers: response.headers,
  };
}

describe('fake Jev server', () => {
  it('routes unknown paths and methods, and rejects invalid JSON', async () => {
    server = await startFakeJev({ apiKeys: ['k1', 'k2'] });
    expect((await call('/v2/nothing')).status).toBe(404);
    const wrongMethod = await call('/v1/systemone', { headers: { authorization: 'Bearer k2' } });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('POST');
    expect(
      (
        await call('/v1/models', { method: 'POST', headers: { authorization: 'Bearer k1' } })
      ).headers.get('allow'),
    ).toBe('GET');
    expect((await call('/v1/models', { headers: { authorization: 'Basic k1' } })).json).toEqual({
      detail: 'Invalid API key',
    });
    expect((await call('/v1/models', { headers: { authorization: ' ' } })).json).toMatchObject({
      detail: expect.stringMatching(/Missing API key/) as unknown,
    });
    const broken = await call('/v1/systemone', {
      method: 'POST',
      headers: { authorization: 'Bearer k1' },
      body: '{nope',
    });
    expect(broken).toMatchObject({
      status: 422,
      json: { detail: [{ loc: ['body'], type: 'json_invalid' }] },
    });
    expect(server.requests.map((request) => request.outcome)).toEqual([
      'not-found',
      'not-found',
      'not-found',
      'unauthorized',
      'unauthorized',
      'invalid',
    ]);
    expect(server.requests.at(-1)?.body).toBe('{nope');
  });

  it('applies delays, custom error bodies and hangs from the queue', async () => {
    const records: JevRequestRecord[] = [];
    server = await startFakeJev({
      mode: { kind: 'scripted', script: { answers: { q: 0.2 } } },
      outcomes: [
        { delayMs: 60, status: 503, body: { detail: 'maintenance' } },
        { status: 429 },
        { hang: true },
      ],
      defaultRetryAfterMs: 2500,
      onRequest: (record) => records.push(record),
      clock: { now: () => 42 },
    });
    const started = Date.now();
    const delayed = await call('/v1/systemone', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
    expect(delayed).toMatchObject({ status: 503, json: { detail: 'maintenance' } });
    const limited = await call('/v1/systemone', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    });
    expect(limited.headers.get('retry-after-ms')).toBe('2500');
    expect(limited.headers.get('retry-after')).toBe('3');
    const hung = await call('/v1/systemone', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150),
    }).catch((error: unknown) => error);
    expect((hung as Error).name).toBe('TimeoutError');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(records.map((record) => [record.status, record.outcome, record.receivedAt])).toEqual([
      [503, 'injected-error', 42],
      [429, 'injected-error', 42],
      [0, 'hung', 42],
    ]);
    const answered = await call('/v1/systemone', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    });
    expect(answered.json).toMatchObject({ answers: { q: { type: 'noul', noul: 0.2 } } });
  });

  it('closes while a request hangs', async () => {
    server = await startFakeJev({ outcomes: [{ hang: true }] });
    const pending = call('/v1/systemone', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    }).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await server.close();
    expect(await pending).toBeInstanceOf(TypeError);
  });

  it('replays text and JSON cassettes, keyed on the canonical body', async () => {
    const path = '/v1/systemone';
    const store = new MemoryCassetteStore();
    const key = cassetteKey({
      method: 'POST',
      path,
      body: encodeBody(new TextEncoder().encode(JSON.stringify(body))),
    });
    await store.write({
      version: 1,
      key,
      recordedAt: '2026-09-24T00:00:00.000Z',
      request: { method: 'POST', path, headers: {}, body: { json: body } },
      response: { status: 500, headers: {}, body: { text: 'upstream exploded' } },
    });
    server = await startFakeJev({ mode: { kind: 'cassette', store } });
    const reordered = JSON.stringify({
      questions: body.questions,
      state: body.state,
      model: body.model,
    });
    const replay = await fetch(`${server.url}${path}`, {
      method: 'POST',
      headers: auth,
      body: reordered,
    });
    expect(replay.status).toBe(500);
    expect(replay.headers.get('content-type')).toBe('application/json');
    expect(await replay.text()).toBe('upstream exploded');
    expect(replay.headers.get('x-typesafe-request-id')).toBe('req_0001');
  });

  it('answers a failure of the fake itself with a non-retried 400 that carries the request id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-jev-corrupt-'));
    try {
      const path = '/v1/systemone';
      const key = recordingKey({
        method: 'POST',
        path,
        body: encodeBody(new TextEncoder().encode(JSON.stringify(body))),
      });
      writeFileSync(join(dir, cassetteFileName(key)), '{ corrupt');
      server = await startFakeJev({
        mode: { kind: 'cassette', store: new FileCassetteStore(dir) },
      });
      const raw = await call(path, { method: 'POST', headers: auth, body: JSON.stringify(body) });
      expect(raw.status).toBe(400);
      expect(raw.json).toMatchObject({ code: FAKE_JEV_ERROR });
      expect(raw.headers.get('x-typesafe-request-id')).toBe('req_0001');
      expect(server.requests[0]).toMatchObject({ status: 400, outcome: 'fake-error' });
      const sdk = new TypeSafeClient({
        apiKey: DEFAULT_FAKE_JEV_API_KEY,
        baseURL: server.url,
        logLevel: 'off',
      });
      const error = await sdk
        .systemOne({ model: body.model, state: body.state, questions: { q: { type: 'noul' } } })
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(error).toBeInstanceOf(BadRequestError);
      // One call, no retry.
      expect(server.requests).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers a throwing oracle truth function with FAKE_JEV_ERROR', async () => {
    server = await startFakeJev({
      mode: {
        kind: 'oracle',
        truth: () => {
          throw new Error('truth bug');
        },
      },
    });
    const failed = await call('/v1/systemone', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    });
    expect(failed).toMatchObject({ status: 400, json: { code: FAKE_JEV_ERROR } });
    expect(failed.headers.get('x-typesafe-request-id')).toBe('req_0001');
    expect(server.requests[0]?.error).toBe('truth bug');
  });

  it('exposes its log, queue and script through the admin endpoints', async () => {
    server = await startFakeJev({ version: '1.0.0' });
    expect((await call('/healthz')).json).toEqual({
      status: 'ok',
      service: 'fake-jev',
      mode: 'scripted',
      version: '1.0.0',
    });
    expect((await call('/_fake/script', { method: 'PUT', body: '[' })).status).toBe(400);
    expect(
      (
        await call('/_fake/script', {
          method: 'PUT',
          body: JSON.stringify({ answers: { q: true } }),
        })
      ).json,
    ).toEqual({ pending: 0 });
    // An invalid script or outcome list is refused and changes nothing.
    const badScript = await call('/_fake/script', {
      method: 'PUT',
      body: JSON.stringify({ answers: 5, rules: 'x' }),
    });
    expect(badScript.status).toBe(400);
    expect(badScript.json).toMatchObject({
      detail: expect.stringMatching(/^Jev script: /) as unknown,
    });
    expect((await call('/_fake/outcomes', { method: 'POST', body: '{}' })).status).toBe(400);
    const badOutcomes = await call('/_fake/outcomes', {
      method: 'POST',
      body: JSON.stringify([{ status: 'abc' }, 7]),
    });
    expect(badOutcomes.status).toBe(400);
    expect(
      (await call('/_fake/outcomes', { method: 'POST', body: JSON.stringify([{ status: 200 }]) }))
        .status,
    ).toBe(400);
    expect(
      (await call('/_fake/outcomes', { method: 'POST', body: JSON.stringify([{ status: 529 }]) }))
        .json,
    ).toEqual({ pending: 1 });
    expect(
      (await call('/v1/systemone', { method: 'POST', headers: auth, body: JSON.stringify(body) }))
        .status,
    ).toBe(529);
    expect(
      (await call('/v1/systemone', { method: 'POST', headers: auth, body: JSON.stringify(body) }))
        .json,
    ).toMatchObject({ answers: { q: { noul: 1 } } });
    const log = (await call('/_fake/requests')).json as { requests: JevRequestRecord[] };
    expect(log.requests.map((request) => request.status)).toEqual([529, 200]);
    expect(log.requests[0]?.headers.authorization).toBe('Bearer ***-key');
    expect((await call('/_fake/reset', { method: 'POST' })).status).toBe(200);
    expect(server.requests).toHaveLength(0);
    expect(() => {
      server?.enqueue({ status: 200 });
    }).toThrow(RangeError);
    expect(() => {
      server?.setScript({ rules: [{ match: {}, outcomes: [{ status: 302 }] }] });
    }).toThrow(/400 to 599, got 302/);
    server.enqueue({ status: 401 });
    expect(
      (await call('/v1/systemone', { method: 'POST', headers: auth, body: JSON.stringify(body) }))
        .status,
    ).toBe(401);
    server.setScript({ answers: { q: 0.5 } });
    expect(
      (await call('/v1/systemone', { method: 'POST', headers: auth, body: JSON.stringify(body) }))
        .json,
    ).toMatchObject({ answers: { q: { noul: 0.5 } } });
    server.clearRequests();
    expect(server.requests).toHaveLength(0);
    expect(server.mode).toBe('scripted');
  });

  it('refuses an oracle noise amplitude outside [0, 1] at start', async () => {
    await expect(
      startFakeJev({ mode: { kind: 'oracle', truth: () => ({}), noise: 2 } }),
    ).rejects.toThrow(/noise must lie in \[0, 1\], got 2/);
    await expect(
      startFakeJev({ mode: { kind: 'oracle', truth: () => ({}), noise: Number.NaN } }),
    ).rejects.toThrow(RangeError);
    await expect(startFakeJev({ outcomes: [{ status: 204 }] })).rejects.toThrow(RangeError);
  });

  it('refuses a script in other modes and reports oracle and script errors as 400', async () => {
    server = await startFakeJev({ mode: { kind: 'oracle', truth: () => ({ q: 'yes' }) } });
    expect((await call('/_fake/script', { method: 'PUT', body: '{}' })).status).toBe(400);
    const failed = await call('/v1/systemone', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    });
    expect(failed).toMatchObject({
      status: 400,
      json: {
        code: 'FAKE_JEV_SCRIPT',
        detail: expect.stringMatching(/^fake-jev: oracle truth/) as unknown,
      },
    });
    expect(server.requests[0]?.error).toMatch(/oracle truth/);
  });
});
