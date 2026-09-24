# ADR M01-schema-compatibility: Additive-only check and the release baseline

- Status: accepted
- Date: 2026-09-24
- Module: M01

## Context

M01-G4 diffs the schemas against the last release tag, and no release tag exists yet.

## Decision

- The reference is the latest `v*` git tag (version sort) when one exists: its
  `packages/contracts/schemas/argus/v1/*.schema.json` read with `git show`. Otherwise it
  is the committed snapshot `packages/contracts/schemas/baseline/`, first written as a copy
  of the current schemas.
- The snapshot changes only at a release, with `export-schemas --baseline`, reviewed as
  part of the release; an implementation commit that edits it outside a release is a
  gate change. G4 also compares with every version of the snapshot ever committed (gate
  change M01-1), so a rewritten snapshot cannot hide a breaking change.
- The candidate set is generated from the registry at test time, and a separate check
  requires the committed `schemas/argus/v1/` files to equal it byte for byte.
- `diffSchemaSets` reports removed schemas, removed properties and pattern properties,
  newly required properties, narrowed types (JSON kinds, constrained items), narrowed
  literal sets, closed objects, stricter bounds, lengths, patterns, uniqueness and
  multiples, and union variants that lost their counterpart. Discriminated variants are
  matched by discriminator value, others by finding an equally permissive new variant.
  Any other keyword (`allOf`, `not`, `if`/`then`, `dependentRequired`, `propertyNames`,
  `format`, `$ref`, ...) that is added or changed is reported as `unmodelled-keyword`:
  the diff fails closed; annotations (`title`, `description`, `examples`, ...) are
  ignored.
- Fixture pairs under `test/__golden__/schema-diff/` prove each kind is detected and
  that an additive change (new optional property, wider enum, new variant, relaxed
  bound, new schema) passes.

## Consequences

Relaxing a constraint is always allowed; tightening one needs `v2`.
