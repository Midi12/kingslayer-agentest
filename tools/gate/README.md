# @argus/gate-tool

The gate runner (`pnpm gate`), global gate G0 (`pnpm g0`) and the dependency-rule check
(`pnpm depcruise`). The tools run from their TypeScript sources through tsx; no build is
needed.

## Quick start against the sample gates

```sh
pnpm install
pnpm gate all --gates-dir tools/gate/test/fixtures/gates --evidence-dir /tmp/ev  # pass, fail, fail; exit 1
pnpm gate verify /tmp/ev/M91.json                                                # evidenceHash ok
pnpm depcruise tools/gate/test/fixtures/depcruise/core-to-adapter                # a rule fires; exit 1
pnpm g0 tools/gate                                                               # G0 on one package
```

## `pnpm gate <MOD|all> [--tier A|B|C] [--evidence-dir <dir>] [--gates-dir <dir>] [--strict] [--verbose]`

Reads `gates/<MOD>.yaml` (or, for `all`, every `gates/<id>.yaml` whose name is a module
id: `M00`..`M99`, delivery `D1`, `D2`, scenario `S01`..`S99`), checks
each gate's `requires`, runs its `command` with `bash -c` from the repository root under
`timeoutSec`, evaluates `pass`, and writes `gates/evidence/<MOD>.json` plus a log with the
last 200 output lines under `gates/evidence/logs/<MOD>/`. A tier-filtered run writes
`<MOD>.tier-<T>.json` instead, so it never overwrites a module's committed evidence.

| Exit | Meaning |
| --- | --- |
| 0 | no selected gate failed (gates that did not run are allowed unless `--strict`) |
| 1 | a gate failed, or with `--strict` a gate did not run |
| 2 | usage error or invalid gate file |

`pnpm gate verify <evidence.json...>` recomputes `evidenceHash`.

### Gate file

```yaml
module: M06
title: Navigator
gates:
  - id: M06-G1                  # <module>-G<n>, unique
    tier: A                     # A hermetic, B live AI, C deployment
    title: Requests conform to the TypeSafe API
    command: pnpm --filter @argus/navigator test:gate-g1
    timeoutSec: 900             # required; the process group is killed after it
    requires: []                # optional; see below
    pass: exitCode == 0 && metrics.tasks >= 120 && metrics.invalid == 0
```

The file is validated with a TypeBox schema (no unknown keys) plus: ids belong to the
module, ids are unique, and every `pass` expression parses.

`requires` entries: an UPPER_SNAKE_CASE name is an environment variable that must be set
and non-empty; anything else is a tool found with `command -v`; `env:` and `tool:` force
either reading. The tool `docker` also needs `docker info` to succeed. A missing
requirement makes the gate `not_run` with the reason, for example
`missing credentials: TYPESAFE_API_KEY`.

### Commands and metrics

Commands run with `GATE_METRICS` (a fresh JSON file path), `GATE_ID`, `GATE_MODULE` and
`GATE_TIER` set. A command writes a JSON object to `$GATE_METRICS`
(`recordGateMetrics` in `@argus/testkit` merges into it). No file means no metrics; a file
that is not a JSON object fails the gate.

### Pass expressions

Parsed and evaluated by `src/core/expression.ts`; never `eval`. Literals (numbers,
`'strings'` or `"strings"`, `true`, `false`, `null`), `exitCode` (null after a timeout or a
signal), `durationMs`, `metrics.<path>` (dots, numeric segments index arrays), `==`, `!=`,
`<`, `<=`, `>`, `>=`, `&&`, `||`, `!` and parentheses. No coercion: `==` compares scalars by
type and value, ordering needs two numbers or two strings, `&&`, `||` and `!` need booleans,
and the result must be a boolean. A referenced metric the command did not write makes the
expression false and is reported under `missingMetrics`, even behind a short circuit. `!`
applies to a whole comparison; comparisons do not chain.

### Evidence

`evidenceVersion`, `module`, `title`, `commit` (`git rev-parse --short HEAD`),
`worktreeClean`, `tier` (the filter or `all`), `strict`, `startedAt`, `finishedAt`,
`gates[]` (`id`, `tier`, `title`, `command`, `requires`, `passExpression`, `status`
`pass|fail|not_run`, `reason`, `exitCode`, `signal`, `timedOut`, `durationMs`, `metrics`,
`missingMetrics`, `expressionErrors`, `pass`, `log`), `pass` (every selected gate passed),
`passByTier`, `notRun[]`, `toolVersions` (node, pnpm, docker when present) and
`evidenceHash`: `sha256:` plus the hex SHA-256 of the RFC 8785 canonical JSON of the
document without `evidenceHash` (`src/core/canonical-json.ts`).

## `pnpm g0 <package-dir...>`

Global gate G0 per package: `tsc --noEmit -p <pkg>/tsconfig.json`, ESLint on the package,
`vitest run` with coverage in the package (line floor 85 for packages and tools, 70 for
apps; a package may configure more), dependency-cruiser on `<pkg>/src`, a scan of `src`
and `test` for forbidden markers, and proof from the network guard's report file that the
tests ran behind it. Skipped or todo tests count as failures. Metrics written to
`$GATE_METRICS`: `packages`, `typecheckErrors`, `typecheckFailures`, `lintErrors`,
`lintWarnings`, `tests`, `testsFailed`, `testsSkipped`, `vitestFailures`, `coverageLines`
(the lowest package), `coverageBelowFloor`, `depViolations`, `markers`,
`networkGuardMissing`, `failedPackages`, `perPackage`.

## `pnpm depcruise [--json <file>] [path...]`

Without paths: the real tree (`packages`, `apps`, `tools`), leaving out `test/fixtures`.
With paths: exactly those paths. The verdict comes from the JSON report's error count, not
from dependency-cruiser's exit code. The rules are in `.dependency-cruiser.cjs` (ADR
M00-dependency-rules).

## Layout

`src/core` pure logic (expression language, schema, canonical JSON, evidence, markers);
`src/ports` interfaces; `src/adapters` Node implementations; `src/app` the three commands;
`src/main.ts` the composition root; `bin/` tsx launchers used by the root scripts.
