# @argus/testkit

Test support shared by every package. M00 provides the Tier A network guard, the gate
metrics writer and the shared Vitest preset; M03 adds the AI fakes, cassettes and port
fakes (ADRs M03-jev-fake, M03-jev-modes, M03-llm-fake, M03-cassettes, M03-port-fakes).

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
test environment. The setup file also calls `propagateNetworkGuard()`: `NODE_OPTIONS`
gains `--import=<network-guard.preload>` (added to an explicit `env` of the
`child_process` functions as well) and `worker_threads.Worker` loads the same preload, so
Node child processes and worker threads started by a test are guarded too. Non-Node
programs (Chromium, Go binaries) are covered only by an OS-level lockdown.
`ARGUS_NETWORK_GUARD_REPORT=<file>` makes each installation append a
line, which `pnpm g0` uses to prove the guard was active.

## Vitest preset

`resolve.conditions` with `@argus/source` (workspace packages resolve to their sources),
the network guard setup file, `pool: 'forks'` with at most two workers, and V8 coverage of
`src/**` with a line threshold of 85 for packages and 70 for apps. A package may raise a
threshold; setting one below the floor throws.

## AI fakes in a test (M03)

```ts
import { TypeSafeClient, choice } from '@typesafe-ai/sdk';
import { DEFAULT_FAKE_JEV_API_KEY, startFakeJev } from '@argus/testkit';

const jev = await startFakeJev({ mode: { kind: 'scripted', script: { answers: { target: 'c17' } } } });
const sdk = new TypeSafeClient({ apiKey: DEFAULT_FAKE_JEV_API_KEY, baseURL: jev.url });
const { answers } = await sdk.systemOne({ state: 'page', questions: { target: choice('Which?', { c16: null, c17: null }) } });
// answers.target.choice === 'c17'; jev.requests holds the call; await jev.close();
```

Run it: `pnpm --filter @argus/testkit test`, or `pnpm gate M03`.

### Fake Jev (`startFakeJev`)

`POST /v1/systemone` and `GET /v1/models` with Bearer auth (`DEFAULT_FAKE_JEV_API_KEY` unless
`apiKeys` is given), validation with 422 (at most 255 Choice options, 2 to 10 Score levels, a
known model, the 32k context), `x-typesafe-request-id` on every response, usage estimated from
the canonical request. Modes:

- `scripted`: answers by question key (`*` wildcards), rules per request matcher, and queues
  of per-call outcomes: `server.enqueue({ status: 429, retryAfterMs: 300 }, { status: 529 })`,
  `{ delayMs }`, `{ hang: true }`, `{ answers }`.
- `cassette`: replays recordings by canonical request hash; a miss is 404 `CASSETTE_MISS`.
- `oracle`: `{ kind: 'oracle', truth, noise, seed }`; `oracleFromTargets({ description: cid })`
  builds `truth` from a grounding dataset. Noise 0 gives the truth with probability 1.

Confidence is (n·p_max − 1)/(n − 1), the LocalNavigator formula.

### Fake LLM (`startFakeLlm`)

Anthropic Messages at `/v1/messages` and OpenAI-compatible chat at `/v1/chat/completions`
(`response_format`, tools, `logprobs`/`top_logprobs`). Responses are scripted by matcher
(`text`, `json`, `toolUse`, `choiceProbabilities`). Faults on demand through the script, the
queue (`llm.enqueue({ fault: 'timeout' })`) or the `x-fake-llm-fault` header:
`malformed-json`, `schema-invalid`, `refusal`, `timeout`, `server-error`, `over-long`,
`malicious` (obeys `ARGUS-INJECT: …` or "ignore previous instructions …" lines in message
text). Every request is in `llm.requests`.

### Cassettes

`createCassetteFetch({ store: cassetteDir(root, suite), mode: 'strict' | 'record' | 'auto' })`
is a `fetch` for any client that accepts one; `startCassetteProxy({ upstream, store, mode })`
serves the same over HTTP. Strict mode throws `CassetteMissError` (`CASSETTE_MISS`) and opens
no socket. Recorded files drop credential headers and redact everything matching
`KEY_PATTERNS`; `findKeyMaterial(text)` checks a file.

### Port fakes

`FakeClock` (manual `advance`), `SeqIdGenerator` (`run_0001`), `InMemoryQueue`,
`InMemoryEventBus`, `InMemoryObjectStore` with `serveObjectStore` for pre-signed URLs,
`InMemoryMailer`, `InMemoryPayments` (Stripe-style signed webhooks). Every server fake binds
port 0 and returns `{ url, close, requests }`. The same servers run as containers from
`apps/fakes` (image `argus/fakes`).
