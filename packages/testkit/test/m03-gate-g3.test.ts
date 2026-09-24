/**
 * M03-G3: cassettes are strict. An unrecorded request fails with CASSETTE_MISS and opens
 * zero outbound connections, through the fetch wrapper, the proxy and the fake Jev
 * server in cassette mode; recorded files contain nothing matching the key patterns, no
 * planted secret and no credential header.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundError, TypeSafeClient } from '@typesafe-ai/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CASSETTE_MISS,
  CassetteMissError,
  DEFAULT_FAKE_JEV_API_KEY,
  FileCassetteStore,
  createCassetteFetch,
  findKeyMaterial,
  startCassetteProxy,
  startFakeJev,
} from '../src/index.js';
import { recordGateMetrics } from '../src/gate-metrics.js';

const metrics = {
  missCases: 0,
  missesDetected: 0,
  outboundConnections: 0,
  replayHits: 0,
  filesScanned: 0,
  keyPatternMatches: 0,
  plantedSecretsFound: 0,
  credentialHeadersFound: 0,
};

afterAll(() => {
  recordGateMetrics({ ...metrics });
});

// Secrets are assembled at run time so this file itself holds no literal key.
const piece = (...parts: string[]): string => parts.join('');
const SECRETS = {
  anthropic: piece('sk-', 'ant-api03-', 'Zq8vT4mN2pR7wK1xY5bC9dF3gH6jL0nM'),
  openai: piece('sk-', 'proj-', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'),
  typesafe: piece('tsk', '-', 'live_9f8e7d6c5b4a39281706f5e4d3c2b1a0'),
  hex: piece('3f5a9c2e8b7d1046', 'aa3e9f0c5d2b8e71', '6c4a0f9e3d2b1c8a'),
  base64: piece('QWxhZGRpbjpvcGVu', 'IHNlc2FtZSBhbmQg', 'bW9yZTEyMzQ1Njc4OQ=='),
  bearer: piece('eyJhbGciOi', 'JIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.', 'c2lnbmF0dXJl'),
};

/** Upstream on loopback that counts every TCP connection it accepts and echoes JSON. */
let upstream: Server;
let upstreamUrl = '';
let accepted = 0;

beforeAll(async () => {
  upstream = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      response.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': `session=${SECRETS.hex}`,
        'x-upstream-token': SECRETS.openai,
      });
      response.end(
        JSON.stringify({
          echoed: body.length,
          path: request.url,
          note: `issued ${SECRETS.typesafe} for the next call`,
          digest: `sha256:${'ab'.repeat(32)}`,
        }),
      );
    });
  });
  upstream.on('connection', () => {
    accepted += 1;
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  upstreamUrl = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    upstream.close(() => {
      resolve();
    });
    upstream.closeAllConnections();
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'argus-m03-g3-'));
  dirs.push(dir);
  return dir;
}

/** Counts client socket connects made while `action` runs, and upstream accepts. */
async function outbound<T>(
  action: () => Promise<T>,
): Promise<{ result: T | undefined; error: unknown; connects: number; accepts: number }> {
  const prototype = net.Socket.prototype as unknown as {
    connect: (this: net.Socket, ...args: unknown[]) => net.Socket;
  };
  const original = prototype.connect;
  let connects = 0;
  prototype.connect = function patched(this: net.Socket, ...args: unknown[]) {
    connects += 1;
    return original.apply(this, args);
  };
  const before = accepted;
  try {
    const result = await action();
    return { result, error: undefined, connects, accepts: accepted - before };
  } catch (error) {
    return { result: undefined, error, connects, accepts: accepted - before };
  } finally {
    prototype.connect = original;
  }
}

function secretRequest(path: string): [string, RequestInit] {
  return [
    `${upstreamUrl}${path}?key=${SECRETS.typesafe}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SECRETS.anthropic}`,
        'x-api-key': SECRETS.openai,
        'content-type': 'application/json',
        'x-trace': SECRETS.bearer,
      },
      body: JSON.stringify({
        prompt: `use ${SECRETS.typesafe} and ${SECRETS.hex}`,
        token: SECRETS.base64,
        header: `Bearer ${SECRETS.bearer}`,
        image: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo'.repeat(200) },
        url: `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUg'.repeat(50)}`,
        [SECRETS.hex]: 'secret as a key',
      }),
    },
  ];
}

function scan(dir: string): void {
  for (const name of readdirSync(dir)) {
    const text = readFileSync(join(dir, name), 'utf8');
    metrics.filesScanned += 1;
    metrics.keyPatternMatches += findKeyMaterial(text).length;
    for (const secret of Object.values(SECRETS)) {
      if (text.includes(secret)) metrics.plantedSecretsFound += 1;
    }
    const entry = JSON.parse(text) as {
      request: { headers: Record<string, string> };
      response: { headers: Record<string, string> };
    };
    for (const headers of [entry.request.headers, entry.response.headers]) {
      for (const name of [
        'authorization',
        'x-api-key',
        'cookie',
        'set-cookie',
        'proxy-authorization',
      ]) {
        if (name in headers) metrics.credentialHeadersFound += 1;
      }
    }
  }
}

describe('M03-G3 recorded files hold no key material', () => {
  it('strips credential headers and redacts every key pattern in requests and responses', async () => {
    const dir = tempDir();
    const recorder = createCassetteFetch({ store: dir, mode: 'record' });
    for (const path of ['/v1/messages', '/v1/systemone', '/v1/chat/completions']) {
      const [url, init] = secretRequest(path);
      const response = await recorder(url, init);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-argus-cassette')).toBe('recorded');
    }
    expect(recorder.stats.recorded).toBe(3);
    scan(dir);
    expect(metrics.filesScanned).toBe(3);
    expect(
      metrics.keyPatternMatches + metrics.plantedSecretsFound + metrics.credentialHeadersFound,
    ).toBe(0);
    // Content digests and ordinary fields survive redaction.
    const text = readFileSync(join(dir, readdirSync(dir)[0] ?? ''), 'utf8');
    expect(text).toContain(`sha256:${'ab'.repeat(32)}`);
    expect(text).toContain('[inline image/png:');
  });
});

describe('M03-G3 strict mode never calls out', () => {
  it('fetch wrapper: a recorded request replays with no connection, an unknown one throws CASSETTE_MISS', async () => {
    const dir = tempDir();
    const [url, init] = secretRequest('/v1/systemone');
    await createCassetteFetch({ store: dir, mode: 'record' })(url, init);

    const strict = createCassetteFetch({ store: dir, mode: 'strict' });
    const hit = await outbound(async () => {
      const response = await strict(url, init);
      return (await response.json()) as { echoed: number };
    });
    expect(hit.error).toBeUndefined();
    expect(hit.result?.echoed).toBeGreaterThan(0);
    metrics.replayHits += 1;
    metrics.outboundConnections += hit.connects + hit.accepts;

    metrics.missCases += 1;
    const miss = await outbound(() =>
      strict(url, { ...init, body: JSON.stringify({ other: 'request' }) }),
    );
    if (
      miss.error instanceof CassetteMissError &&
      (miss.error as { code: unknown }).code === CASSETTE_MISS
    )
      metrics.missesDetected += 1;
    metrics.outboundConnections += miss.connects + miss.accepts;
    expect(miss.error).toBeInstanceOf(CassetteMissError);
    expect(miss.connects + miss.accepts).toBe(0);
    expect(strict.stats).toEqual({ hits: 1, misses: 1, recorded: 0 });
  });

  it('proxy: an unknown request answers 404 CASSETTE_MISS and the upstream sees nothing', async () => {
    const dir = tempDir();
    const proxy = await startCassetteProxy({ upstream: upstreamUrl, store: dir, mode: 'strict' });
    try {
      metrics.missCases += 1;
      const before = accepted;
      const response = await fetch(`${proxy.url}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'x', messages: [] }),
      });
      const body = (await response.json()) as { error: { code: string } };
      if (response.status === 404 && body.error.code === CASSETTE_MISS) metrics.missesDetected += 1;
      metrics.outboundConnections += accepted - before;
      expect(response.status).toBe(404);
      expect(accepted - before).toBe(0);
      expect(proxy.requests.at(-1)?.cassette).toBe('miss');
    } finally {
      await proxy.close();
    }
  });

  it('proxy: record through it, then replay strictly with the upstream untouched', async () => {
    const dir = tempDir();
    const recording = await startCassetteProxy({
      upstream: upstreamUrl,
      store: dir,
      mode: 'record',
    });
    const payload = { model: 'fake', messages: [{ role: 'user', content: 'hello' }] };
    const recorded = await fetch(`${recording.url}/v1/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const recordedBody: unknown = await recorded.json();
    await recording.close();

    const replaying = await startCassetteProxy({
      upstream: upstreamUrl,
      store: dir,
      mode: 'strict',
    });
    try {
      const before = accepted;
      // Same JSON with different key order and spacing: same canonical key.
      const replayed = await fetch(`${replaying.url}/v1/messages`, {
        method: 'POST',
        body: `{ "messages": [{"content":"hello","role":"user"}], "model": "fake" }`,
      });
      expect(replayed.status).toBe(200);
      // The replay is the recording: identical except for the redacted key material.
      expect(await replayed.json()).toEqual({
        ...(recordedBody as Record<string, unknown>),
        note: 'issued [REDACTED] for the next call',
      });
      metrics.replayHits += 1;
      metrics.outboundConnections += accepted - before;
      expect(accepted - before).toBe(0);
      scan(dir);
    } finally {
      await replaying.close();
    }
  });

  it('fake Jev in cassette mode: an unrecorded request is CASSETTE_MISS for the SDK', async () => {
    const dir = tempDir();
    const server = await startFakeJev({
      mode: { kind: 'cassette', store: new FileCassetteStore(dir) },
    });
    try {
      metrics.missCases += 1;
      const sdk = new TypeSafeClient({
        apiKey: DEFAULT_FAKE_JEV_API_KEY,
        baseURL: server.url,
        logLevel: 'off',
      });
      const before = accepted;
      const error = await sdk
        .systemOne({ state: 'never recorded', questions: { q: { type: 'noul' } } })
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      if (error instanceof NotFoundError && JSON.stringify(error.body).includes(CASSETTE_MISS))
        metrics.missesDetected += 1;
      metrics.outboundConnections += accepted - before;
      expect(error).toBeInstanceOf(NotFoundError);
      expect(server.requests).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
