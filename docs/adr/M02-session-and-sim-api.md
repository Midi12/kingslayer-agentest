# ADR-M02-3: Sessions protect pages only; `/sim/*` is a trusted control channel

- Status: accepted
- Date: 2026-09-24
- Module: M02

## Context

The spec requires a login flow and protected pages, and separately a `/sim/*` API for
"start, stop, raise fault, acknowledge, reset, set seed, set clock". It does not say
whether the simulator API itself needs a session.

## Decision

- The eight HMI pages other than `/login` require a valid session cookie
  (`argus_session`, HMAC-signed via `@fastify/cookie`, `httpOnly`); an invalid or missing
  one redirects to `/login`. Credentials are `operator` / `FIXTURE_OPERATOR_PASSWORD`
  (default `op-secret-2026`).
- `/healthz` and every `/sim/*` route need no session. `/sim/*` is the fixture's control
  plane for the test harness (drivers, gate suites, the eventual run engine's fakes), not
  part of the product surface under test; requiring a session there would only make every
  caller carry a cookie jar for no security benefit inside a hermetic Tier A run.
- Session tokens are generated from an internal counter (`sess-<seed>-<n>`), not
  `crypto.randomBytes` or `Math.random`, so `core` stays free of non-deterministic calls;
  the signing secret is a fixed string (`argus-fixture-hmi-cookie-secret`), adequate for a
  fixture that is never deployed with real data behind it.
- `session-expiry` is modelled as "every session that already existed when the fault
  turned on is invalid for as long as the fault stays on", not "sessions expire after N
  seconds": simpler to reason about, and it exercises exactly the behaviour the spec
  names (redirect to `/login` on the next navigation). A session created after the fault
  is already on is not affected, so a re-login keeps working — a break scenario needs to
  be able to log back in and carry on, not be locked out for good. `FixtureSimulator`
  tracks this with a snapshot of session tokens (`sessionExpiryVictims`) taken when the
  fault is switched on, consulted only while the fault is active and rebuilt fresh next
  time it turns on.
- `/sim/reset` and `/sim/seed` clear every session and the whole `/sim/log` history, not
  only the conveyors/alarms/settings the spec calls out by name (round-3 review flagged
  this as undocumented). Both are deliberate, not an oversight: sessions are enumerated
  as part of "all state" the module notes put in the one seeded model ("conveyors,
  alarms, trends, faults, sessions"), so a reset that left old sessions valid against a
  freshly reseeded world would itself be the inconsistency; and the log is scoped to
  "since the last reset" by design — a scenario resets to a known state immediately
  before it runs and then reads `/sim/log` to check exactly its own calls (S4, S11), which
  a log still carrying a previous scenario's entries would make harder to check, not
  easier. A caller that wants a durable, cross-reset audit trail should read `/sim/log`
  before it resets, not rely on the fixture keeping history across a reset for it.
- Conveyor row order (`conveyorRowOrder` in `src/core/sim.ts`) is a deterministic
  xorshift32 permutation of `CONVEYOR_IDS`, seeded only by `seed`, with no `Math.random`.
  It exists because M19's evaluation protocol runs every grounding task under several
  data seeds specifically to vary row order (`docs/spec/03-implementation-spec.md`, the
  M19 section); every other seeded default (speeds, which two conveyors' alarms are
  seeded, settings) already varied with the seed, but row order did not until this was
  added. Not a genuinely open design question — the spec effectively requires it — so it
  is recorded here rather than as its own ADR.

## Consequences

A test can drive `/sim/*` directly with `fetch`, with no login step, which is what every
gate test in this module and (later) the driver and engine will do. The HMI pages remain
a faithful little "real" product surface with its own auth for grounding and vision work.
