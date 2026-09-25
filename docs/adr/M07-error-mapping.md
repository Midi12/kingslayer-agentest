# ADR M07-error-mapping: Analyst errors, break reasons and retries

- Status: accepted
- Date: 2026-09-25
- Module: M07

## Context

`AnalystError` (M01) has four codes: `unavailable`, `invalid_request`, `invalid_answer` and `redaction_failed`. The break reasons have two members for the Analyst: `ANALYST_UNAVAILABLE` and `ANALYST_INVALID`. The spec maps an invalid answer after the repair to `ANALYST_INVALID` and an Analyst that is down to `ANALYST_UNAVAILABLE`; it says nothing of a request the Analyst refuses before calling the provider. Some of those refusals are deterministic: the same call fails the same way however often it is retried.

## Decision

- `analystBreakReason` maps `invalid_answer` to `ANALYST_INVALID` and every other code to `ANALYST_UNAVAILABLE`. A new break reason would be a contracts change (M01) and a new row in the decision matrix; the two Analyst reasons already never escalate and break the step, which is the right outcome for a refused request too.
- `invalid_request` covers: a schema-invalid input (`BreakPacket`, `ReportInput`, vision requests), a first request that still exceeds its budget after every reduction, an unknown pinned prompt version, a screenshot that does not decode, and a provider 400, 404, 413 or 422. None of them is transient.
- `isTransientAnalystError(error)` is true only for `unavailable`. M09 and M10 use it rather than the break reason to decide whether to retry, back off or open a circuit: a `ANALYST_UNAVAILABLE` break whose error was `invalid_request` is not retried and does not count as provider downtime. The error message says which refusal it was, so M10 can keep it with the break. (A repair that cannot fit its budget is not a refusal: it ends as `invalid_answer`.)

## Consequences

The ledger cannot tell a provider outage from a refused request by break reason alone; the error code and message carry the difference. If M19 shows refused requests are frequent enough to need their own reason, that is a contracts change for M01 and a matrix row here.
