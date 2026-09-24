# ADR M00-toolchain: Tool versions and how the tools run

- Status: accepted
- Date: 2026-09-24
- Module: M00

## Context

M00 fixes the workspace tooling every later module uses (implementation spec, M00). The
orchestration asked for TypeScript 5.x, Vitest 3.x, ESLint 9, Prettier 3, Turborepo 2,
dependency-cruiser and tsx, each at the current stable version of its line.

## Decision

- Exact pins, no ranges: typescript 5.9.3, vitest and @vitest/coverage-v8 3.2.7,
  fast-check 4.10.2, eslint and @eslint/js 9.39.5, typescript-eslint 8.70.1,
  eslint-config-prettier 10.1.8, globals 17.12.0, prettier 3.9.9, dependency-cruiser
  18.4.0, turbo 2.11.3, tsx 4.23.15, @types/node 22.20.4. Tool runtimes of the gate tool:
  yaml 2.9.1 and @sinclair/typebox 0.34.52 (the TypeBox line @argus/contracts will use).
  ESLint 9 is past its support window (npm marks 9.39.5 deprecated); it stays until the
  whole workspace moves to ESLint 10 in one change.
- Development tools are root devDependencies; a package declares what it imports at run
  time.
- `pnpm gate`, `pnpm g0`, `pnpm depcruise` and `pnpm gate-guard` run the TypeScript
  sources through tsx (`tools/*/bin/*.js` register tsx plus a resolve hook that adds the
  `@argus/source` condition, then import `src/main.ts`), so a clean clone can gate itself
  without a build, also once the tools import workspace packages. tsx is a dependency of those two tools.
- ESLint: `typescript-eslint` `strictTypeChecked` with the project service,
  `no-explicit-any` and `no-non-null-assertion` as errors, unused variables allowed only
  with a leading underscore, `eqeqeq`, and unused disable directives reported.
  JavaScript files are linted without type information.
- Prettier formats code and configuration, not Markdown: the program documents keep
  their hand-aligned tables and parallel worktrees do not fight over whitespace.
- Turborepo runs `build` after `^build`; `typecheck`, `lint` and `test` need no build
  because of the `@argus/source` condition. `envMode` is `loose` so test tasks see
  service URLs and credentials without a list to maintain; `pnpm test` runs two
  packages at a time.
- pnpm `injectWorkspacePackages: true` (required by `pnpm deploy` in pnpm 10). pnpm
  still links a workspace package when injection changes nothing, which is the case for
  every package so far.

## Consequences

Upgrades are deliberate one-line changes. A tool that needs a build step to run would
have to change the bin launchers.
