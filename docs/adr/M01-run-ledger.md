# ADR M01-run-ledger: Run event envelope and data

- Status: accepted
- Date: 2026-09-24
- Module: M01

## Context

The spec gives the envelope `{ runId, seq, ts, type, stepId?, data, prev }`, gapless
`seq`, `prev` as the SHA-256 of the previous event's canonical JSON, and one line of data
per type. The first sequence number, the first `prev` and the exact data shapes are open.

## Decision

- `seq` starts at 1, so `GET /runs/{id}/events?after=0` returns a whole run. The first
  event has `prev: null`; every later event has `prev = contentHash(previous event)`
  (RFC 8785 canonical JSON, `sha256:<hex>`).
- `stepId` is required on step-scoped types, optional on `artifact.stored` and
  `usage.recorded`, and absent on `run.started` and `run.finished`
  (`RUN_EVENT_STEP_SCOPE`).
- Data per type, closed: `run.started` runner id, script hash, environment, resolved
  policy and versions (engine, questions, thresholds, models by role); `step.started`
  attempt and index; `step.finished` attempt, outcome, duration, break reason or null,
  optional classification and adjudicated flag; `observation.captured` observation id,
  digest hash, artifact references; `navigator.ground` request hash, pick, confidence,
  top five `{cid, p}`, target-present, optional stage-two Nouls, source, latency, input
  tokens; `navigator.verify` optional request hash, answers by question id, latency,
  tokens; `action.performed` type, resolved locator, duration, error; `check.evaluated`
  kind, expectation index, outcome (pass, fail, error), measured values;
  `decision.made` rule 1 to 11, engine decision (CONTINUE, RETRY, WAIT, RUN_HANDLER,
  BREAK), reason, optional handler; `handler.fired` handler id; `escalation.requested`
  packet reference, reason, attempt; `escalation.decided` decision, classification,
  validity, validator errors, repaired flag, tokens; `artifact.stored` kind, reference,
  bytes, SHA-256; `usage.recorded` rate-card operation and quantity; `run.finished`
  termination (completed, aborted, canceled, setup_failed, runner_lost), reason and
  counters.
- Step outcomes are passed, failed, broken and skipped; verdicts passed, failed, broken,
  aborted and canceled.

## Consequences

The engine (M10) builds and verifies the chain with `canonicalize` and `contentHash`; the
api (M12) rejects gaps with `gap_detected` and computes verdict and settlement from these
events alone.
