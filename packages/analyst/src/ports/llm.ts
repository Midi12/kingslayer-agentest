/**
 * The LLM port (ADR M07-llm-port). One completion call with a system text, messages of
 * text and images, an optional JSON schema for structured output, a token limit and a
 * timeout. Adapters: `AnthropicProvider` and `OpenAiCompatibleProvider`.
 *
 * The provider only transports: whatever it claims about structured output, the caller
 * validates the answer against the full contract schema.
 */
import type { InlineImage, Result } from '@argus/contracts';

export type LlmContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly image: InlineImage };

export interface LlmMessage {
  readonly role: 'user' | 'assistant';
  readonly content: readonly LlmContent[];
}

/** A JSON schema the provider should constrain its output to, where it can. */
export interface LlmJsonSchema {
  /** `^[a-zA-Z0-9_-]{1,64}$`; the OpenAI shape requires a name. */
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export interface LlmRequest {
  /** Model id, from configuration (ARGUS_LLM_MODEL or ARGUS_LLM_PREMIUM_MODEL). */
  readonly model: string;
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly jsonSchema?: LlmJsonSchema;
  /** Output token limit. */
  readonly maxTokens: number;
  /** Per attempt; a timed-out attempt is not retried. */
  readonly timeoutMs: number;
  /** Sent only when set: several current models reject sampling parameters. */
  readonly temperature?: number;
}

export type LlmStopReason = 'end' | 'max_tokens' | 'refusal' | 'other';

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmResponse {
  /** The answer text (for a refusal, the refusal text). */
  readonly text: string;
  /** The answer parsed as JSON, when a schema was requested and the text is JSON. */
  readonly json?: unknown;
  readonly usage: LlmUsage;
  /** The model that answered, as the provider reports it. */
  readonly model: string;
  readonly stopReason: LlmStopReason;
  /** The provider's own stop or finish reason, for logs. */
  readonly rawStopReason: string;
  /** HTTP attempts this completion took, retries included. */
  readonly attempts: number;
}

export type LlmError =
  /** Unreachable, overloaded past the retry budget, timed out, or refused the credentials. */
  | {
      readonly code: 'unavailable';
      readonly message: string;
      readonly status?: number;
      readonly attempts: number;
    }
  /** The provider rejected the request itself (400, 404, 413, 422): a bug upstream. */
  | {
      readonly code: 'invalid_request';
      readonly message: string;
      readonly status?: number;
      readonly attempts: number;
    };

export type LlmProviderKind = 'anthropic' | 'openai-compatible';

export interface LlmProvider {
  readonly kind: LlmProviderKind;
  complete(request: LlmRequest): Promise<Result<LlmResponse, LlmError>>;
}
