# ADR M07-llm-port: The LlmProvider port, its two adapters and retries

- Status: accepted
- Date: 2026-09-25
- Module: M07

## Context

The spec asks for an `LlmProvider` port (`complete` with a JSON schema, images, token limit and timeout), an Anthropic adapter and an OpenAI-compatible adapter (Azure, vLLM, Ollama, Mistral), structured output where the provider offers it, and schema validation always. It leaves open the error model, retries, what counts as structured output support, and sampling parameters.

## Decision

- `complete({ model, system, messages (text and image parts), jsonSchema?, maxTokens, timeoutMs, temperature? })` returns `Result<{ text, json?, usage { inputTokens, outputTokens }, model, stopReason, rawStopReason, attempts }, LlmError>`. `stopReason` is `end`, `max_tokens`, `refusal` or `other`. `LlmError` is `unavailable` (unreachable, timed out, overloaded past the retry budget, 401/403) or `invalid_request` (400, 404, 413, 422), each with the attempt count. The model id is part of the request, so one provider serves both tiers.
- Retries live in `core/retry.ts` (`withRetries`, clock-driven): 429, every 5xx (529 included) and dropped connections are retried with exponential backoff from 500 ms (cap 8 s), honouring `retry-after`, at most 4 attempts and never starting a retry after 30 s. A timed-out attempt is not retried: the timeout is the caller's bound on the whole call. The SDK's own retries are off.
- `AnthropicProvider` uses `@anthropic-ai/sdk` 0.128.0 (the version already pinned in the lockfile by M03): `messages.create` with `output_config.format` `{ type: "json_schema", schema }` (the current structured-output parameter; `output_format` is deprecated), images as base64 blocks, usage counting cache reads and writes as input. Against the first-party API (no `baseURL`) it sends server-side refusal fallbacks (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"` through `beta.messages.create`), as the Claude API guidance recommends for Opus-class models; a gateway or proxy base URL turns it off unless configured.
- `OpenAiCompatibleProvider` uses `fetch` (no SDK, so no dialect is pinned): `POST {baseURL}/chat/completions`, `response_format` `json_schema` (default, `strict: false` so schemas may keep optional members), `json_object` or none; images as data URLs; Bearer, Azure `api-key` or no auth; extra query parameters (Azure `api-version`); `max_tokens` or `max_completion_tokens`. `message.refusal` and `finish_reason: content_filter` are refusals.
- The schema sent to a provider is a hint in the provider subset (`providerSchema`: no length, pattern, numeric or array-size keywords, every object closed, unconstrained values as scalars), narrowed to the request's menus. Whatever the provider claims, the answer is validated against the full contract schema and the menu rules; a refusal, an answer cut at `max_tokens` and non-JSON text are invalid answers like any other.
- `temperature` is sent only when set, because current Claude models reject sampling parameters; the Analyst sets none by default.

## Consequences

The engine sees two error codes, mapped by `analystBreakReason` to `ANALYST_UNAVAILABLE` and `ANALYST_INVALID`. A new dialect (for example Bedrock) is a third adapter behind the same port and contract suite (M07-G6). The retry budget is a constant here; the brain (M09) can pass its own policy.
