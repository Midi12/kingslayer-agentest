# ADR M07-budgets: Token estimates, frame selection and deterministic reduction

- Status: accepted
- Date: 2026-09-25
- Module: M07

## Context

Budgets are enforced before the call: triage at most 20,000 tokens and six frames, report at most 16,000 tokens (M19-G5 later requires at most 12,000), frames three to six around the break with the long edge scaled to 1,280 px, and an oversize ledger summarised deterministically, never cut mid-record. The tokeniser, the order of reductions and the vision budget are open.

## Decision

- Estimate: the base is a third of the UTF-8 bytes of every text (system, messages, the JSON schema sent), close to what earlier tokenisers give for mixed prose and JSON. It is not conservative on its own: the tokeniser of the recommended defaults (`claude-sonnet-5`, `claude-opus-5`) gives up to about 30% more tokens than earlier ones, and hex digests tokenise densely. Until M19-G5 calibrates the estimate against billed tokens, text counts with an explicit safety factor of 1.5 over the base (half a token per byte), and each run of 16 or more hex digits (sha256 digests, ids) counts one token per 1.5 digits. Each message adds 8 tokens, and each image the larger of Anthropic's `w·h/750` and OpenAI's high-detail `85 + 170 × tiles`, published formulas that need no factor. The constants are in `core/tokens.ts`; M19-G5 replaces them with measured ratios.
- Budgets: triage 20,000 tokens. The report default is 12,000, below the 16,000 the M07 spec allows, because M19-G5 requires report input of at most 12,000 tokens; a caller may raise it up to 16,000.
- The first request is fitted to the budget less 2,500 tokens kept for the repair request. The repair quotes at most 3,000 characters of the rejected answer and 12 errors of at most 300 characters. Both are JSON-escaped inside data blocks, where markup can grow sixfold, so the repair is measured once built: while it exceeds the full budget the quote is halved (and dropped below 100 characters), then the error list is halved. The repair is not sent (`invalid_answer`) only when a repair with no quote and one error still does not fit. A first request that cannot fit is never sent (`invalid_request`).
- M07-G5 measures what the fake LLM received with the base estimate (a third of the bytes), so it bounds the requests' size; it is not evidence of billed tokens, which only M19-G5 measures.
- Frames: those with an image, nearest the break first (equal distance: before the break first), at most six, sent in time order after being scaled by sharp through the `ImageScaler` port (`SharpImageScaler`, media type kept, never upscaled). A frame that does not decode is left out. Fewer than three are sent only when fewer have images.
- Triage reduction drops whole records in this order until the estimate fits: debug and info console lines, passing checks, step intents older than the last three, successful requests, console warnings, the before page, frames beyond three (farthest first), console errors, failed requests, the after page, failing checks. Records keep their packet indices so evidence references stay valid, and an `omitted` object counts what was left out.
- Report reduction: each ledger event is one line `{ seq, ts, type, stepId?, data }` (without `runId` and `prev`) or dropped whole; each run of dropped events becomes one line `{ "omitted": { fromSeq, toSeq, count, types } }`. Classes: 0 (run start and end, escalations, steps that did not pass) is never dropped; 1 (other step events, BREAK decisions, failed actions and checks, handlers); 2 (routine decisions, actions, passing checks, grounding); 3 (verify answers, observations, artifacts, usage). Drop order: class 3, class 2, key frames (last first; at most four are considered), class 1, oldest first in each class; the smallest prefix that fits is found by bisection.
- Vision requests have a 20,000-token budget; grounding drops mark labels (the marks stay: they are the closed set), an assertion drops frames from the end.

## Consequences

The same input always gives byte-identical requests, which cassettes (M03) and M19 rely on. The budgets are constants in `core/budgets.ts`; the brain may lower them per tier.
