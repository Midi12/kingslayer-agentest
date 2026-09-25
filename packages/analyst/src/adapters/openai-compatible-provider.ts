/**
 * `LlmProvider` over an OpenAI-compatible chat completions endpoint (ADR M07-llm-port):
 * OpenAI, Azure OpenAI, vLLM, Ollama, Mistral. Plain `fetch`, so no SDK pins the
 * dialect. Structured output as `response_format` (`json_schema`, or `json_object` for
 * servers without schema support); images as data URLs; 429, 5xx and dropped
 * connections retried by `withRetries`.
 */
import { ok, type Clock, type Result } from '@argus/contracts';
import type {
  LlmContent,
  LlmError,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmStopReason,
} from '../ports/llm.js';
import {
  DEFAULT_RETRY_POLICY,
  isRetryableStatus,
  parseRetryAfter,
  withRetries,
  type AttemptOutcome,
  type RetryPolicy,
} from '../core/retry.js';
import { systemClock } from './system-clock.js';

export type StructuredOutputMode = 'json_schema' | 'json_object' | 'none';

export interface OpenAiCompatibleProviderOptions {
  /** The API root that `/chat/completions` hangs off, e.g. `https://api.mistral.ai/v1`. */
  readonly baseURL: string;
  readonly apiKey?: string;
  /** `bearer` (default) or Azure's `api-key` header; `none` for keyless local servers. */
  readonly auth?: 'bearer' | 'api-key' | 'none';
  /** Query parameters added to every call, e.g. Azure's `api-version`. */
  readonly query?: Readonly<Record<string, string>>;
  readonly structuredOutput?: StructuredOutputMode;
  /** `strict` of `response_format.json_schema` (default false: schemas keep optional members). */
  readonly strictSchema?: boolean;
  /** `max_tokens` (default) or `max_completion_tokens` for newer OpenAI models. */
  readonly maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  readonly retry?: Partial<RetryPolicy>;
  readonly clock?: Clock;
  readonly fetch?: typeof fetch;
}

interface ChatCompletion {
  readonly model?: unknown;
  readonly choices?: unknown;
  readonly usage?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function part(content: LlmContent): Record<string, unknown> {
  if (content.type === 'text') {
    return { type: 'text', text: content.text };
  }
  return {
    type: 'image_url',
    image_url: { url: `data:${content.image.mediaType};base64,${content.image.data}` },
  };
}

function stopReason(finish: unknown, refused: boolean): LlmStopReason {
  if (refused || finish === 'content_filter') return 'refusal';
  if (finish === 'stop') return 'end';
  if (finish === 'length') return 'max_tokens';
  return 'other';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function errorMessage(body: unknown, fallback: string): string {
  if (isObject(body) && isObject(body.error) && typeof body.error.message === 'string') {
    return body.error.message;
  }
  if (isObject(body) && typeof body.message === 'string') return body.message;
  return fallback;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly kind = 'openai-compatible' as const;
  readonly #options: OpenAiCompatibleProviderOptions;
  readonly #policy: RetryPolicy;
  readonly #clock: Clock;
  readonly #fetch: typeof fetch;
  readonly #url: string;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.#options = options;
    this.#policy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
    this.#clock = options.clock ?? systemClock;
    this.#fetch = options.fetch ?? fetch;
    const url = new URL(`${options.baseURL.replace(/\/+$/, '')}/chat/completions`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }
    this.#url = url.toString();
  }

  body(request: LlmRequest): Record<string, unknown> {
    const mode = this.#options.structuredOutput ?? 'json_schema';
    const format =
      request.jsonSchema === undefined || mode === 'none'
        ? undefined
        : mode === 'json_object'
          ? { type: 'json_object' }
          : {
              type: 'json_schema',
              json_schema: {
                name: request.jsonSchema.name,
                schema: request.jsonSchema.schema,
                strict: this.#options.strictSchema ?? false,
              },
            };
    return {
      model: request.model,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages.map((message) => ({
          role: message.role,
          content: message.content.map(part),
        })),
      ],
      [this.#options.maxTokensField ?? 'max_tokens']: request.maxTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(format === undefined ? {} : { response_format: format }),
    };
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const key = this.#options.apiKey;
    const auth = this.#options.auth ?? (key === undefined || key === '' ? 'none' : 'bearer');
    if (auth === 'bearer' && key !== undefined) headers.authorization = `Bearer ${key}`;
    if (auth === 'api-key' && key !== undefined) headers['api-key'] = key;
    return headers;
  }

  async complete(request: LlmRequest): Promise<Result<LlmResponse, LlmError>> {
    const body = JSON.stringify(this.body(request));
    const attempted = await withRetries<ChatCompletion>(
      () => this.#attempt(body, request.timeoutMs),
      this.#policy,
      this.#clock,
    );
    if (!attempted.ok) {
      return attempted;
    }
    const completion = attempted.value.value;
    const choice = Array.isArray(completion.choices)
      ? (completion.choices[0] as unknown)
      : undefined;
    const message = isObject(choice) && isObject(choice.message) ? choice.message : {};
    const refusal =
      typeof message.refusal === 'string' && message.refusal !== '' ? message.refusal : undefined;
    const text = refusal ?? (typeof message.content === 'string' ? message.content : '');
    let json: unknown;
    if (request.jsonSchema !== undefined && refusal === undefined) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = undefined;
      }
    }
    const usage = isObject(completion.usage) ? completion.usage : {};
    const finish = isObject(choice) ? choice.finish_reason : undefined;
    return ok({
      text,
      ...(json === undefined ? {} : { json }),
      usage: {
        inputTokens: count(usage.prompt_tokens),
        outputTokens: count(usage.completion_tokens),
      },
      model:
        typeof completion.model === 'string' && completion.model !== ''
          ? completion.model
          : request.model,
      stopReason: stopReason(finish, refusal !== undefined),
      rawStopReason: typeof finish === 'string' ? finish : 'null',
      attempts: attempted.value.attempts,
    });
  }

  async #attempt(body: string, timeoutMs: number): Promise<AttemptOutcome<ChatCompletion>> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('timeout'));
    }, timeoutMs);
    try {
      const response = await this.#fetch(this.#url, {
        method: 'POST',
        headers: this.#headers(),
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = undefined;
      }
      if (!response.ok) {
        const status = response.status;
        const message = `HTTP ${String(status)}: ${errorMessage(parsed, text.slice(0, 300))}`;
        if (isRetryableStatus(status)) {
          const retryAfterMs = parseRetryAfter(
            response.headers.get('retry-after'),
            this.#clock.now(),
          );
          return {
            kind: 'retryable',
            message,
            status,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          };
        }
        return {
          kind: 'fatal',
          code: status === 401 || status === 403 ? 'unavailable' : 'invalid_request',
          message,
          status,
        };
      }
      if (!isObject(parsed) || !Array.isArray(parsed.choices)) {
        return {
          kind: 'fatal',
          code: 'unavailable',
          message: 'the provider answered 200 without a chat completion body',
        };
      }
      return { kind: 'ok', value: parsed };
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          kind: 'fatal',
          code: 'unavailable',
          message: `no answer within ${String(timeoutMs)} ms`,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { kind: 'retryable', message: `connection failed: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
