# ADR M01-schema-conventions: How the contract schemas are written and checked

- Status: accepted
- Date: 2026-09-24
- Module: M01

## Context

The spec fixes TypeBox and JSON Schema 2020-12 as the contract source but not the
schema style, the error reporting of `validate()`, or how abbreviated values in its
examples (`sha256:9f2c...`, `fp_3b9a`) are to be read.

## Decision

- Every object is closed (`additionalProperties: false`) except RFC 9457 problem
  documents, whose extension members are allowed. Unknown fields are errors, which is
  what makes most invalid goldens precise.
- No `format` keyword anywhere; timestamps, hashes, artifact references, slugs, ids,
  durations, locales and time zones use `pattern`, so TypeBox, Ajv and any 2020-12
  validator agree without format plugins.
- Enumerations are exported `const` arrays and unions (`src/core/enums.ts`); in schemas
  they are `anyOf` of `const`.
- Unions of objects told apart by one property carry the OpenAPI 3.1 `discriminator`
  annotation. `validate()` uses it to report the first error inside the selected
  variant; for other unions it picks the closest variant (fewest failing locations, then
  deepest, then first). Errors are JSON Pointers, one per location, most specific first.
- Only top-level schemas have an `$id`: `https://argus.dev/schemas/argus/v1/<kebab
  name>.schema.json`. Published files are self-contained (no `$ref`) and are generated,
  never hand-edited: `pnpm --filter @argus/contracts export-schemas`.
- Non-standard annotations are `discriminator` and `x-runner-only` (on `bbox`, `attrs`,
  `fingerprint`); `CONTRACT_KEYWORDS` lists them for strict validators such as Ajv. M01-G1
  checks with Ajv 2020 that the published files accept and reject every golden exactly as
  TypeBox does.
- Hashes are always `sha256:` plus 64 hex digits. Abbreviations in spec examples are
  expanded, not accepted: the C12 golden's `sourceHash` is the SHA-256 of the product
  design's plain-language C12 source; example digests elsewhere use real hashes.
- Runner-only candidate fields are required in `Candidate` (every runner candidate has a
  box, attributes and a fingerprint) and forbidden in `NavigatorCandidate`;
  `stripForNavigator()` converts one into the other.

## Consequences

Adding an optional property is additive (M01-G4) but an old validator of a closed object
rejects documents that carry it, so producers upgrade before consumers. Consumers that
use Ajv register the two annotation keywords.
