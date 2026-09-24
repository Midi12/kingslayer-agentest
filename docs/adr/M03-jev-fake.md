# ADR M03-jev-fake: Wire fidelity of the fake Jev server

- Status: accepted
- Date: 2026-09-24
- Module: M03

## Context

M03-G1 requires that `@typesafe-ai/sdk@0.6.0`, pointed at the fake through `baseURL`, cannot tell it from Jev. `docs.typesafe.ai` is unreachable, so the reference is the SDK's `index.d.mts` and `index.mjs` plus the limits the spec cites. Several details are not documented anywhere we can read.

## Decision

- Endpoints: `POST /v1/systemone` and `GET /v1/models` (`{ models: [{ name, description, release_date }] }`, listing `jev-1.13.0` and `jev-1.12.0`; `jev-latest` resolves to `jev-1.13.0`, a request without `model` uses it). Both need `Authorization: Bearer <key>`; a missing or unknown key answers 401 with `WWW-Authenticate: Bearer`. Every response carries `x-typesafe-request-id` (`req_0001`, `req_0002`, … per server, deterministic).
- Error bodies follow the FastAPI form the SDK's message extractor parses: `{ detail: "text" }`, and for 422 `{ detail: [{ loc: ["body", …], msg, type }] }`. 429 always carries `Retry-After` (seconds, rounded up) and `retry-after-ms` (1,000 ms unless scripted); 529 is "Overloaded" and carries them only when scripted. The SDK retries 408, 429 and 5xx, which includes 529.
- Validation (422): body is an object; `state` present and text, object, array or null; `questions` a non-empty object of named questions; `type` one of noul, choice, score; Choice criteria an object of 1 to 255 non-empty labels; Score criteria a list of 2 to 10 entries; Noul criteria null or only `true`/`false`; entries are text, JSON or null; the model is known; the state plus the longest question fit in 32,768 estimated tokens. A single-option Choice is accepted (the SDK allows it; confidence is then 1). Extra top-level fields are ignored, as the SDK forwards them.
- Usage: `input_tokens` is ⌈UTF-8 bytes of the RFC 8785 JSON of `{ state, questions }` / 4⌉ (`estimateJevInputTokens`), `output_tokens` is 0.
- Answers match `SystemOneResult`: Choice `{ type, choice, confidence, probabilities }` in option order, the choice being the first most probable label. Option order is the key order of the parsed `criteria` object, which is also the order a JavaScript client serialises: integer-like labels (`"2"`, `"10"`) come first in ascending order, then the others in insertion order. Labels such as `__proto__` are kept as own properties; Noul `{ type, noul }`; Score `{ type, score, confidence, legend, probabilities }` with `legend` and `probabilities` keyed `"0"`…`"n-1"` and `score` the expected level Σ i·pᵢ.
- Confidence of Choice and Score is (n·p_max − 1)/(n − 1), clamped to [0, 1], exactly the LocalNavigator formula of the architecture's Navigator port table: 0 for a uniform distribution, 1 for a certain one. Using the same formula means thresholds calibrated on one adapter read the same on the other.
- A request the fake cannot answer because of its own configuration (no scripted answer, a scripted label that is not an option, an oracle truth that does not fit) answers 400 `{ detail: "fake-jev: …", code: "FAKE_JEV_SCRIPT" }`: a test bug, not retried by the SDK. A failure of the fake itself (an unreadable cassette file, a truth function that throws) answers 400 `{ code: "FAKE_JEV_ERROR" }` with the request id, outcome `fake-error` in the log; never a 500, which the SDK would retry.

## Consequences

If the real API differs in an error body or a limit, the Tier B cassettes recorded by M19 will show it and this ADR and the fake change together. The request log masks credentials (`Bearer ***-key`).
