# ADR M00-gate-guard: Protected-path classification

- Status: accepted
- Date: 2026-09-24
- Module: M00

## Context

Protected paths never change in the same commit as implementation code (CLAUDE.md
section 2); `gates/evidence/**` and `docs/gate-changes/**` are neutral. The working loop
also requires the gates-first commit to carry the gate tests with `gates/<MOD>.yaml`. If
test files counted as implementation, that commit would always violate the rule.

## Decision

- Protected, exactly as CLAUDE.md: `gates/*.yaml`, `**/__golden__/**`, `thresholds/**`,
  `prompts/**`, `packages/navigator/src/questions.ts`.
- Neutral: `gates/evidence/**`, `docs/gate-changes/**`, and tests: a project's root
  test directory (`apps/*/test/**`, `packages/*/test/**`, `tools/*/test/**`) and
  `**/*.test.*`, `**/*.spec.*`. A `test/` directory inside `src/` is implementation code.
  Protected wins, so a golden file under `test/` stays protected.
- Everything else, documentation and package manifests included, is implementation.
- Violation: protected and implementation paths in the same change.
- `--range` without `--per-commit` checks the range as one change; with it, each commit
  against its first parent; merge commits are skipped because their commits are checked
  one by one. `--conventional` also checks subjects:
  `type(scope)!: subject` with the usual types.
- A range is `<base>..<head>` split at its only `..` (refs may contain single dots but
  never `..`); git validates the refs.
- Paths come from `git diff --name-only --no-renames -z`, so a rename counts on both
  sides.

## Consequences

A test can change with either side, which is what the working loop needs. A weakened
assertion in a test is caught by the independent review (ADR-0015), not by the guard.
