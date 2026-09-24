# ADR M03-jev-modes: Scripted, cassette and oracle modes

- Status: accepted
- Date: 2026-09-24
- Module: M03

## Context

The spec names three fake Jev modes: `scripted` answers by question key, `cassette` replays by request hash, `oracle` reads the fixture's ground truth and adds seeded noise. M06-G5 and M10's golden ledgers depend on their exact semantics.

## Decision

- Order of a call: authentication, JSON parse, validation, then the per-call outcome queue, then the mode. A queued outcome is `{ status?, retryAfterMs?, body?, delayMs?, hang?, answers? }`: an error response, a delay before responding, a request that never answers (the client times out), or answers for this call only. Queues exist per rule and globally; the first matching rule's queue is used first. The queue applies in every mode. An outcome status is an error status from 400 to 599: `enqueue`, `setScript` and the server options throw a `RangeError` otherwise, and the admin endpoints `PUT /_fake/script` and `POST /_fake/outcomes` (both fakes) validate their body against the script schemas and answer 400 without changing any state.
- `scripted`: answers by question key with `*` wildcards (exact key first, then the wildcard with the longest literal part); rules `{ match: { questions, stateIncludes, model, where }, answers, outcomes }` override per request. A Choice is scripted as a label, `{ choice, confidence }` (the rest shared equally) or `{ probabilities }`; a Noul as a boolean or a probability; a Score as a level, `{ score, confidence }` or `{ probabilities }`. `fallback: 'uniform'` answers unscripted questions uniformly (the default of the container); otherwise an unscripted question is a 400.
- `cassette`: the key is `contentHash({ method: 'POST', path, body })` of ADR M03-cassettes, so recordings of the real API replay here; a miss answers 404 `CASSETTE_MISS` (not retried by the SDK) and nothing else.
- `oracle`: a truth function receives the validated request and returns, per question, a label or a set of equally correct labels (Choice), a boolean or probability (Noul), a level (Score), or nothing (uniform, 0.5). Probabilities are `p = (1 − a)·truth + a·noise`, `a` the amplitude in [0, 1], the noise vector a normalised draw of uniforms from sfc32 seeded by SHA-256 of the canonical `{ seed, request, key }`. Amplitude 0 gives the truth with probability 1; the same seed and request always give the same answer; a truth that does not fit the question is a 400. The amplitude is a server option (one server per amplitude); `startFakeJev` throws a `RangeError` when it lies outside [0, 1].
- `oracleFromTargets(map, options)` builds a truth function from "target description → correct candidate id (or null)": the description is `state.step.target` (text or `.description`); a Choice question that offers the id gets it, a Choice over the request's candidates (`state.candidates`, else the options of the first Choice question) that does not offer it gets the uniform answer, and every other Choice question keeps the fallback's truth; `target_present` is whether the id is among `state.candidates` (or the Choice options); `confirm_<x>` is whether `state.top.<x>` (an id, or an object with `cid` or `id`) is the correct candidate. Every accessor and key is an option, and `fallback` supplies truths for probes and expectations.

## Consequences

M06 builds its G5 oracle from grounding.jsonl with no fake-specific code in the Navigator. Ambiguity (dup-labels) is modelled by returning the set of indistinguishable candidates.
