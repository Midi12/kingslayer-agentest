/**
 * Fake of the TypeSafe Jev API (ADR M03-jev-fake, ADR M03-jev-modes): `POST /v1/systemone`
 * and `GET /v1/models` with Bearer authentication, request validation, the documented
 * errors (401, 422, 429, 529), `x-typesafe-request-id` on every response and three modes:
 * scripted, cassette and oracle. The official SDK pointed at it through `baseURL` cannot
 * tell the difference (M03-G1).
 */
import type { ServerResponse } from 'node:http';
import type { Clock } from '@argus/contracts';
import { cassetteKey, decodeBody, encodeBody } from '../core/cassette/entry.js';
import { maskHeaders } from '../core/cassette/redact.js';
import { SeqIdGenerator } from '../core/fakes/ids.js';
import { JEV_MODEL_ALIASES, JEV_MODELS } from '../core/jev/models.js';
import { oracleAnswers, type OracleTruthFunction } from '../core/jev/oracle.js';
import {
  ScriptRunner,
  type JevOutcome,
  type JevScript,
  type ScriptedAnswers,
} from '../core/jev/script.js';
import type { JevAnswer, JevModelCard, JevRequest } from '../core/jev/types.js';
import { estimateJevInputTokens, validateJevRequest } from '../core/jev/validate.js';
import type { CassetteStore } from '../ports/cassette.js';
import {
  listen,
  pause,
  sendBytes,
  sendJson,
  untilAborted,
  type FakeServer,
  type IncomingCall,
  type ListenOptions,
} from './http.js';

/** The key the fake accepts when none is configured. */
export const DEFAULT_FAKE_JEV_API_KEY = 'fake-typesafe-key';

export type FakeJevMode =
  | { readonly kind: 'scripted'; readonly script?: JevScript }
  | { readonly kind: 'cassette'; readonly store: CassetteStore }
  | {
      readonly kind: 'oracle';
      readonly truth: OracleTruthFunction;
      /** Noise amplitude in [0, 1]. */
      readonly noise?: number;
      readonly seed?: number | string;
    };

export interface FakeJevOptions extends ListenOptions {
  /** Scripted with an empty script by default. */
  readonly mode?: FakeJevMode;
  /** Accepted API keys; `[DEFAULT_FAKE_JEV_API_KEY]` by default. */
  readonly apiKeys?: readonly string[];
  readonly models?: readonly JevModelCard[];
  readonly aliases?: Readonly<Record<string, string>>;
  /** Per-call outcomes in every mode (errors, delays, hangs), consumed in order. */
  readonly outcomes?: readonly JevOutcome[];
  /** Retry delay of a queued 429 that names none; 1,000 ms by default. */
  readonly defaultRetryAfterMs?: number;
  /** Time source of the request log; wall time by default. */
  readonly clock?: Pick<Clock, 'now'>;
  /** Reported by `/healthz`. */
  readonly version?: string;
  /** Called after each request is answered, for logging. */
  readonly onRequest?: (record: JevRequestRecord) => void;
}

export type JevCallOutcome =
  | 'answered'
  | 'replayed'
  | 'unauthorized'
  | 'invalid'
  | 'injected-error'
  | 'script-error'
  | 'cassette-miss'
  | 'hung'
  | 'models'
  | 'not-found';

export interface JevRequestRecord {
  readonly seq: number;
  readonly method: string;
  readonly path: string;
  /** Request headers with credential values masked. */
  readonly headers: Readonly<Record<string, string>>;
  /** Parsed JSON body, its text when it is not JSON, or null. */
  readonly body: unknown;
  readonly requestId: string;
  /** `X-TypeSafe-Retry-Count` sent by the SDK on retries; 0 on a first attempt. */
  readonly retryCount: number;
  readonly receivedAt: number;
  status: number;
  outcome: JevCallOutcome;
  error?: string;
  answers?: Readonly<Record<string, JevAnswer>>;
}

export interface FakeJevServer extends FakeServer<JevRequestRecord> {
  readonly mode: FakeJevMode['kind'];
  /** Appends per-call outcomes to the queue. */
  enqueue(...outcomes: readonly JevOutcome[]): void;
  /** Replaces the script (scripted mode) and its queues. */
  setScript(script: JevScript): void;
  /** Clears the request log. */
  clearRequests(): void;
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  422: 'Unprocessable Entity',
  429: 'Rate limit exceeded',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  529: 'Overloaded',
};

function parseJson(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false; text: string } {
  const text = new TextDecoder().decode(bytes);
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, text };
  }
}

export async function startFakeJev(options: FakeJevOptions = {}): Promise<FakeJevServer> {
  const mode: FakeJevMode = options.mode ?? { kind: 'scripted', script: {} };
  const apiKeys = options.apiKeys ?? [DEFAULT_FAKE_JEV_API_KEY];
  const models = options.models ?? JEV_MODELS;
  const aliases = options.aliases ?? JEV_MODEL_ALIASES;
  const clock = options.clock ?? { now: () => Date.now() };
  const ids = new SeqIdGenerator();
  const runner = new ScriptRunner(mode.kind === 'scripted' ? (mode.script ?? {}) : {});
  runner.enqueue(...(options.outcomes ?? []));
  const requests: JevRequestRecord[] = [];

  function authorize(call: IncomingCall): string | undefined {
    const header = call.headers.authorization;
    if (header === undefined || header.trim() === '') {
      return 'Missing API key: send Authorization: Bearer <key>';
    }
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match === null || !apiKeys.includes(match[1] ?? '')) {
      return 'Invalid API key';
    }
    return undefined;
  }

  function reply(
    response: ServerResponse,
    record: JevRequestRecord,
    status: number,
    body: unknown,
    headers: Readonly<Record<string, string>> = {},
  ): void {
    record.status = status;
    sendJson(response, status, body, { 'x-typesafe-request-id': record.requestId, ...headers });
  }

  function errorReply(
    response: ServerResponse,
    record: JevRequestRecord,
    outcome: JevOutcome,
  ): void {
    const status = outcome.status ?? 500;
    const retryAfterMs =
      outcome.retryAfterMs ?? (status === 429 ? (options.defaultRetryAfterMs ?? 1000) : undefined);
    const headers: Record<string, string> =
      retryAfterMs === undefined
        ? {}
        : {
            'retry-after': String(Math.ceil(retryAfterMs / 1000)),
            'retry-after-ms': String(retryAfterMs),
          };
    record.outcome = 'injected-error';
    reply(
      response,
      record,
      status,
      outcome.body ?? { detail: STATUS_TEXT[status] ?? 'Error' },
      headers,
    );
  }

  async function answer(
    request: JevRequest,
    call: IncomingCall,
    response: ServerResponse,
    record: JevRequestRecord,
    scripted: ScriptedAnswers,
  ): Promise<void> {
    if (mode.kind === 'cassette') {
      const key = cassetteKey({ method: 'POST', path: call.path, body: encodeBody(call.body) });
      const entry = await mode.store.read(key);
      if (entry === undefined) {
        record.outcome = 'cassette-miss';
        record.error = `CASSETTE_MISS ${key}`;
        reply(response, record, 404, {
          detail: `CASSETTE_MISS: no recording of POST ${call.path} with key ${key}`,
          code: 'CASSETTE_MISS',
          key,
        });
        return;
      }
      record.outcome = 'replayed';
      const bytes = decodeBody(entry.response.body);
      record.status = entry.response.status;
      sendBytes(response, entry.response.status, bytes, {
        'content-type': entry.response.headers['content-type'] ?? 'application/json',
        'x-typesafe-request-id': record.requestId,
      });
      return;
    }
    const built =
      mode.kind === 'oracle' ? oracleAnswers(request, mode) : runner.answer(request, scripted);
    if (!built.ok) {
      record.outcome = 'script-error';
      record.error = built.message;
      reply(response, record, 400, {
        detail: `fake-jev: ${built.message}`,
        code: 'FAKE_JEV_SCRIPT',
      });
      return;
    }
    record.outcome = 'answered';
    record.answers = built.answers;
    reply(response, record, 200, {
      model: request.model,
      answers: built.answers,
      usage: { input_tokens: estimateJevInputTokens(request), output_tokens: 0 },
    });
  }

  async function systemOne(
    call: IncomingCall,
    response: ServerResponse,
    record: JevRequestRecord,
  ): Promise<void> {
    const parsed = parseJson(call.body);
    if (!parsed.ok) {
      record.outcome = 'invalid';
      reply(response, record, 422, {
        detail: [{ loc: ['body'], msg: 'JSON decode error', type: 'json_invalid' }],
      });
      return;
    }
    const validation = validateJevRequest(parsed.value, {
      models: models.map((model) => model.name),
      aliases,
    });
    if (!validation.ok) {
      record.outcome = 'invalid';
      reply(response, record, 422, { detail: validation.issues });
      return;
    }
    const scripted = runner.next(validation.request);
    const outcome = scripted.outcome;
    if (outcome?.delayMs !== undefined) {
      await pause(outcome.delayMs, call.signal);
    }
    if (outcome?.hang === true) {
      record.outcome = 'hung';
      record.status = 0;
      await untilAborted(call.signal);
      return;
    }
    if (outcome?.status !== undefined) {
      errorReply(response, record, outcome);
      return;
    }
    await answer(validation.request, call, response, record, scripted.answers);
  }

  function admin(call: IncomingCall, response: ServerResponse): boolean {
    if (call.pathname === '/healthz' && call.method === 'GET') {
      sendJson(response, 200, {
        status: 'ok',
        service: 'fake-jev',
        mode: mode.kind,
        version: options.version ?? 'dev',
      });
      return true;
    }
    if (call.pathname === '/_fake/requests' && call.method === 'GET') {
      sendJson(response, 200, { requests });
      return true;
    }
    if (call.pathname === '/_fake/reset' && call.method === 'POST') {
      requests.length = 0;
      runner.replace(runner.script);
      sendJson(response, 200, { reset: true });
      return true;
    }
    if (call.pathname === '/_fake/outcomes' && call.method === 'POST') {
      const parsed = parseJson(call.body);
      if (!parsed.ok || !Array.isArray(parsed.value)) {
        sendJson(response, 400, { detail: 'expected a JSON array of outcomes' });
        return true;
      }
      runner.enqueue(...(parsed.value as JevOutcome[]));
      sendJson(response, 200, { pending: runner.pending });
      return true;
    }
    if (call.pathname === '/_fake/script' && call.method === 'PUT') {
      const parsed = parseJson(call.body);
      if (
        mode.kind !== 'scripted' ||
        !parsed.ok ||
        typeof parsed.value !== 'object' ||
        parsed.value === null
      ) {
        sendJson(response, 400, { detail: 'expected a JSON script, in scripted mode only' });
        return true;
      }
      runner.replace(parsed.value);
      sendJson(response, 200, { pending: runner.pending });
      return true;
    }
    return false;
  }

  const listening = await listen(async (call, response) => {
    if (admin(call, response)) {
      return;
    }
    const parsed = parseJson(call.body);
    const retry = Number(call.headers['x-typesafe-retry-count'] ?? '0');
    const record: JevRequestRecord = {
      seq: requests.length + 1,
      method: call.method,
      path: call.path,
      headers: maskHeaders(call.headers),
      body: call.body.length === 0 ? null : parsed.ok ? parsed.value : parsed.text,
      requestId: ids.next('req'),
      retryCount: Number.isInteger(retry) ? retry : 0,
      receivedAt: clock.now(),
      status: 0,
      outcome: 'not-found',
    };
    requests.push(record);
    const known = call.pathname === '/v1/systemone' || call.pathname === '/v1/models';
    if (!known) {
      reply(response, record, 404, { detail: 'Not Found' });
    } else {
      const unauthorized = authorize(call);
      if (unauthorized !== undefined) {
        record.outcome = 'unauthorized';
        reply(response, record, 401, { detail: unauthorized }, { 'www-authenticate': 'Bearer' });
      } else if (call.pathname === '/v1/models' && call.method === 'GET') {
        record.outcome = 'models';
        reply(response, record, 200, { models });
      } else if (call.pathname === '/v1/systemone' && call.method === 'POST') {
        await systemOne(call, response, record);
      } else {
        reply(
          response,
          record,
          405,
          { detail: 'Method Not Allowed' },
          { allow: call.pathname === '/v1/models' ? 'GET' : 'POST' },
        );
      }
    }
    options.onRequest?.(record);
  }, options);

  return {
    url: listening.url,
    close: () => listening.close(),
    requests,
    mode: mode.kind,
    enqueue: (...outcomes) => {
      runner.enqueue(...outcomes);
    },
    setScript: (script) => {
      runner.replace(script);
    },
    clearRequests: () => {
      requests.length = 0;
    },
  };
}
