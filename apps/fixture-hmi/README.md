# @argus/fixture-hmi

A small, deterministic, seeded web HMI with switchable faults: everything later gates
have something real to break against, without a customer's plant. It is a test fixture
and depends on `@argus/testkit`; no production package may import it (dependency-cruiser
enforces this).

## Quick start

```ts
import { createFixtureServer } from '@argus/fixture-hmi';

const handle = await createFixtureServer({ seed: 1, clock: 'frozen' });
await fetch(`${handle.url}/sim/faults/dup-labels`, { method: 'POST' }); // toggle a fault
const page = await fetch(`${handle.url}/conveyors`);                   // 302 to /login first
await handle.close();
```

Log in as `operator` / `op-secret-2026` (or the `operatorPassword` option) to reach the
seven protected pages; `GET /healthz` and the `/sim/*` API need no session. Run it as a
process with `pnpm --filter @argus/fixture-hmi start` (reads `FIXTURE_PORT`,
`FIXTURE_HOST`, `FIXTURE_SEED`, `FIXTURE_OPERATOR_PASSWORD`), or as a Docker service:
`docker compose -f compose.dev.yaml --profile fixture up fixture-hmi`.

## What is inside

| Area | Detail |
| --- | --- |
| Pages | `/login`, `/conveyors` (20 conveyors C01–C20), `/synoptic/svg`, `/synoptic/canvas`, `/alarms` (1 Hz blink until acknowledged), `/trends`, `/settings`, `/modal`. Every interactive element and every row/cell a dataset references carries `data-testid` |
| Simulator API | `/sim/conveyors/{id}/start\|stop`, `/sim/conveyors/{id}/faults` (202, the `http` TestScript step's contract), `/sim/alarms/{id}/ack`, `/sim/reset`, `/sim/seed`, `/sim/clock`, `/sim/state`, `/sim/log`, `/sim/faults` (GET/POST/DELETE) |
| Faults | Exactly the 14 named in the spec: `rename-start`, `move-start`, `dup-labels`, `error-toast`, `slow-load`, `session-expiry`, `blocking-modal`, `no-effect`, `wrong-state`, `no-blink`, `locale-fr`, `shadow-dom`, `iframe`, `injection`. Faults compose |
| Determinism | One seeded, in-memory `FixtureSimulator` (`src/core/sim.ts`); time enters only through the `Clock` port (`@argus/contracts`), never `Date.now()` or `Math.random()` directly in rendering. `clock: 'frozen'` makes every page byte-identical for the same seed and call sequence; `clock: 'real'` drives the alarm blink as a genuine 1 Hz CSS animation |
| Datasets | `datasets/grounding.jsonl` (134 tasks, 32 in French, 20 on the SVG synoptic) and `datasets/breaks.jsonl` (62 labelled fault/step/expected-break-reason situations); both TypeBox-schema-checked in `src/core/dataset-schema.ts` and regenerated with `pnpm --filter @argus/fixture-hmi generate-datasets` |

## Layout

`src/core` is pure (the simulator model, i18n strings, the HTML render functions — total
functions of their arguments); `src/adapters` holds the one Fastify HTTP adapter and the
one `Clock` adapter; `src/index.ts` is the composition root (`createFixtureServer`);
`src/main.ts` is the process entrypoint. See `docs/adr/M02-*.md` for the decisions this
module made on its own.
