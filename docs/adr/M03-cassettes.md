# ADR M03-cassettes: Cassette key, format, modes and key hygiene

- Status: accepted
- Date: 2026-09-24
- Module: M03

## Context

Cassettes make live behaviour replayable: a recorder and a player keyed by canonical request hash, strict mode failing on an unknown request instead of calling out, and API keys never stored (M03-G3).

## Decision

- Key: `contentHash` of `@argus/contracts` over `{ method (upper case), path (with query, without origin), body }`, the body being `{ json }` when it parses as JSON (so key order and whitespace do not matter), else `{ text }`, else `{ base64 }`, or null. A recording made against the real API replays against a fake or a proxy on another host.
- Files: one JSON file per interaction, named by the hex digest of the key, in one directory per suite (`cassetteDir(root, suite)` slugifies the suite name): `{ version: 1, key, recordedAt, request: { method, path, headers, body }, response: { status, headers, body } }`, validated with TypeBox on read.
- Modes: `strict` replays and throws `CassetteMissError` (`code: CASSETTE_MISS`, key, method, path) before any call; `record` always calls and writes; `auto` replays hits and records misses. The fetch wrapper `createCassetteFetch` works with any client that accepts a `fetch` (the TypeSafe SDK, fetch-based providers); `startCassetteProxy` puts the same logic in front of an upstream for clients that only take a base URL, answering a miss with 404 `CASSETTE_MISS`.
- Hygiene, applied before writing: `Authorization`, `Proxy-Authorization`, `x-api-key`, `api-key`, `x-goog-api-key`, `Cookie` and `Set-Cookie` are dropped; inline images (data URLs and `{ type: 'base64', data }` sources) become `[inline <type>: <n> bytes, base64 sha256:<hex>]`; then every string and object key in headers, path and bodies is scanned for the key patterns and each match replaced by `[REDACTED]`. Key patterns (`KEY_PATTERNS`): `sk-…` and `tsk-…` keys, Stripe `sk_/rk_/pk_live|test_…`, `whsec_…`, JWTs, `Bearer <token>`, hex runs of 32 or more characters not preceded by `sha256:` (content digests are not keys), and base64 or base64url runs of 40 or more characters mixing upper case, lower case and digits. The key is computed before redaction, so replay still matches. A replayed response is the recording, redactions included.

## Consequences

A response that legitimately contains a long token (a URL path with mixed-case ids, a git SHA) replays with `[REDACTED]` in its place; tests that need such a value script it instead of recording it.
