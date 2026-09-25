# ADR M07-report: Report draft, code-owned fields and buildRunReport

- Status: accepted
- Date: 2026-09-25
- Module: M07

## Context

The report's output schema has no `verdict`, `flags` or `stats`; code injects them. `ReportBody` also holds fields a model should not invent: defect ids and signatures (the hash of the normalised intent, break reason and top console error), heals from locator memory, and `generatedBy`.

## Decision

- The model answers a closed `ReportDraft` (internal to the Analyst): `summary`, `defects` (`stepId`, `title`, `severity`, `classification`), `adjudications` (`stepId`, `MARK_PASSED` or `RESOLVE_TARGET`, `rationale`) and `maintenance`. No schema the model answers to has `verdict`, `flags` or `stats`, and every one is closed, so an answer carrying them fails validation, gets its one repair attempt, and then ends as `ANALYST_INVALID`.
- Code checks the draft against the ledger, both ways: a defect only for a step whose last `step.finished` outcome is `failed`, and at least one defect for every failed step whose last valid `escalation.decided` was `MARK_FAILED_*` with `PRODUCT_DEFECT`; an adjudication only where a valid `escalation.decided` with that decision exists, and every such `MARK_PASSED` or `RESOLVE_TARGET` escalation listed; step ids from the script. A draft that drops one of them is invalid and gets the repair attempt with the missing items named. It then adds `def_NN` ids in order, `defectSignature({ intent, reason, topConsoleError })` (top console error `null` here, since `ReportInput` carries no console; M16 recomputes with it when it has it), `heals: []` and `generatedBy { model, promptVersion }`, and validates the `ReportBody`.
- `buildRunReport(reportBody, { runId, verdict, flags, stats, heals? })` validates the body as `ReportBody` (a body carrying `verdict`, `flags` or `stats` is refused), injects the computed fields and the heals the caller knows from locator memory, and validates the `RunReport`.
- The report run facts (verdict, flags, stats) are sent to the model as data so it can describe them.

## Consequences

The model cannot alter the verdict, invent defects on passed steps, or hide a product defect or an adjudication the ledger records. Until M16 recomputes signatures with the top console error, defects of the same step and reason that differ only by console error share a signature; M16 must recompute them before de-duplicating. Heals are the engine's and control plane's knowledge, not the model's.
