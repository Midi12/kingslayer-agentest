# ADR M07-decision-matrix: Menu rows beyond the table and validation rules

- Status: accepted
- Date: 2026-09-25
- Module: M07

## Context

The "Allowed decisions by break reason" table lists 13 break reasons; the contracts define 21. The product design adds that `MARK_FAILED_CONTINUE` is allowed only when the step is not critical and `MARK_PASSED` is off under strict. The AnalystDecision rules leave open how relative URLs, `http` patches, templates and packets whose menu was tampered with are handled.

## Decision

- `allowedDecisions(reason, { strict }, { critical })` implements the table cell by cell; `MARK_FAILED_*` expands to `MARK_FAILED_ABORT` (column yes) and `MARK_FAILED_CONTINUE` (column yes and the step not critical); "unless strict" is `MARK_PASSED` when not strict. The result is in the canonical order of `ANALYST_DECISIONS`.
- Extension rows: `CONSOLE_OR_NETWORK_ERROR` takes the row of the failed checks (retry, mark failed, abort; no patch, no pass: the policy forbids the errors). `OBSERVE_FAILED` and `NAVIGATOR_UNAVAILABLE` take the row of `TARGET_NOT_FOUND`. `SETUP_FAILED`, `BUDGET_EXHAUSTED`, `RUNNER_LOST`, `ANALYST_UNAVAILABLE` and `ANALYST_INVALID` never escalate: the menu is empty and `isEscalable` is false. The golden file `packages/analyst/test/__golden__/decision-matrix.json` holds the table and these rows.
- `validateDecision(packet, candidate)` takes untrusted JSON: the `AnalystDecision` schema first, then every rule, returning all issues with a rule name: the decision is in `allowed.decisions` and in the matrix row of the packet's reason for its criticality (a partial defence against a tampered menu, see below); PATCH carries 1 to `budget.patchActionsMax` actions, each of a type in `allowed.patchActions`, and no other decision carries actions; every URL a patch loads (navigate, http) must stay inside the allowed origins whatever base the runner resolves it against: an absolute URL must be written `http://` or `https://`, carry no credentials and have an allowed origin; any other scheme (`javascript:`, `data:`, and the base-dependent `https:host` or `http:/host`, which are relative only to a base of the same scheme) is refused; a relative URL may not start with `//` and must resolve to the base's own origin against every allowed origin; and a URL with leading or trailing spaces, a control character (which the URL parser strips, so `\t//host` reads as `//host`) or a backslash (read as `/`) is refused. The decision keeps the URL as written, which is safe because every accepted form means the same origin under any allowed base; patch values are literal, so any `${…}` template is rejected; RESOLVE_TARGET names a cid listed in `packet.candidates` and no other decision carries `resolveTarget`; every evidence reference (frame ref, observation, check, console and network index) exists in the packet; `MARK_FAILED_*` with `PRODUCT_DEFECT` has a defect.

## Consequences

The engine (M10) builds the packet menu with the same function, so a packet can never offer what the table forbids. The validator's matrix check is a partial defence against a menu tampered with after that: `BreakPacket` carries no strict flag, so the check uses the non-strict row and cannot see that `MARK_PASSED` was added to a strict packet's menu; and it knows a step is critical only from the optional `script.step.risk`, so a packet without it is checked as non-critical. The menu itself is therefore trusted as built by M10; the check catches decisions no policy could ever allow for the reason. Adding a break reason to the contracts needs a row here and in the golden file, or it does not escalate.
