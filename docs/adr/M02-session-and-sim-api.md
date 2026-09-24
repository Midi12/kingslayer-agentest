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
- `session-expiry` is modelled as "every session is invalid while the fault is on", not
  "sessions expire after N seconds": simpler to reason about, and it exercises exactly the
  behaviour the spec names (redirect to `/login` on the next navigation).

## Consequences

A test can drive `/sim/*` directly with `fetch`, with no login step, which is what every
gate test in this module and (later) the driver and engine will do. The HMI pages remain
a faithful little "real" product surface with its own auth for grounding and vision work.
