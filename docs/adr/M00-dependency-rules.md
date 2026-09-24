# ADR M00-dependency-rules: Dependency rules and their check

- Status: accepted
- Date: 2026-09-24
- Module: M00

## Context

The architecture requires that core imports no adapter and that adapters are wired only
at composition roots, enforced by dependency-cruiser as a gate (M00-G3). The orchestration
added the core allow-list, the testkit rule and no cycles.

## Decision

`.dependency-cruiser.cjs` forbids, at severity error:

- `core-not-to-adapters`, `core-only-core-and-ports` (inside its package, core imports
  only core and ports, so it cannot reach an adapter through the index),
  `core-not-to-io-builtins` (fs, fs/promises, net, http, https, http2, child_process,
  dgram, dns, dns/promises, tls, worker_threads, cluster), `core-npm-allow-list`
  (`@argus/contracts`, `@sinclair/typebox`), `core-not-to-other-workspace-packages`;
- `adapters-only-from-composition-roots` (a package's own `src/index.ts` and
  `src/adapters/**`, `apps/*/src/main.ts`, `apps/*/src/wiring/**`) and
  `adapters-not-across-packages`;
- `no-testkit-in-production` (any `src/**` of packages and apps, except the testkit
  itself and `apps/fixture-hmi`; tools and tests may import it);
- `no-circular` and `not-to-unresolvable`.

Paths match with an optional prefix, so the fixture trees under
`tools/gate/test/fixtures/depcruise` (one per rule, plus a compliant tree) exercise the
same rules. `node_modules` stays in the graph as leaves, never excluded, or the npm rule
could not see anything. Resolution uses the `@argus/source` condition.

A tool's composition root is its `src/main.ts`, which imports its adapters through the
package's own index, the same way an app imports another package; no rule is relaxed for
tools.

`pnpm depcruise` wraps dependency-cruiser: without paths it checks `packages`, `apps` and
`tools` minus `test/fixtures`; with paths it checks exactly those. The verdict comes from
the JSON report's error count, because dependency-cruiser's exit code is the number of
errors (it wraps at 256) and is always 0 for JSON output.

## Consequences

Core code needing time, ids or I/O goes through ports. A new allowed npm package for core
is an edit of the allow-list and this ADR.
