# ADR M07-report: Report draft, code-owned fields and buildRunReport

- Status: accepted
- Date: 2026-09-25
- Module: M07

## Context

The report's output schema has no `verdict`, `flags` or `stats`; code injects them. `ReportBody` also holds fields a model should not invent: defect ids and signatures (the hash of the normalised intent, break reason and top console error), heals from locator memory, and `generatedBy`.

## Decision

- The model answers a closed `ReportDraft` (internal to the Analyst): `summary`, `defects` (`stepId`, `title`, `severity`, `classification`), `adjudications` (`stepId`, `MARK_PASSED` or `RESOLVE_TARGET`, `rationale`) and `maintenance`. No schema the model answers to has `verdict`, `flags` or `stats`, and every one is closed, so an answer carrying them fails validation, gets its one repair attempt, and then ends as `ANALYST_INVALID`.
- Code checks the draft against the ledger: a defect only for a step whose last `step.finished` outcome is `failed`; an adjudication only where a valid `escalation.decided` with that decision exists; step ids from the script. It then adds `def_NN` ids in order, `defectSignature({ intent, reason, topConsoleError })` (top console error `null` here, since `ReportInput` carries no console; M16 recomputes with it when it has it), `heals: []` and `generatedBy { model, promptVersion }`, and validates the `ReportBody`.
- `buildRunReport(reportBody, { runId, verdict, flags, stats, heals? })` validates the body as `ReportBody` (a body carrying `verdict`, `flags` or `stats` is refused), injects the computed fields and the heals the caller knows from locator memory, and validates the `RunReport`.
- The report run facts (verdict, flags, stats) are sent to the model as data so it can describe them.

## Consequences

The model cannot alter the verdict or invent defects on passed steps. Heals are the engine's and control plane's knowledge, not the model's.
