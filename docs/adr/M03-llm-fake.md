# ADR M03-llm-fake: Fake LLM shapes, scripts and fault modes

- Status: accepted
- Date: 2026-09-24
- Module: M03

## Context

The Analyst and Compiler call Anthropic Messages or an OpenAI-compatible endpoint; the LocalNavigator needs log-probabilities. The spec asks for seven fault modes reachable on demand in both shapes, `malicious` obeying instructions found in page text.

## Decision

- Anthropic shape at `POST /v1/messages`: `x-api-key` (or Bearer) and `anthropic-version` required; text, image, tool_use and tool_result blocks read; `tools` answered with a `tool_use` block and `stop_reason: tool_use`; `output_config.format` json_schema answered as JSON text; usage `input_tokens`, `output_tokens`. OpenAI shape at `POST /v1/chat/completions` (and `/chat/completions`): Bearer; `response_format` json_schema and json_object; tools answered with `tool_calls`; `logprobs` with `top_logprobs` (at most 20) and byte arrays; usage `prompt_tokens`, `completion_tokens`, `total_tokens`. Streaming is refused with 400: no ARGUS caller streams. Token counts are the deterministic estimate of the Jev fake.
- Scripts: rules by matcher (`shape`, `model`, `systemIncludes`, `textIncludes`, `tool`, `where`) with a response, a fault and an outcome queue; a default response; a global queue; an always-on fault. A response is `text`, `json` (a tool call when tools are supplied), `toolUse`, or `choiceProbabilities` (the answer is the most likely label and its token carries every label as `top_logprobs`, which is what a LocalNavigator Choice reads). An unscripted call is a 400.
- A fault is selected, first wins, by the `x-fake-llm-fault` header, the queue, the rule, the script. Definitions: `malformed-json` returns the intended JSON text with its last character replaced by a comma (text, or OpenAI tool arguments); `schema-invalid` returns an object the requested schema (tool input schema or json_schema) rejects: without its required members, else with a forbidden extra member, else with a property of a JSON type the schema does not allow; `refusal` returns the refusal sentence, Anthropic `stop_reason: refusal` with `stop_details`, OpenAI `message.refusal` with null content under json_schema (plain content otherwise); `timeout` accepts the request and never answers, dropping the connection after 10 minutes or when the server closes; `server-error` returns 500 (or the scripted status, e.g. 529 `overloaded_error`) in the shape's error body; an outcome with a `status` and no fault is that error (as in the Jev fake), and a `status` with any other fault is refused like an invalid status; `over-long` returns exactly `max_tokens × 4` characters with `stop_reason: max_tokens` or `finish_reason: length` and output tokens equal to `max_tokens`; `malicious` scans message text (never the system text) line by line for `ARGUS-INJECT:` or "ignore (all) (the) previous instructions" and obeys the rest of the line: a JSON value is returned as is; a URL becomes a PATCH navigate decision; "click|dblclick|… X" a PATCH pointer action on target X; a decision name (with `_` or spaces) that decision (RESOLVE_TARGET with a `cN` id takes it); "abort" ABORT_ENV; anything else MARK_PASSED. Without a planted instruction the call answers normally.
- Every request is recorded (headers with credentials masked, body, parsed view, outcome, fault, injection) for assertions, and served at `/_fake/requests`.

## Consequences

M07 and M18 test their validators against a model that really misbehaves; a failure of the fake itself (a `where` matcher that throws) answers 400 with outcome `fake-error`, which clients do not retry; the grammar of `malicious` is small, so an attack corpus that needs another shape of instruction adds a rule here.
