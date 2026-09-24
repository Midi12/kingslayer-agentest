/**
 * Fake LLM server in two API shapes (ADR M03-llm-fake): Anthropic Messages at
 * `POST /v1/messages` (x-api-key and anthropic-version) and OpenAI-compatible chat
 * completions at `POST /v1/chat/completions` (Bearer). Responses are scripted by matcher;
 * the seven fault modes are produced on demand through the script, a per-call queue, or
 * the `x-fake-llm-fault` request header. Every request is recorded.
 */
import type { ServerResponse } from 'node:http';
import type { Clock } from '@argus/contracts';
import { maskHeaders } from '../core/cassette/redact.js';
import { SeqIdGenerator } from '../core/fakes/ids.js';
import {
  findInjection,
  isLlmFault,
  LLM_FAULT_MODES,
  type Injection,
  type LlmFault,
} from '../core/llm/faults.js';
import {
  parseAnthropicRequest,
  parseOpenAiRequest,
  type LlmParse,
  type LlmRequestView,
  type LlmShape,
} from '../core/llm/request.js';
import {
  anthropicReply,
  faultAnswer,
  llmErrorBody,
  openAiReply,
  scriptedAnswer,
  type LlmAnswer,
} from '../core/llm/respond.js';
import { LlmScriptRunner, type LlmOutcome, type LlmScript } from '../core/llm/script.js';
import { parseLlmOutcomes, parseLlmScript } from '../core/script-files.js';
import {
  listen,
  pause,
  sendJson,
  type FakeServer,
  type IncomingCall,
  type ListenOptions,
} from './http.js';

export const DEFAULT_FAKE_LLM_API_KEY = 'fake-llm-key';
/** Header that selects a fault for one request. */
export const FAULT_HEADER = 'x-fake-llm-fault';
/** How long a `timeout` fault holds a request before dropping the connection; 10 minutes. */
export const DEFAULT_TIMEOUT_HOLD_MS = 600_000;

export interface FakeLlmOptions extends ListenOptions {
  readonly script?: LlmScript;
  /** Accepted keys (x-api-key or Bearer); `[DEFAULT_FAKE_LLM_API_KEY]` by default. */
  readonly apiKeys?: readonly string[];
  /** Model ids listed at `GET /v1/models`. */
  readonly models?: readonly string[];
  readonly timeoutHoldMs?: number;
  readonly clock?: Pick<Clock, 'now'>;
  readonly version?: string;
  readonly onRequest?: (record: LlmRequestRecord) => void;
}

export type LlmCallOutcome =
  'response' | 'fault' | 'unauthorized' | 'invalid' | 'unscripted' | 'fake-error' | 'not-found';

export interface LlmRequestRecord {
  readonly seq: number;
  readonly shape: LlmShape | undefined;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly receivedAt: number;
  view?: LlmRequestView;
  status: number;
  outcome: LlmCallOutcome;
  fault?: LlmFault;
  /** The planted instruction a `malicious` call obeyed, if any. */
  injection?: Injection;
  error?: string;
  response?: unknown;
}

export interface FakeLlmServer extends FakeServer<LlmRequestRecord> {
  enqueue(...outcomes: readonly LlmOutcome[]): void;
  setScript(script: LlmScript): void;
  clearRequests(): void;
}

const ROUTES: Readonly<Record<string, LlmShape>> = {
  '/v1/messages': 'anthropic',
  '/v1/chat/completions': 'openai',
  '/chat/completions': 'openai',
};

function parseBody(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false; text: string } {
  const text = new TextDecoder().decode(bytes);
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, text };
  }
}

export async function startFakeLlm(options: FakeLlmOptions = {}): Promise<FakeLlmServer> {
  const runner = new LlmScriptRunner(options.script ?? {});
  const apiKeys = options.apiKeys ?? [DEFAULT_FAKE_LLM_API_KEY];
  const clock = options.clock ?? { now: () => Date.now() };
  const ids = new SeqIdGenerator();
  const requests: LlmRequestRecord[] = [];
  const holdMs = options.timeoutHoldMs ?? DEFAULT_TIMEOUT_HOLD_MS;

  function error(
    response: ServerResponse,
    record: LlmRequestRecord,
    shape: LlmShape,
    status: number,
    message: string,
    outcome: LlmCallOutcome,
  ): void {
    record.status = status;
    record.outcome = outcome;
    record.error = message;
    sendJson(response, status, llmErrorBody(shape, status, message));
  }

  function authorize(call: IncomingCall, shape: LlmShape): string | undefined {
    const bearer = /^Bearer\s+(.+)$/i.exec(call.headers.authorization?.trim() ?? '')?.[1];
    const key = shape === 'anthropic' ? (call.headers['x-api-key'] ?? bearer) : bearer;
    if (key === undefined || key === '') {
      return shape === 'anthropic'
        ? 'x-api-key header is required'
        : 'You did not provide an API key. Send Authorization: Bearer <key>.';
    }
    return apiKeys.includes(key) ? undefined : 'invalid x-api-key';
  }

  function respond(
    response: ServerResponse,
    record: LlmRequestRecord,
    view: LlmRequestView,
    answer: LlmAnswer,
    scripted:
      { usage?: { inputTokens?: number; outputTokens?: number }; stopReason?: string } | undefined,
  ): void {
    const replyOptions = {
      ids: {
        message: ids.next(view.shape === 'anthropic' ? 'msg_fake' : 'chatcmpl_fake'),
        tool: ids.next(view.shape === 'anthropic' ? 'toolu_fake' : 'call_fake'),
      },
      created: Math.floor(clock.now() / 1000),
      ...(scripted?.usage === undefined ? {} : { usage: scripted.usage }),
      ...(scripted?.stopReason === undefined ? {} : { stopReason: scripted.stopReason }),
    };
    const body =
      view.shape === 'anthropic'
        ? anthropicReply(view, answer, replyOptions)
        : openAiReply(view, answer, replyOptions);
    record.status = 200;
    record.response = body;
    sendJson(
      response,
      200,
      body,
      view.shape === 'anthropic'
        ? { 'request-id': replyOptions.ids.message }
        : { 'x-request-id': replyOptions.ids.message },
    );
  }

  async function complete(
    call: IncomingCall,
    response: ServerResponse,
    record: LlmRequestRecord,
    shape: LlmShape,
  ): Promise<void> {
    const unauthorized = authorize(call, shape);
    if (unauthorized !== undefined) {
      error(response, record, shape, 401, unauthorized, 'unauthorized');
      return;
    }
    if (shape === 'anthropic' && (call.headers['anthropic-version'] ?? '') === '') {
      error(response, record, shape, 400, 'anthropic-version: header is required', 'invalid');
      return;
    }
    const parsed = parseBody(call.body);
    const view: LlmParse = parsed.ok
      ? shape === 'anthropic'
        ? parseAnthropicRequest(parsed.value)
        : parseOpenAiRequest(parsed.value)
      : { ok: false, message: 'There was an error parsing the body: invalid JSON' };
    if (!view.ok) {
      error(response, record, shape, 400, view.message, 'invalid');
      return;
    }
    record.view = view.view;
    const headerFault = call.headers[FAULT_HEADER];
    if (headerFault !== undefined && !isLlmFault(headerFault)) {
      error(
        response,
        record,
        shape,
        400,
        `${FAULT_HEADER} must be one of ${LLM_FAULT_MODES.join(', ')}`,
        'invalid',
      );
      return;
    }
    const decided = runner.next(view.view);
    const fault = headerFault ?? decided.fault;
    if (decided.delayMs !== undefined) {
      await pause(decided.delayMs, call.signal);
    }
    const intended = scriptedAnswer(view.view, decided.response);
    if (fault === undefined) {
      if (intended === undefined) {
        error(
          response,
          record,
          shape,
          400,
          'fake-llm: no scripted response matches this request',
          'unscripted',
        );
        return;
      }
      record.outcome = 'response';
      respond(response, record, view.view, intended, decided.response);
      return;
    }
    record.fault = fault;
    record.outcome = 'fault';
    if (fault === 'timeout') {
      record.status = 0;
      await pause(holdMs, call.signal);
      response.destroy();
      return;
    }
    if (fault === 'server-error') {
      const status = decided.status ?? 500;
      record.status = status;
      sendJson(
        response,
        status,
        llmErrorBody(
          shape,
          status,
          status >= 500
            ? 'Internal server error (fake-llm fault server-error)'
            : `Error ${String(status)} (fake-llm scripted status)`,
        ),
      );
      return;
    }
    const injection = fault === 'malicious' ? findInjection(view.view) : undefined;
    if (injection !== undefined) {
      record.injection = injection;
    }
    const answer = faultAnswer(view.view, fault, intended, injection);
    if (answer === undefined) {
      error(
        response,
        record,
        shape,
        400,
        'fake-llm: malicious mode found no planted instruction and no scripted response',
        'unscripted',
      );
      return;
    }
    respond(
      response,
      record,
      view.view,
      answer,
      fault === 'over-long' || fault === 'refusal' ? undefined : decided.response,
    );
  }

  const listening = await listen(async (call, response) => {
    if (call.pathname === '/healthz' && call.method === 'GET') {
      sendJson(response, 200, {
        status: 'ok',
        service: 'fake-llm',
        version: options.version ?? 'dev',
      });
      return;
    }
    if (call.pathname === '/_fake/requests' && call.method === 'GET') {
      sendJson(response, 200, { requests });
      return;
    }
    if (call.pathname === '/_fake/reset' && call.method === 'POST') {
      requests.length = 0;
      runner.replace(runner.script);
      sendJson(response, 200, { reset: true });
      return;
    }
    if (call.pathname === '/_fake/outcomes' && call.method === 'POST') {
      const parsed = parseBody(call.body);
      const outcomes = parsed.ok ? parseLlmOutcomes(parsed.value) : undefined;
      if (outcomes === undefined || !outcomes.ok) {
        sendJson(response, 400, { error: outcomes?.error ?? 'expected a JSON array of outcomes' });
        return;
      }
      runner.enqueue(...outcomes.value);
      sendJson(response, 200, { pending: runner.pending });
      return;
    }
    if (call.pathname === '/_fake/script' && call.method === 'PUT') {
      const parsed = parseBody(call.body);
      const script = parsed.ok ? parseLlmScript(parsed.value) : undefined;
      if (script === undefined || !script.ok) {
        sendJson(response, 400, { error: script?.error ?? 'expected a JSON script' });
        return;
      }
      runner.replace(script.value);
      sendJson(response, 200, { pending: runner.pending });
      return;
    }
    const parsed = parseBody(call.body);
    const shape = ROUTES[call.pathname];
    const record: LlmRequestRecord = {
      seq: requests.length + 1,
      shape,
      method: call.method,
      path: call.path,
      headers: maskHeaders(call.headers),
      body: call.body.length === 0 ? null : parsed.ok ? parsed.value : parsed.text,
      receivedAt: clock.now(),
      status: 0,
      outcome: 'not-found',
    };
    requests.push(record);
    if (call.pathname === '/v1/models' && call.method === 'GET') {
      record.status = 200;
      record.outcome = 'response';
      sendJson(response, 200, {
        object: 'list',
        data: (options.models ?? ['fake-llm']).map((id) => ({
          id,
          object: 'model',
          created: 0,
          owned_by: 'argus-fake',
        })),
      });
    } else if (shape === undefined) {
      error(response, record, 'openai', 404, `Unknown path ${call.pathname}`, 'not-found');
    } else if (call.method !== 'POST') {
      error(response, record, shape, 405, `Method ${call.method} is not allowed`, 'invalid');
    } else {
      try {
        await complete(call, response, record, shape);
      } catch (thrown) {
        // A failure of the fake itself (a throwing matcher): a 400 that clients do not retry.
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        if (response.headersSent) {
          record.outcome = 'fake-error';
          record.error = message;
        } else {
          error(response, record, shape, 400, `fake-llm: ${message}`, 'fake-error');
        }
      }
    }
    options.onRequest?.(record);
  }, options);

  return {
    url: listening.url,
    close: () => listening.close(),
    requests,
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
