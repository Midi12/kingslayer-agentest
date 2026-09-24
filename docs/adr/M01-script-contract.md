# ADR M01-script-contract: TestScript details the spec leaves open

- Status: accepted
- Date: 2026-09-24
- Module: M01

## Context

The TestScript example, the Actions and Expectations tables name fields but not every
shape, default or combination.

## Decision

- Required: `apiVersion`, `kind`, `metadata.name` (slug) and `title`, `target.baseUrl`,
  `viewport`, `locale`, `timezone`, `policy.strict`, `onBreak`, `failOnConsoleError`,
  `shareScreenshotsWithLlm`, `artifacts`, and at least one step. Optional with defaults
  (`resolvePolicy`): `pii: standard`, `degrade: analyst`, `healApproval: manual`.
- A step is either an acting step (`id`, `intent`, `action`, optional `risk`, `expect`,
  `within`, `allowInProduction`, `expectedScreen` as a screen description, `artifacts`
  overriding the policy value) or a fragment reference (`id`, `use`, optional `intent`),
  which the compiler inlines. `Fragment` is its own document kind (`kind: Fragment`).
- Templates: `${env.NAME}` (environment values, `BASE_URL` included), `${var.NAME}`
  (variables and extracted values), `${secret.NAME}` (declared secrets, resolved by the
  runner at action time).
- Actions: `fill` has `value`; `select` has `option` (visible label or value); `clear`
  has only a target; `press` has `keys` in Playwright syntax and an optional target;
  `upload.file` is a relative dataset path without `..`; `scroll` has an optional target
  (absent means the page), `direction` up, down, left or right, and `amount` in pixels;
  `extract.parse: regex` requires `pattern` (group 1, else the whole match); `http`
  carries either `json` or a raw `body`, never both, and optional `headers`.
- Expectations: `dom` operands are `value` (text and value ops, `countEquals`),
  `pattern` (`textMatches`), `cmp` among eq, ne, lt, le, gt, ge with `value` and
  optional `tolerance` (`numberCompare`); `blink` is a `minHz`/`maxHz` range (0 to
  12 Hz, the burst rate) or `op: absent`; `vision` asks a yes-or-no `question` with a
  boolean `expected`; `console` and `network` take an optional `pattern`; `a11y` takes an
  axe-core rule set and the lowest failing impact; visual masks are `{description}` or
  `{rect}`.
- `within` uses `parseDuration` syntax (`1m30s`, `10s`, `500ms`); the schema checks the
  syntax, lint rule L6 the 120 s ceiling.
- Handlers: `when` is `{kind: probe, name}` with the four standard probes, or `{kind:
  noul, statement}`.
- Risk is assigned in code: `riskForAction` gives read for navigate, hover, scroll, wait,
  assert, extract and GET or HEAD requests, write otherwise; `effectiveRisk` never goes
  below it.

## Consequences

The compiler prompt (M08) and the console editor (M14) target exactly these shapes.
