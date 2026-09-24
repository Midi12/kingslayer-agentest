# ADR M01-isomorphic-package: No Node built-ins in the contracts source

- Status: accepted
- Date: 2026-09-24
- Module: M01

## Context

Every package imports `@argus/contracts`, the console (M14) included, which runs in a
browser. `contentHash` needs SHA-256, and `node:crypto` would break a browser build.

## Decision

- `src/` imports only `@sinclair/typebox`. SHA-256 is implemented in plain TypeScript
  (`sha256Hex`) and tested against `node:crypto` for every length around the block
  boundaries and on random data. UTF-8 comes from the global `TextEncoder`.
- `canonicalize` implements RFC 8785 directly: sorted members by UTF-16 code units,
  ECMAScript number serialisation, JSON string escapes; it throws
  `CanonicalizationError` (with a JSON Pointer) for undefined, non-finite numbers, lone
  surrogates, bigint, functions, symbols, sparse arrays and non-plain objects, which are
  programming errors rather than expected failures.
- Everything but the port type files lives in `src/core` and is pure.
- The Node-only export script lives in `scripts/`, outside the published source.

## Consequences

Hashing a very large ledger is slower than with `node:crypto`; a Node service that
needs speed can hash `canonicalize(value)` with `node:crypto` and gets the same digest.
