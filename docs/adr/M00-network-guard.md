# ADR M00-network-guard: Tier A network guard

- Status: accepted
- Date: 2026-09-24
- Module: M00

## Context

ADR-0008 allows loopback (127.0.0.0/8, ::1) and Unix sockets in Tier A. On this host the
outbound HTTPS proxy listens on 127.0.0.1, so a client that honours `HTTPS_PROXY` would
reach the internet through an allowed loopback connection.

## Decision

- `installNetworkGuard()` in `@argus/testkit` patches `net.Socket.prototype.connect`
  (the path of every TCP and TLS client, including undici behind global `fetch`),
  `net.connect`, `net.createConnection`, `tls.connect` (an existing socket passes),
  `http`/`https` `request` and `get` (CONNECT targets and absolute-URL proxy requests
  are checked too), global `fetch` (http, https, ws, wss), `dgram` `send` and `connect`,
  `dns.lookup` of names other than `localhost` (IP literals answer locally and pass;
  sockets bind to 0.0.0.0 through it), reverse lookups of non-loopback addresses, and
  every DNS resolver query (they go to a DNS server).
- A caller-supplied `lookup` connect option (also reachable through `http.request` and
  agents) is wrapped: every address it returns must be loopback, otherwise the socket
  fails with `NETWORK_DENIED`, so `localhost` cannot be mapped to another host.
- After patching, `module.syncBuiltinESMExports()` updates the ESM named exports of the
  built-ins, so `import { lookup } from 'node:dns'` and `node:dns/promises` are guarded
  like `dns.lookup`.
- A refused call throws synchronously, or rejects for promise APIs, with
  `NetworkDeniedError` (`code: 'NETWORK_DENIED'`, `target`, `via`). Only `localhost`,
  127.0.0.0/8, ::1 and IPv4-mapped loopback pass; 0.0.0.0 and :: as destinations do not.
- The guard removes the proxy variables (`HTTP(S)_PROXY`, `ALL_PROXY`, lower case,
  `NODE_USE_ENV_PROXY`, `GLOBAL_AGENT_*`, npm and yarn proxy settings) from the test
  process, so neither the test nor its child processes relay through a loopback proxy.
- It is idempotent, permanent for the process, installed by the Vitest preset's setup
  file, and reports each installation to `$ARGUS_NETWORK_GUARD_REPORT` for G0.
- The setup file then calls `propagateNetworkGuard(<preload>)`, so Node children and
  worker threads are guarded as well: `NODE_OPTIONS` gains `--import=<preload URL>`, also
  inside an explicit `env` given to `spawn`, `exec`, `execFile`, `fork` and their sync and
  promisified forms; `worker_threads.Worker` adds the flag to a file worker's `execArgv`
  and prefixes eval code with a `require` of the preload. The preload,
  `network-guard.preload.ts`, installs the guard and propagates it again (grandchildren).
- Node loads the source preload natively (type stripping, Node 22.18 or later), so it
  imports `./network-guard.ts` with its extension; testkit enables
  `rewriteRelativeImportExtensions` so the build emits `.js`. `propagateNetworkGuard`
  throws when the preload is TypeScript under `node_modules` or Node cannot strip types,
  rather than leaving children unguarded.

## Consequences

The guard covers the test process and the Node processes and threads it starts with an
inherited or explicit environment. Not covered: non-Node programs (Chromium in M04, Go or
native binaries), a Node child started through a wrapper that clears the environment
(`env -i`), and a test that configures a loopback proxy explicitly. The CI `tier-a` job
therefore also runs the gates as a user whose egress is limited to loopback and the Docker
bridge networks, for IPv4 and IPv6, and M00-G1 runs its build and test steps as that user
(ADR M00-ci). Testkit sources that the preload imports must use erasable TypeScript
syntax only (no enums, namespaces or parameter properties); G4 fails otherwise, because
its child-process cases load the preload natively.
