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
- Hygiene, applied before writing: `Authorization`, `Proxy-Authorization`, `x-api-key`, `api-key`, `x-goog-api-key`, `Cookie` and `Set-Cookie` are dropped; inline images (data URLs and `{ type: 'base64', data }` sources) become `[inline <type>: <n> bytes, base64 sha256:<hex>]`; then every string and object key in headers, path and bodies is scanned for the key patterns and each match replaced by `[REDACTED]`. Key patterns (`KEY_PATTERNS`): `sk-…` and `tsk-…` keys, Stripe `sk_/rk_/pk_live|test_…`, `whsec_…`, JWTs, `Bearer <token>`, Google `AIza…` keys (39 characters), hex runs of 32 or more characters, base64 or base64url runs of 40 or more characters mixing upper case, lower case and digits, and alphanumeric runs of 40 or more characters holding a letter and a digit, in any case; runs preceded by `sha256:` are content digests, not keys. A string is redacted as it reads and again as the file writes it: a run that JSON escaping makes key-like (`\n` followed by 39 characters reads as 40 in the file) is redacted with its escape. Unprefixed tokens shorter than these thresholds are not recognised; credential headers, where keys normally travel, are dropped whatever their value.
- The key is computed over the stored, redacted form of the request (`recordingKey` = `cassetteKey(sanitizeRequest(…))`, equal to `cassetteKey` for a request without key material). Replay still matches a request carrying a real key, and a request that echoes a value redacted from a replayed response (a thinking signature, an issued token) keys the same as the recorded one, so multi-turn cassettes replay strictly. Two requests that differ only in redacted values share a key. A replayed response is the recording, redactions included.
- Binary bodies: a request or response body that is not valid UTF-8 cannot be scanned for key material (a key inside it survives base64 encoding), so the recorder refuses it with `CassetteBinaryBodyError` (`code: CASSETTE_BINARY_BODY`, part `request` before any call, `response` after it) and writes nothing; the proxy answers 502 with that code. The Jev and LLM APIs exchange JSON only. The `{ base64 }` body form stays in the key and in the file schema, so hand-written entries still replay.

## Consequences

A response that legitimately contains a long token (a URL path with mixed-case ids, a git SHA) replays with `[REDACTED]` in its place; tests that need such a value script it instead of recording it.
