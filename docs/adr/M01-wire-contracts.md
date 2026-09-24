# ADR M01-wire-contracts: Navigator, Analyst, brain and runner bodies

- Status: accepted
- Date: 2026-09-24
- Module: M01

## Context

The spec shows `GroundResult`, the break packet, the decision and the report by example
and lists the runner and brain routes without their bodies.

## Decision

- `GroundRequest`: run id, step id, risk, the step (intent, action type, target) and a
  navigator-facing observation, plus optional `exclude` candidate ids. `GroundResult` is
  the spec interface. `VerifyRequest` carries `before?`, `after`, `expectations` keyed
  `expect_<i>`, `probes`, handler conditions and the step's `expectedScreen`;
  `VerifyResult` returns `answers`, `probes`, `handlers`, an optional `screen` Choice,
  model, token usage, latency and cache hit.
- `BreakPacket` follows the example; it may list up to five `candidates` for
  `RESOLVE_TARGET`, and its step may carry action, risk and target. `AnalystDecision`
  follows the example plus `resolveTarget: {cid}`; patch actions reuse the action union
  with `PatchTarget`, which has no `locator`, so every patch target is grounded.
  Evidence items reference a frame, an observation, a check, a console or a network
  entry by index, with a note. `defect` and `scriptSuggestion` are nullable.
- `ReportBody` has no verdict, flags or stats; `RunReport` adds them with `runId`.
  `ReportInput` carries the verdict, flags and stats so the report can describe them.
- Every brain response is `{ result, usage }`; `BrainUsage` names provider, model,
  calls, tokens and the billable operation (`null` when the step rate covers it).
  Images travel inline as base64 (`InlineImage`), so the brain needs no object-store
  access: `TriageRequest` is the packet plus up to six frames, vision requests carry
  their screenshot. `BRAIN_ENDPOINTS` maps each route to its bodies.
- Runner protocol (`RUNNER_ENDPOINTS`): register (name, version, kind, slots, labels)
  returns a session token and intervals; lease returns `{leaseId, expiresAt,
  heartbeatIntervalSec, job}` or 204. The job carries the script and its hash, the
  environment with allow-lists, read-only flag and `${env.*}` values, the resolved
  policy, variables, secrets (values for vault secrets, names only for runner-local
  ones), budgets, the brain URL and run token, and CI metadata. Heartbeat returns
  `cancel`; events are NDJSON `RunEvent` lines (`RunEventBatch` once parsed) answered by
  accepted, duplicate and last sequence counts; artifacts returns pre-signed PUT URLs;
  complete sends termination, last sequence and counters, and returns verdict, flags and
  credits.
- Problem codes and statuses: the spec's six plus `validation_failed` 400,
  `unauthorized` 401, `forbidden` 403, `target_not_verified` 403, `not_found` 404,
  `conflict` 409, `gap_detected` 409 (with `expectedSeq`), `rate_limited` 429,
  `internal` 500; `type` is `https://argus.dev/problems/<code>`.
- `UsageEvent`: id, org, project and run (null for compiles), rate-card operation,
  quantity, AI mode, model tier, runner kind, applied rate, credits and timestamp.

## Consequences

M09, M11 and M12 validate their bodies with `validate()` against these names.
