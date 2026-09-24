# @argus/testkit

Test support shared by every package. M00 provides the Tier A network guard, the gate
metrics writer and the shared Vitest preset; M03 adds the AI fakes and port fakes.

```ts
// vitest.config.ts of any package (relative import: config files load before conditions apply)
import { defineArgusVitestConfig } from '../../packages/testkit/src/vitest-preset.js';
export default defineArgusVitestConfig({ kind: 'package' }); // 'app' for apps/*

// in a gate test
import { recordGateMetrics } from '@argus/testkit';
recordGateMetrics({ tasks: 120, invalid: 0 }); // merged into $GATE_METRICS when set
```

Run it: `pnpm --filter @argus/testkit test` (all tests) or `pnpm gate M00` (M00-G4).

## Network guard (ADR-0008, ADR M00-network-guard)

The preset's setup file calls `installNetworkGuard()` in every test process. From then on
a connection to anything but 127.0.0.0/8, ::1, `localhost` or a Unix socket throws an
error with `code: 'NETWORK_DENIED'`: `net` and `tls` sockets, `http`/`https` requests
(including proxy CONNECT and absolute-URL requests), global `fetch`, `dgram`, DNS lookups
of non-loopback names and every DNS resolver query. Proxy variables are removed from the
test environment. `ARGUS_NETWORK_GUARD_REPORT=<file>` makes each installation append a
line, which `pnpm g0` uses to prove the guard was active.

## Vitest preset

`resolve.conditions` with `@argus/source` (workspace packages resolve to their sources),
the network guard setup file, `pool: 'forks'` with at most two workers, and V8 coverage of
`src/**` with a line threshold of 85 for packages and 70 for apps. A package may raise a
threshold; setting one below the floor throws.
