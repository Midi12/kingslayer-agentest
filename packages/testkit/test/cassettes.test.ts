import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CassetteMissError,
  FileCassetteStore,
  MemoryCassetteStore,
  cassetteDir,
  cassetteFileName,
  cassetteKey,
  createCassetteFetch,
  decodeBody,
  encodeBody,
  findKeyMaterial,
  maskCredential,
  parseJevScript,
  parseLlmScript,
  parseTargetMap,
  redactJson,
  replayResponse,
  sanitizeHeaders,
  startCassetteProxy,
  suiteSlug,
  type CassetteEntry,
  type FetchLike,
} from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'argus-cassettes-'));
  dirs.push(dir);
  return dir;
}

/** An upstream fetch that answers from a function and counts its calls. */
function upstream(
  answer: (url: string, init?: RequestInit) => Response,
): FetchLike & { calls: number } {
  const fn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    fn.calls += 1;
    return Promise.resolve(answer(input instanceof Request ? input.url : input.toString(), init));
  };
  fn.calls = 0;
  return fn;
}

describe('cassette entries', () => {
  it('encodes JSON, text and binary bodies and decodes them back', () => {
    const enc = new TextEncoder();
    expect(encodeBody(undefined)).toBeNull();
    expect(encodeBody(new Uint8Array())).toBeNull();
    expect(encodeBody(enc.encode('{"b":1,"a":2}'))).toEqual({ json: { b: 1, a: 2 } });
    expect(encodeBody(enc.encode('plain'))).toEqual({ text: 'plain' });
    const binary = new Uint8Array([0xff, 0xfe, 0x00, 0x10]);
    const encoded = encodeBody(binary);
    expect(encoded).toEqual({ base64: '//4AEA==' });
    expect(decodeBody(encoded)).toEqual(binary);
    expect(new TextDecoder().decode(decodeBody({ json: { a: 1 } }))).toBe('{"a":1}');
    expect(new TextDecoder().decode(decodeBody({ text: 'plain' }))).toBe('plain');
    expect(decodeBody(null)).toBeUndefined();
  });

  it('keys on method, path and canonical body only', () => {
    const a = cassetteKey({ method: 'post', path: '/v1/x?y=1', body: { json: { a: 1, b: 2 } } });
    expect(cassetteKey({ method: 'POST', path: '/v1/x?y=1', body: { json: { b: 2, a: 1 } } })).toBe(
      a,
    );
    expect(
      cassetteKey({ method: 'POST', path: '/v1/x?y=2', body: { json: { a: 1, b: 2 } } }),
    ).not.toBe(a);
    expect(cassetteFileName(a)).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  it('names suite directories safely', () => {
    expect(suiteSlug('M06 grounding / French')).toBe('m06-grounding-french');
    expect(() => suiteSlug('///')).toThrow(/no letters or digits/);
    expect(cassetteDir('/root', 'Suite A')).toBe('/root/suite-a');
  });

  it('redacts keys, masks credentials and describes inline images', () => {
    expect(
      sanitizeHeaders({
        Authorization: 'Bearer x',
        'X-Trace': 'Bearer abcdefghijkl',
        Accept: 'json',
      }),
    ).toEqual({
      'x-trace': '[REDACTED]',
      accept: 'json',
    });
    expect(maskCredential('Bearer abcdefghijklmnop')).toBe('Bearer ***mnop');
    expect(maskCredential('short')).toBe('***');
    expect(redactJson({ a: ['data:image/png;base64,AAAA', 'data:;base64,AA=='], b: 3 })).toEqual({
      a: [
        expect.stringMatching(
          /^\[inline image\/png: 3 bytes, base64 sha256:[0-9a-f]{64}\]$/,
        ) as unknown,
        expect.stringMatching(/^\[inline data: 1 bytes/) as unknown,
      ],
      b: 3,
    });
    expect(redactJson({ type: 'base64', data: 'AAA=' })).toMatchObject({
      data: expect.stringMatching(/^\[inline data: 2 bytes/) as unknown,
    });
    expect(findKeyMaterial('digest sha256:' + 'a'.repeat(64))).toEqual([]);
    expect(findKeyMaterial('a'.repeat(64)).map((match) => match.pattern)).toEqual(['long-hex']);
  });
});

describe('cassette stores', () => {
  const entry = (key: string): CassetteEntry => ({
    version: 1,
    key,
    recordedAt: '2026-09-24T00:00:00.000Z',
    request: { method: 'GET', path: '/', headers: {}, body: null },
    response: { status: 204, headers: {}, body: null },
  });
  const key = `sha256:${'1'.repeat(64)}`;

  it('keeps entries in memory', async () => {
    const store = new MemoryCassetteStore([entry(key)]);
    expect(await store.keys()).toEqual([key]);
    expect(await store.read(key)).toEqual(entry(key));
    expect(await store.read('missing')).toBeUndefined();
  });

  it('keeps entries as files, lists only cassette files, and rejects invalid files', async () => {
    const dir = tempDir();
    const store = new FileCassetteStore(join(dir, 'suite'));
    expect(await store.keys()).toEqual([]);
    expect(await store.read(key)).toBeUndefined();
    await store.write(entry(key));
    writeFileSync(join(dir, 'suite', 'notes.txt'), 'ignored');
    expect(await store.keys()).toEqual([key]);
    const other = `sha256:${'2'.repeat(64)}`;
    writeFileSync(join(dir, 'suite', cassetteFileName(other)), JSON.stringify({ version: 2 }));
    await expect(store.read(other)).rejects.toThrow(/not a valid entry/);
    mkdirSync(join(dir, 'suite', cassetteFileName(`sha256:${'3'.repeat(64)}`)));
    await expect(store.read(`sha256:${'3'.repeat(64)}`)).rejects.toThrow();
    writeFileSync(join(dir, 'plain-file'), '');
    await expect(new FileCassetteStore(join(dir, 'plain-file')).keys()).rejects.toThrow();
  });

  it('replays empty-body statuses without a body', () => {
    const response = replayResponse({
      ...entry(key),
      response: { status: 204, headers: { 'content-length': '0', 'x-a': 'b' }, body: null },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('x-a')).toBe('b');
    expect(response.headers.get('x-argus-cassette')).toBe('hit');
  });
});

describe('createCassetteFetch', () => {
  it('auto mode records misses and replays hits', async () => {
    const real = upstream(
      () =>
        new Response('{"n":1}', {
          status: 201,
          headers: { 'content-type': 'application/json', 'content-length': '7' },
        }),
    );
    const store = new MemoryCassetteStore();
    const cassette = createCassetteFetch({
      store,
      mode: 'auto',
      fetch: real,
      clock: { now: () => 0 },
    });
    const first = await cassette('http://api.test/v1/x', { method: 'POST', body: '{"q":1}' });
    expect(first.status).toBe(201);
    expect(first.headers.get('x-argus-cassette')).toBe('recorded');
    const second = await cassette(new URL('http://other.host/v1/x'), {
      method: 'POST',
      body: '{ "q": 1 }',
    });
    expect(await second.json()).toEqual({ n: 1 });
    expect(second.headers.get('x-argus-cassette')).toBe('hit');
    expect(real.calls).toBe(1);
    expect(cassette.stats).toEqual({ hits: 1, misses: 0, recorded: 1 });
    const [key] = await store.keys();
    expect((await store.read(key ?? ''))?.recordedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('keys every body kind, including Request objects', async () => {
    const real = upstream((url) => new Response(url));
    const cassette = createCassetteFetch({
      store: new MemoryCassetteStore(),
      mode: 'record',
      fetch: real,
    });
    await cassette('http://a/1', { method: 'PUT', body: new Uint8Array([1, 2]) });
    await cassette('http://a/2', { method: 'PUT', body: new Uint8Array([1, 2, 3]).buffer });
    await cassette('http://a/3', { method: 'PUT', body: new URLSearchParams({ a: '1' }) });
    await cassette('http://a/4', { method: 'PUT', body: new Blob(['blob']) });
    await cassette(
      new Request('http://a/5', { method: 'POST', body: 'from request', headers: { 'x-h': '1' } }),
    );
    await cassette('http://a/6');
    const stream = new ReadableStream<Uint8Array>();
    await expect(
      cassette('http://a/7', { method: 'POST', body: stream, duplex: 'half' }),
    ).rejects.toThrow(/streamed request body/);
    expect(real.calls).toBe(6);
    const empty = await createCassetteFetch({
      store: new MemoryCassetteStore(),
      mode: 'record',
      fetch: upstream(() => new Response(null, { status: 204 })),
    })('http://a/8');
    expect(empty.status).toBe(204);
  });

  it('throws CASSETTE_MISS with the key, method and path in strict mode', async () => {
    const cassette = createCassetteFetch({
      store: tempDir(),
      mode: 'strict',
      fetch: upstream(() => new Response('x')),
    });
    const error = await cassette('http://a/v1/y?z=1', { method: 'DELETE' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CassetteMissError);
    expect(error).toMatchObject({ code: 'CASSETTE_MISS', method: 'DELETE', path: '/v1/y?z=1' });
  });
});

describe('startCassetteProxy', () => {
  it('answers 502 when the upstream fails, and replays GET requests', async () => {
    const store = new MemoryCassetteStore();
    const failing = upstream(() => {
      throw new Error('connection refused');
    });
    const broken = await startCassetteProxy({
      upstream: 'http://upstream.test/',
      store,
      mode: 'record',
      fetch: failing,
    });
    try {
      const response = await fetch(`${broken.url}/v1/models`);
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        error: { type: 'upstream_error', message: 'connection refused' },
      });
      expect(await (await fetch(`${broken.url}/healthz`)).json()).toEqual({
        status: 'ok',
        service: 'cassette-proxy',
        mode: 'record',
      });
    } finally {
      await broken.close();
    }
    const real = upstream(
      (url) =>
        new Response(JSON.stringify({ url }), { headers: { 'content-type': 'application/json' } }),
    );
    const recording = await startCassetteProxy({
      upstream: 'http://upstream.test',
      store,
      mode: 'auto',
      fetch: real,
    });
    try {
      const first = await (await fetch(`${recording.url}/v1/models?limit=5`)).json();
      const second = await (await fetch(`${recording.url}/v1/models?limit=5`)).json();
      expect(first).toEqual({ url: 'http://upstream.test/v1/models?limit=5' });
      expect(second).toEqual(first);
      expect(real.calls).toBe(1);
      expect(recording.requests.map((request) => request.cassette)).toEqual(['recorded', 'hit']);
      const empty = await fetch(`${recording.url}/v1/empty`, { method: 'POST' });
      expect(empty.status).toBe(200);
    } finally {
      await recording.close();
    }
  });
});

describe('script files', () => {
  it('accepts valid scripts and target maps', () => {
    expect(
      parseJevScript({
        answers: { q: true, 'expect_*': 0.9 },
        rules: [{ match: { questions: ['q'] }, outcomes: [{ status: 429, retryAfterMs: 10 }] }],
        fallback: 'uniform',
      }).ok,
    ).toBe(true);
    expect(
      parseLlmScript({
        response: { text: 'x' },
        rules: [{ match: { shape: 'openai' }, fault: 'timeout' }],
        outcomes: [{ fault: 'refusal' }],
      }).ok,
    ).toBe(true);
    expect(parseTargetMap({ 'Start C12': 'c17', Missing: null })).toEqual({
      ok: true,
      value: { 'Start C12': 'c17', Missing: null },
    });
  });

  it('names the first problem of an invalid file', () => {
    expect(parseJevScript({ answers: { q: { choice: 3 } } })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Jev script: \/answers\/q/) as unknown,
    });
    expect(parseLlmScript({ fault: 'explode' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^LLM script: \/fault/) as unknown,
    });
    expect(parseTargetMap([])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^oracle targets: \//) as unknown,
    });
  });
});
