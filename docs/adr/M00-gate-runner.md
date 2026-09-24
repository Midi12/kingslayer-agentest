# ADR M00-gate-runner: Gate runner semantics and evidence

- Status: accepted
- Date: 2026-09-24
- Module: M00

## Context

The spec fixes the gate file, `$GATE_METRICS` and an evidence example, but leaves open
how requirements are told apart, what the expression language accepts, what `pass`
means with gates that did not run, and where tier-filtered runs and logs go.

## Decision

- Gate files are `gates/<MOD>.yaml` only (`.yml` is not read, so the protected glob
  `gates/*.yaml` covers every gate file). Unknown keys are errors; `timeoutSec` is
  required; `requires` defaults to `[]`. Module ids are `M` or `S` with two digits
  (`M00`, `S03`) or `D` with one or two digits (the delivery modules `D1`, `D2` of the
  plan); gate ids are `<module>-G<n>`. `all` reads every gate file named by a module id,
  delivery files included, so a `gates/D1.yaml` joins the regression suite.
- `requires`: UPPER_SNAKE_CASE means an environment variable (set and non-empty),
  anything else a tool (`command -v`), `env:`/`tool:` force the reading, and `docker`
  also needs `docker info`. Reasons read `missing credentials: A, B; missing tools: x (why)`.
- Commands run as `bash -c` from the repository root in their own process group, with
  `GATE_METRICS`, `GATE_ID`, `GATE_MODULE`, `GATE_TIER`. On timeout the group gets
  SIGTERM, then SIGKILL after 5 s; `exitCode` is then null and the gate fails.
- Expressions (grammar in `tools/gate/README.md`) have no coercion and must yield a
  boolean. Every referenced metric is checked before evaluation, so a missing metric
  fails the gate even behind `||`. Type errors fail the gate with the message.
- Status: `not_run` when a requirement is missing; otherwise `pass` only when the
  expression holds, the command did not time out and the metrics file (if any) holds a
  JSON object. Evidence `pass` is true only when every selected gate passed; `passByTier`
  holds the per-tier verdict of the spec; `notRun` lists ids and reasons. The exit code
  follows the orchestration: 1 on any failure, and with `--strict` on any `not_run`.
- Evidence adds `evidenceVersion`, `title`, `worktreeClean`, `strict`, `finishedAt`,
  and per gate `status`, `reason`, `requires`, `passExpression`, `signal`, `timedOut`,
  `missingMetrics`, `expressionErrors`, `log`. `evidenceHash` is SHA-256 over the RFC
  8785 canonical JSON of the document without that member; `pnpm gate verify` rechecks
  it. The canonicaliser lives in `tools/gate` until `@argus/contracts` exists.
- A run with `--tier` writes `<MOD>.tier-<T>.json`; logs go to
  `gates/evidence/logs/<MOD>/<ID>.log`. Both are git-ignored: only the full
  `<MOD>.json` is committed. The evidence says so in `logsGitIgnored` (from `git
  check-ignore` on the log directory), so a reader of the merged tree knows the `log`
  paths point at the machine that ran the gates. The evidence commit carries the JSON
  alone (CLAUDE.md step 6); the verdict rests on the recorded metrics, exit code and
  `reason`, not on the logs.
- Exit code 2 for usage errors and invalid gate files, before any command runs.

## Consequences

A module with Tier B gates and no credentials has `pass: false` in its evidence with a
`notRun` entry, and `pnpm gate` still exits 0 unless `--strict`. Reviewers read
`passByTier`.
