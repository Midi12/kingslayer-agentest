# ADR M07-live-quality: M07-G7 as the triage half of M19-G6

- Status: accepted
- Date: 2026-09-25
- Module: M07

## Context

M07-G7 (Tier B) "runs as M19-G6": on the 60 labelled breaks, decision matches the label in at least 85%, classification in at least 80%, zero answers invalid after repair. No LLM key exists on this host (ADR-0016), and the labelled break packets come from runs of M02's `breaks.jsonl` scenarios, which only exist after M10.

## Decision

- The instrument lives in the Analyst: `parseLabelledBreaks` (JSON Lines of `{ id, packet, frameImages?, label { decision, classification } }`, every packet validated), `runTriageEvaluation` and `scoreTriage` (matches over all cases, invalid-after-repair, unavailable, repaired, largest input). It is tested against the fake LLM in Tier A; its verdict counts only against a live model.
- `pnpm --filter @argus/analyst test:gate-g7` runs `scripts/live-triage-eval.ts`: it builds the configured live provider (`ARGUS_LLM_PROVIDER` anthropic or openai-compatible, `ARGUS_LLM_API_KEY`, `ARGUS_LLM_BASE_URL`, the tier's model), refuses `fake`, reads `eval/datasets/triage-breaks.jsonl` (or `ARGUS_TRIAGE_DATASET`), writes the metrics and a result file with model and prompt versions under `eval/results/M07-G7/`. The gate requires `ARGUS_LLM_API_KEY` and reports `not_run` without it; with a key and no dataset it fails, stating that the dataset is missing.
- M19 builds the dataset and runs the same functions for M19-G6.

## Consequences

M07 closes with G7 `not_run`; the result is filed with M19's first full pass, and a failure goes to a human (implementation spec, M19).
