/**
 * Cassette recorder and player (ADR M03-cassettes): a store of JSON files, one directory
 * per suite; a fetch wrapper that records or replays by canonical request hash; and a
 * proxy that does the same for any HTTP client. Strict mode throws or answers
 * `CASSETTE_MISS` on an unknown request and never calls the upstream.
 */
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Clock } from '@argus/contracts';
import {
  cassetteFileName,
  cassetteKey,
  decodeBody,
  encodeBody,
  isCassetteEntry,
  suiteSlug,
  type CassetteBody,
  type CassetteEntry,
} from '../core/cassette/entry.js';
import { sanitizeBody, sanitizeHeaders, sanitizeRequest } from '../core/cassette/redact.js';
import type { CassetteStore } from '../ports/cassette.js';
import { listen, sendBytes, sendJson, type FakeServer, type ListenOptions } from './http.js';

export const CASSETTE_MISS = 'CASSETTE_MISS';

export class CassetteMissError extends Error {
  readonly code = CASSETTE_MISS;
  readonly key: string;
  readonly method: string;
  readonly path: string;

  constructor(key: string, method: string, path: string) {
    super(
      `${CASSETTE_MISS}: no recording of ${method} ${path} (key ${key}); strict mode makes no call`,
    );
    this.name = 'CassetteMissError';
    this.key = key;
    this.method = method;
    this.path = path;
  }
}

export const CASSETTE_BINARY_BODY = 'CASSETTE_BINARY_BODY';

/**
 * A request or response body that is not UTF-8 text cannot be checked for key material,
 * so the recorder refuses to store it (ADR M03-cassettes).
 */
export class CassetteBinaryBodyError extends Error {
  readonly code = CASSETTE_BINARY_BODY;
  readonly method: string;
  readonly path: string;
  readonly part: 'request' | 'response';

  constructor(method: string, path: string, part: 'request' | 'response') {
    super(
      `${CASSETTE_BINARY_BODY}: the ${part} body of ${method} ${path} is not UTF-8 text; ` +
        'cassettes record only text and JSON bodies, which can be checked for key material',
    );
    this.name = 'CassetteBinaryBodyError';
    this.method = method;
    this.path = path;
    this.part = part;
  }
}

/** The directory of one suite's cassettes under a root. */
export function cassetteDir(root: string, suite: string): string {
  return join(root, suiteSlug(suite));
}

/** Cassettes as JSON files in one directory, named by the hex digest of their key. */
export class FileCassetteStore implements CassetteStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async read(key: string): Promise<CassetteEntry | undefined> {
    let text: string;
    try {
      text = await readFile(join(this.dir, cassetteFileName(key)), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
    const entry: unknown = JSON.parse(text);
    if (!isCassetteEntry(entry) || entry.key !== key) {
      throw new Error(
        `cassette file ${cassetteFileName(key)} in ${this.dir} is not a valid entry for its key`,
      );
    }
    return entry;
  }

  async write(entry: CassetteEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, cassetteFileName(entry.key));
    const temporary = `${file}.${String(process.pid)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`);
    await rename(temporary, file);
  }

  async keys(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    return names
      .filter((name) => /^[0-9a-f]{64}\.json$/.test(name))
      .map((name) => `sha256:${name.slice(0, 64)}`)
      .sort();
  }
}

/** `strict` replays only; `record` always calls and records; `auto` replays hits and records misses. */
export type CassetteMode = 'strict' | 'record' | 'auto';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CassetteFetchOptions {
  /** A store, or a directory for a FileCassetteStore. */
  readonly store: CassetteStore | string;
  readonly mode: CassetteMode;
  /** The real fetch for record and auto; global fetch by default. */
  readonly fetch?: FetchLike;
  readonly clock?: Pick<Clock, 'now'>;
}

export interface CassetteFetch extends FetchLike {
  readonly stats: { hits: number; misses: number; recorded: number };
}

async function bodyBytes(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Uint8Array | undefined> {
  const body =
    init?.body ?? (input instanceof Request ? await input.clone().arrayBuffer() : undefined);
  if (body === undefined) {
    return undefined;
  }
  if (typeof body === 'string') {
    return new TextEncoder().encode(body);
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString());
  }
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  throw new TypeError('cassette fetch cannot key a streamed request body; pass a string or bytes');
}

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name] = value;
  });
  return record;
}

const UNREPLAYED_RESPONSE_HEADERS = [
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
];

function isBinary(body: CassetteBody): body is { base64: string } {
  return body !== null && 'base64' in body;
}

/** Builds the Response a recorded entry replays as. */
export function replayResponse(entry: CassetteEntry): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(entry.response.headers)) {
    if (!UNREPLAYED_RESPONSE_HEADERS.includes(name)) {
      headers.set(name, value);
    }
  }
  headers.set('x-argus-cassette', 'hit');
  const bytes = decodeBody(entry.response.body);
  const nullBody = [101, 204, 205, 304].includes(entry.response.status);
  return new Response(nullBody || bytes === undefined ? null : Buffer.from(bytes), {
    status: entry.response.status,
    headers,
  });
}

/**
 * A fetch that records and replays cassettes. The key covers method, path with query and
 * body, not the origin, so a recording made against the real API replays against a fake.
 */
export function createCassetteFetch(options: CassetteFetchOptions): CassetteFetch {
  const store =
    typeof options.store === 'string' ? new FileCassetteStore(options.store) : options.store;
  const upstream: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const clock = options.clock ?? { now: () => Date.now() };
  const stats = { hits: 0, misses: 0, recorded: 0 };

  const wrapped = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const path = `${url.pathname}${url.search}`;
    const bytes = await bodyBytes(input, init);
    const body = encodeBody(bytes);
    // Keyed over the stored, redacted form (ADR M03-cassettes).
    const stored = sanitizeRequest({ method, path, body });
    const key = cassetteKey(stored);
    const recordedPath = stored.path;
    if (options.mode !== 'record') {
      const entry = await store.read(key);
      if (entry !== undefined) {
        stats.hits += 1;
        return replayResponse(entry);
      }
      if (options.mode === 'strict') {
        stats.misses += 1;
        throw new CassetteMissError(key, method, recordedPath);
      }
    }
    if (isBinary(body)) {
      throw new CassetteBinaryBodyError(method, recordedPath, 'request');
    }
    const requestHeaders = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => {
      requestHeaders.set(name, value);
    });
    const response = await upstream(input, init);
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    const responseBody = encodeBody(responseBytes);
    if (isBinary(responseBody)) {
      throw new CassetteBinaryBodyError(method, recordedPath, 'response');
    }
    const entry: CassetteEntry = {
      version: 1,
      key,
      recordedAt: new Date(clock.now()).toISOString(),
      request: {
        method,
        path: recordedPath,
        headers: sanitizeHeaders(headerRecord(requestHeaders)),
        body: stored.body,
      },
      response: {
        status: response.status,
        headers: sanitizeHeaders(headerRecord(response.headers)),
        body: sanitizeBody(responseBody),
      },
    };
    await store.write(entry);
    stats.recorded += 1;
    const headers = new Headers(response.headers);
    for (const name of UNREPLAYED_RESPONSE_HEADERS) {
      headers.delete(name);
    }
    headers.set('x-argus-cassette', 'recorded');
    const nullBody = [101, 204, 205, 304].includes(response.status);
    return new Response(nullBody ? null : Buffer.from(responseBytes), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
  return Object.assign(wrapped, { stats });
}

export interface CassetteProxyOptions extends ListenOptions {
  /** Origin (and optional base path) requests are forwarded to in record and auto modes. */
  readonly upstream: string;
  readonly store: CassetteStore | string;
  readonly mode: CassetteMode;
  readonly fetch?: FetchLike;
  readonly clock?: Pick<Clock, 'now'>;
}

export interface CassetteProxyRecord {
  readonly method: string;
  readonly path: string;
  status: number;
  cassette: 'hit' | 'miss' | 'recorded' | 'error';
}

const HOP_BY_HOP = [
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'upgrade',
  'proxy-connection',
  'te',
  'trailer',
];

/** An HTTP proxy in front of `upstream` that records or replays every request. */
export async function startCassetteProxy(
  options: CassetteProxyOptions,
): Promise<FakeServer<CassetteProxyRecord>> {
  const cassetteFetch = createCassetteFetch({
    store: options.store,
    mode: options.mode,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const base = options.upstream.replace(/\/+$/, '');
  const requests: CassetteProxyRecord[] = [];
  const listening = await listen(async (call, response) => {
    if (call.pathname === '/healthz' && call.method === 'GET') {
      sendJson(response, 200, { status: 'ok', service: 'cassette-proxy', mode: options.mode });
      return;
    }
    const record: CassetteProxyRecord = {
      method: call.method,
      path: call.path,
      status: 0,
      cassette: 'error',
    };
    requests.push(record);
    const headers = new Headers();
    for (const [name, value] of Object.entries(call.headers)) {
      if (!HOP_BY_HOP.includes(name)) {
        headers.set(name, value);
      }
    }
    try {
      const upstreamResponse = await cassetteFetch(`${base}${call.path}`, {
        method: call.method,
        headers,
        ...(call.body.length === 0 || call.method === 'GET' || call.method === 'HEAD'
          ? {}
          : { body: Buffer.from(call.body) }),
      });
      const bytes = new Uint8Array(await upstreamResponse.arrayBuffer());
      const replyHeaders = headerRecord(upstreamResponse.headers);
      for (const name of UNREPLAYED_RESPONSE_HEADERS) {
        Reflect.deleteProperty(replyHeaders, name);
      }
      record.status = upstreamResponse.status;
      record.cassette =
        upstreamResponse.headers.get('x-argus-cassette') === 'hit' ? 'hit' : 'recorded';
      sendBytes(
        response,
        upstreamResponse.status,
        bytes.length === 0 ? undefined : bytes,
        replyHeaders,
      );
    } catch (error) {
      if (error instanceof CassetteMissError) {
        record.status = 404;
        record.cassette = 'miss';
        sendJson(
          response,
          404,
          {
            error: {
              type: 'cassette_miss',
              code: CASSETTE_MISS,
              message: error.message,
              key: error.key,
            },
            detail: error.message,
          },
          { 'x-argus-cassette': 'miss' },
        );
        return;
      }
      record.status = 502;
      if (error instanceof CassetteBinaryBodyError) {
        sendJson(response, 502, {
          error: {
            type: 'cassette_binary_body',
            code: CASSETTE_BINARY_BODY,
            message: error.message,
          },
          detail: error.message,
        });
        return;
      }
      sendJson(response, 502, {
        error: { type: 'upstream_error', message: (error as Error).message },
        detail: (error as Error).message,
      });
    }
  }, options);
  return { url: listening.url, close: () => listening.close(), requests };
}
