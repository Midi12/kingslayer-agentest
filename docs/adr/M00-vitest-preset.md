# ADR M00-vitest-preset: Shared Vitest preset in the testkit

- Status: accepted
- Date: 2026-09-24
- Module: M00

## Context

Every package needs the same test setup: the `@argus/source` condition, the Tier A
network guard, two worker processes at most, and the coverage floors of G0. Vitest loads
`vitest.config.ts` through Node before any resolve condition applies, so a bare import
of `@argus/testkit/vitest-preset` resolves to `dist`, which does not exist without a build.

## Decision

- The preset is `packages/testkit/src/vitest-preset.ts`. Each `vitest.config.ts` imports
  it by relative path (`../../packages/testkit/src/vitest-preset.js`) and calls
  `defineArgusVitestConfig({ kind })`. It is also exported as `@argus/testkit/vitest-preset`.
- It sets `resolve.conditions` and `ssr.resolve.conditions` to `@argus/source`, `module`,
  `node`, `development|production`; `setupFiles` starts with the network guard;
  `pool: 'forks'` with `maxForks` capped at 2; tests are `test/**/*.test.ts` without
  `**/fixtures/**`; V8 coverage of `src/**/*.ts` with `json-summary` and `text-summary`.
- Line thresholds: 85 for `kind: 'package'` (packages and tools) and 70 for `kind: 'app'`.
  A package may raise any threshold; a line threshold below the floor throws, so the
  config fails loudly instead of lowering G0.
- A repository test requires every workspace package to have a `vitest.config.ts` that
  calls the preset.

## Consequences

Tests and typechecks never need a build. The relative import couples config files to the
repository layout; moving the testkit means one search and replace.
