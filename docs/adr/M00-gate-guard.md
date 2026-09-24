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
- Neutral: `gates/evidence/**`, `docs/gate-changes/**`.
- Tests: a project's root test directory (`apps/*/test/**`, `packages/*/test/**`,
  `tools/*/test/**`) and `**/*.test.*`, `**/*.spec.*`; a `test/` directory inside `src/`
  is implementation code. Protected wins, so a golden file under `test/` stays protected.
  Tests may change with implementation in any commit. With protected paths they may
  change only in a commit whose subject is `test(<MOD>): …` (gates first) or
  `chore(<MOD>): gate-change …` (step 5 of the working loop, where a gate's mechanism can
  live in its test). When the subject is unknown (`--files` without `--subject`,
  `--diff`, a range checked as a whole) tests are neutral.
- Everything else, documentation and package manifests included, is implementation.
- Violation: protected paths with implementation paths in the same change, or with tests
  in a commit whose known subject is neither of the two above.
- `--range` without `--per-commit` checks the range as one change; with it, each commit
  against its first parent; merge commits are skipped because their commits are checked
  one by one. `--conventional` also checks subjects:
  `type(scope)!: subject` with the usual types.
- A range is `<base>..<head>` split at its only `..` (refs may contain single dots but
  never `..`); git validates the refs.
- Paths come from `git diff --name-only --no-renames -z`, so a rename counts on both
  sides.

## Consequences

A commit that lowers a bound in `gates/Mxx.yaml` and weakens the matching gate test under
a `fix(...)` or `feat(...)` subject fails the per-commit check. A gate-change commit can
still carry both; its note and the independent review (ADR-0015) judge it. A weakened
assertion in an ordinary implementation commit is also left to the review.
