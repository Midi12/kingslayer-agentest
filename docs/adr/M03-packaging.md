# ADR M03-packaging: Package graph, the fakes app, its image and extra gate

- Status: accepted
- Date: 2026-09-24
- Module: M03

## Context

The fakes live in `packages/testkit` and must reuse `contentHash`, `Result` and the port types of `@argus/contracts`, while `@argus/contracts` used `@argus/testkit` for `recordGateMetrics` in its tests. Turborepo refuses the resulting cycle (`^build` both ways). The plan also needs an `argus/fakes` image serving both fakes from `compose.dev.yaml`.

## Decision

- `@argus/testkit` depends on `@argus/contracts` and `@sinclair/typebox`. `@argus/contracts` drops its dev dependency on the testkit; its gate tests import `recordGateMetrics` from `../../testkit/src/gate-metrics.js`, the same relative form every `vitest.config.ts` already uses for the preset. No other package changes.
- Core logic (validation, answers, oracle, scripts, faults, redaction, cassette keys, port fakes) is pure in `src/core`; servers, file stores and the fetch wrapper are adapters exported through the index.
- `apps/fakes` (`@argus/fakes`) is the composition root: `argus-fakes [fake-jev|fake-llm|cassette-proxy|all]`, configured by `FAKE_HOST`, `FAKE_JEV_PORT` (4100), `FAKE_LLM_PORT` (4200), `FAKE_PROXY_PORT` (4300), `FAKE_JEV_MODE`, `FAKE_JEV_SCRIPT`, `FAKE_JEV_CASSETTE_DIR`, `FAKE_JEV_ORACLE_TARGETS`, `FAKE_JEV_ORACLE_SEED`, `FAKE_JEV_ORACLE_NOISE`, `FAKE_JEV_API_KEY`, `FAKE_LLM_SCRIPT`, `FAKE_LLM_FAULT`, `FAKE_LLM_API_KEY`, `FAKE_PROXY_UPSTREAM`, `FAKE_PROXY_CASSETTE_DIR`, `FAKE_PROXY_MODE`, `ARGUS_VERSION`, `LOG_LEVEL`; invalid keys exit 78 by name (ADR-0006 conventions, pending `@argus/config`). Logs are pino JSON without request bodies. The dependency rule `no-testkit-in-production` gains `apps/fakes` next to `apps/fixture-hmi`: the fakes are its product, and it never ships to customers.
- `deploy/docker/fakes.Dockerfile` (ADR-0003): build on `node:22-bookworm-slim`, runtime on `ubuntu:24.04` with Node copied in, tini, uid 10001, read-only root with tmpfs `/tmp`, `HEALTHCHECK` with Node's fetch against the servers listed in `/tmp/argus-fakes.json`. `.dockerignore` keeps the context small. D1 folds it into the shared Dockerfile.
- `compose.dev.yaml` gains `fake-jev` and `fake-llm` under the profile `fakes` (loopback ports 4100 and 4200, hardened like every ARGUS service), with every mode key passed through and `FAKE_FIXTURES_DIR` (default `deploy/fakes`) mounted read-only at `/fixtures` for script, target and cassette files; a configuration error exits 78 and `restart: on-failure:3` stops the retries; the always-on services stay postgres and s3, and the M00 repository test now checks the always-on set.
- Gate scripts are named `test:gate-m03-g<n>` because the testkit already has M00's `test:gate-g4`. An extra Tier C gate M03-G6 proves the image: it builds, runs both fakes hardened, answers `/healthz` within 5 s, turns healthy, serves the SDKs, and compose declares both services.
- New dependencies: `pino` 10.3.1 (MIT, 0.7 MB) in the app; `@typesafe-ai/sdk` 0.6.0 (MIT, 0.2 MB), `@anthropic-ai/sdk` 0.128.0 (MIT, 9.4 MB), `ajv` 8.17.1 (MIT, 1 MB) as dev dependencies for the fidelity gates.

## Consequences

A package that needs the fakes imports `@argus/testkit` in tests only; the dependency rule keeps them out of production code.
