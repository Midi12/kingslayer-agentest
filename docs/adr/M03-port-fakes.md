# ADR M03-port-fakes: Fakes of the runtime and platform ports

- Status: accepted
- Date: 2026-09-24
- Module: M03

## Context

The spec asks for `FakeClock`, `SeqIdGenerator` and in-memory queue, object store, mailer and payments, implementing the ports already declared in `packages/contracts/src/ports` without redefining them. The ports leave behaviour to the implementation.

## Decision

- `FakeClock` starts at 2026-01-01T00:00:00Z (or a given time), moves only through `advance`, `set` and `runAll` (async, never backwards), and resolves pending sleeps in due order, each continuation running with `now()` equal to its due time; an aborted sleep rejects with the signal's reason. `SeqIdGenerator` issues `prefix_0001`, one counter per prefix (optionally shared, width and start configurable).
- `InMemoryQueue`: FIFO; a runner takes a job whose labels are a subset of its own and, when self-hosted, of its org. A lease lives three heartbeat intervals (3 × 15 s), a heartbeat renews it, `release` hands it back without counting the attempt, `cancel` removes a queued job or flags a leased one (heartbeats report it), `expireStale` re-queues an expired lease at most twice and reports the third as lost. `attempts` counts leases granted, the current one included.
- `InMemoryEventBus` delivers synchronously in subscription order and logs every message. `InMemoryMailer` keeps an outbox, returns the first message id for a repeated idempotency key, rejects empty or malformed recipients, and fails on demand.
- `InMemoryPayments`: checkout and portal URLs on the reserved `.invalid` domain; idempotent checkouts and charges; queued charge outcomes (status or error), success by default; webhooks signed like Stripe (`t=<s>,v1=<HMAC-SHA256("t.body")>`, test secret, 300 s tolerance on the clock), with a `webhook()` helper that produces signed events. HMAC is implemented over the pure SHA-256 of `@argus/contracts` and tested against `node:crypto`.
- `InMemoryObjectStore` returns `sha256` as lower-case hex, lists in key order with a cursor (1,000 per page), and pre-signs URLs for `serveObjectStore`, a loopback server that checks the signature (SHA-256 over secret, method, key, expiry and PUT content type) and the expiry against the store's clock, answering 403 like S3.
- Every fake has `setUnavailable(message)` (or `failNext`) to produce the port's `unavailable` error, and every server fake returns `{ url, close, requests }` and binds port 0 by default.
- No port interface changed.

## Consequences

M12 and M13 test their services against the same contracts their real adapters implement; behaviours an adapter adds later (for example S3 multipart) need a matching change here.
