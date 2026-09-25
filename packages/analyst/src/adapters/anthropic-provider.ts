/**
 * `LlmProvider` over the Anthropic Messages API with the official SDK (ADR
 * M07-llm-port). Structured output through `output_config.format` (JSON schema); images
 * as base64 blocks; the SDK's own retries are off and `withRetries` retries 429, 5xx and
 * dropped connections within its budget. Against the first-party API, refusals fall back
 * server-side (`fallbacks: "default"`) unless configured off.
 */
import Anthropic from '@anthropic-ai/sdk';
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

export const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  /** Another endpoint (a proxy, a gateway, the fake); the first-party API when absent. */
  readonly baseURL?: string;
  /** Send `output_config.format` with the request schema (default true). */
  readonly structuredOutput?: boolean;
  /** Server-side refusal fallbacks; default on for the first-party API only. */
  readonly refusalFallback?: boolean;
  readonly retry?: Partial<RetryPolicy>;
  readonly clock?: Clock;
}

type Params = Anthropic.MessageCreateParamsNonStreaming;

function content(part: LlmContent): Anthropic.ContentBlockParam {
  if (part.type === 'text') {
    return { type: 'text', text: part.text };
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: part.image.mediaType, data: part.image.data },
  };
}

function stopReason(reason: string | null): LlmStopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

interface MessageLike {
  readonly model: string;
  readonly stop_reason: string | null;
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_creation_input_tokens?: number | null;
    readonly cache_read_input_tokens?: number | null;
  };
}

export class AnthropicProvider implements LlmProvider {
  readonly kind = 'anthropic' as const;
  readonly #client: Anthropic;
  readonly #structured: boolean;
  readonly #fallback: boolean;
  readonly #policy: RetryPolicy;
  readonly #clock: Clock;

  constructor(options: AnthropicProviderOptions) {
    this.#client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
      maxRetries: 0,
    });
    this.#structured = options.structuredOutput ?? true;
    this.#fallback = options.refusalFallback ?? options.baseURL === undefined;
    this.#policy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
    this.#clock = options.clock ?? systemClock;
  }

  params(request: LlmRequest): Params {
    return {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content.map(content),
      })),
      ...(request.jsonSchema !== undefined && this.#structured
        ? {
            output_config: {
              format: { type: 'json_schema', schema: { ...request.jsonSchema.schema } },
            },
          }
        : {}),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    };
  }

  async complete(request: LlmRequest): Promise<Result<LlmResponse, LlmError>> {
    const params = this.params(request);
    const attempted = await withRetries<MessageLike>(
      (attempt) => this.#attempt(params, request.timeoutMs, attempt),
      this.#policy,
      this.#clock,
    );
    if (!attempted.ok) {
      return attempted;
    }
    const message = attempted.value.value;
    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    const usage = message.usage;
    let json: unknown;
    if (request.jsonSchema !== undefined) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = undefined;
      }
    }
    return ok({
      text,
      ...(json === undefined ? {} : { json }),
      usage: {
        inputTokens:
          usage.input_tokens +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
      },
      model: message.model,
      stopReason: stopReason(message.stop_reason),
      rawStopReason: message.stop_reason ?? 'null',
      attempts: attempted.value.attempts,
    });
  }

  async #attempt(
    params: Params,
    timeoutMs: number,
    _attempt: number,
  ): Promise<AttemptOutcome<MessageLike>> {
    try {
      const options = { timeout: timeoutMs, maxRetries: 0 };
      const message: MessageLike = this.#fallback
        ? await this.#client.beta.messages.create(
            {
              ...(params as Anthropic.Beta.MessageCreateParamsNonStreaming),
              betas: [REFUSAL_FALLBACK_BETA],
              fallbacks: 'default',
            },
            options,
          )
        : await this.#client.messages.create(params, options);
      return { kind: 'ok', value: message };
    } catch (error) {
      return classify(error, this.#clock.now(), timeoutMs);
    }
  }
}

/** An SDK error as a retry outcome. */
export function classify(error: unknown, now: number, timeoutMs: number): AttemptOutcome<never> {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return {
      kind: 'fatal',
      code: 'unavailable',
      message: `no answer within ${String(timeoutMs)} ms`,
    };
  }
  if (error instanceof Anthropic.APIUserAbortError) {
    return { kind: 'fatal', code: 'unavailable', message: 'the request was aborted' };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { kind: 'retryable', message: `connection failed: ${error.message}` };
  }
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    const status = error.status;
    const message = `HTTP ${String(status)}: ${error.message}`;
    if (isRetryableStatus(status)) {
      const headers = (error as { readonly headers?: Headers | undefined }).headers;
      const retryAfterMs = parseRetryAfter(headers?.get('retry-after'), now);
      return {
        kind: 'retryable',
        message,
        status,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      };
    }
    if (status === 401 || status === 403) {
      return { kind: 'fatal', code: 'unavailable', message, status };
    }
    return { kind: 'fatal', code: 'invalid_request', message, status };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: 'fatal', code: 'unavailable', message: `unexpected provider failure: ${message}` };
}
