# ADR M07-budgets: Token estimates, frame selection and deterministic reduction

- Status: accepted
- Date: 2026-09-25
- Module: M07

## Context

Budgets are enforced before the call: triage at most 20,000 tokens and six frames, report at most 16,000 tokens, frames three to six around the break with the long edge scaled to 1,280 px, and an oversize ledger summarised deterministically, never cut mid-record. The tokeniser, the order of reductions and the vision budget are open.

## Decision

- Estimate: a third of the UTF-8 bytes of every text (system, messages, the JSON schema sent), 8 tokens per message, and per image the larger of Anthropic's `w·h/750` and OpenAI's high-detail `85 + 170 × tiles`. Real tokenisers give fewer tokens for prose, so the estimate errs high; M19-G5 compares it with billed tokens.
- The first request is fitted to the budget less 2,500 tokens kept for the repair request (which quotes at most 3,000 characters of the rejected answer and 12 errors); the repair request is checked against the full budget before it is sent. A request that cannot fit is never sent (`invalid_request`).
- Frames: those with an image, nearest the break first (equal distance: before the break first), at most six, sent in time order after being scaled by sharp through the `ImageScaler` port (`SharpImageScaler`, media type kept, never upscaled). A frame that does not decode is left out. Fewer than three are sent only when fewer have images.
- Triage reduction drops whole records in this order until the estimate fits: debug and info console lines, passing checks, step intents older than the last three, successful requests, console warnings, the before page, frames beyond three (farthest first), console errors, failed requests, the after page, failing checks. Records keep their packet indices so evidence references stay valid, and an `omitted` object counts what was left out.
- Report reduction: each ledger event is one line `{ seq, ts, type, stepId?, data }` (without `runId` and `prev`) or dropped whole; each run of dropped events becomes one line `{ "omitted": { fromSeq, toSeq, count, types } }`. Classes: 0 (run start and end, escalations, steps that did not pass) is never dropped; 1 (other step events, BREAK decisions, failed actions and checks, handlers); 2 (routine decisions, actions, passing checks, grounding); 3 (verify answers, observations, artifacts, usage). Drop order: class 3, class 2, key frames (last first; at most four are considered), class 1, oldest first in each class; the smallest prefix that fits is found by bisection.
- Vision requests have a 20,000-token budget; grounding drops mark labels (the marks stay: they are the closed set), an assertion drops frames from the end.

## Consequences

The same input always gives byte-identical requests, which cassettes (M03) and M19 rely on. The budgets are constants in `core/budgets.ts`; the brain may lower them per tier.
