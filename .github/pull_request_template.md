## Module

<!-- e.g. M06 Navigator. One module per merge request. -->

## Kind

- [ ] Gates first: `gates/<MOD>.yaml`, gate tests and golden files only
- [ ] Implementation: no protected path changed (`pnpm gate-guard --range <base>..<head> --per-commit`)
- [ ] Gate change: protected paths plus `docs/gate-changes/<MOD>-<n>.md` only

## Evidence

<!-- Attach or link gates/evidence/<MOD>.json from `pnpm gate <MOD>` on a clean checkout. -->

- Evidence file:
- `pnpm gate all --tier A`: pass / fail
- Tier B: pass / not_run (missing credentials) / fail

## ADRs

<!-- One link per decision the spec left open: docs/adr/<MOD>-<slug>.md -->

-

## New dependencies

<!-- One line each: name@version, purpose, licence, size. "None" if none. -->

-
