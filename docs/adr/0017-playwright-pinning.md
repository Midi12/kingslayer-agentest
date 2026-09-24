# ADR-0017: Playwright version and browser provisioning

- Status: accepted
- Date: 2026-09-24
- Module: program

## Decision

`playwright`, `playwright-core` and `@playwright/test` are pinned to `1.56.1` (Chromium build 1194). The runner image copies browsers from the named build context `pw-browsers`. By default that context is a Dockerfile stage running `playwright install chromium`; in environments without the Playwright CDN, the bake file points it at a local browsers directory (`--set *.contexts.pw-browsers=/opt/pw-browsers`). Chromium system libraries come from Ubuntu 24.04 packages. Upgrading Playwright is a deliberate change with an ADR.
