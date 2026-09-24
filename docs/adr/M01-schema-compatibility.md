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
- G4 runs in two halves (gate change M01-4). `test/gate-g4.test.ts` is in the
  package's default suite and needs no git: comparison with the committed snapshot,
  fixture pairs and schema freshness. `test/gate-g4.git.ts` reads git (the tag and the
  snapshot history), is run only by `test:gate-g4` through `vitest.git.config.ts`, and
  fails outright outside a git work tree. The default suite must pass in a clean
  `git archive` export (M00-G1), which has no history; G4 itself requires git.
- The candidate set is generated from the registry at test time, and a separate check
  requires the committed `schemas/argus/v1/` files to equal it byte for byte.
- `diffSchemaSets` reports removed schemas, removed properties and pattern properties,
  newly required properties, narrowed types (JSON kinds, constrained items), narrowed
  literal sets, closed objects, stricter bounds, lengths, patterns, uniqueness and
  multiples, and union variants that lost their counterpart. Discriminated variants are
  matched by discriminator value, others by finding an equally permissive new variant.
  A member name is governed by its property schema and every pattern property it
  matches, or else by `additionalProperties` (absent or `true`: anything). Each schema
  governing a name after the change must accept all that one schema governing it
  before accepted. So a typed property added to an open object or a record, a pattern
  property that may overlap an old one or an open remainder, and `additionalProperties`
  going from `true` or absent to a schema are narrowing; a property added where the old
  object rejected the name is additive.
  When an old `const`, `enum` or literal union becomes a non-literal schema, every old
  literal is evaluated against the whole new schema (kinds, bounds, `multipleOf`,
  lengths in code points, patterns, `required`, member counts, properties and items,
  nested subschemas); a rejected literal is `narrowed-type`, and one the diff cannot
  evaluate (an unmodelled keyword, a pattern that does not compile) is
  `unmodelled-keyword`. Boolean subschemas keep their meaning: `true` accepts
  everything, `false` nothing, so a root, property, pattern property, items or variant
  schema that becomes `false` is a narrowing.
  Any other keyword (`allOf`, `not`, `if`/`then`, `dependentRequired`, `propertyNames`,
  `format`, `$ref`, ...) that is added or changed is reported as `unmodelled-keyword`:
  the diff fails closed; annotations (`title`, `description`, `examples`, ...) are
  ignored.
- Fixture pairs under `test/__golden__/schema-diff/` prove each kind is detected and
  that an additive change (new optional property, wider enum, new variant, relaxed
  bound, new schema) passes.

## Consequences

Relaxing a constraint is always allowed; tightening one needs `v2`.
