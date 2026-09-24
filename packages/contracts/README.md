# @argus/contracts

Every public ARGUS type and schema, in one package: TypeBox schemas that are also
TypeScript types and JSON Schema 2020-12, the port interfaces (types only), and the pure
helpers that belong to the contracts. Other packages import contract types from here and
nowhere else.

## Quick start

```ts
import { readFileSync } from 'node:fs';
import { contentHash, defaultLintContext, lintScript, renderSteps, validate } from '@argus/contracts';

const doc = JSON.parse(readFileSync('packages/contracts/test/__golden__/valid/TestScript/conveyor-start-and-jam.json', 'utf8'));
const script = validate('TestScript', doc);              // Result: { ok, value } or { ok: false, error: [{ path, message }] }
if (!script.ok) throw new Error(JSON.stringify(script.error));
console.log(lintScript(script.value, defaultLintContext({ allowedOrigins: ['https://hmi.test'] }))); // []
console.log(renderSteps(script.value), contentHash(script.value)); // step list, sha256:...
```

The package has no adapters and needs no fakes: the snippet runs as is with `npx tsx
--conditions=@argus/source <file>` from the repository root. Tests: `pnpm --filter @argus/contracts
test`, or `pnpm gate M01` for the gates.

## What is inside

| Area | Exports |
| --- | --- |
| Schemas and types | `TestScript`, `Fragment`, `Step`, `Action`, `Target`, `Expectation`, `Policy`, `Observation`, `Candidate`, `NavigatorObservation`, `GroundRequest`/`Result`, `VerifyRequest`/`Result`, `BreakPacket`, `AnalystDecision`, `TriageRequest`, `VisualGroundRequest`/`Result`, `VisionAssertRequest`/`Result`, `ReportInput`, `ReportBody`, `RunReport`, `RunEvent`, `RunEventBatch`, `UsageEvent`, `CompileRequest`/`Result`, `LintFinding`, `Clarification`, `BrainUsage`, runner protocol bodies, brain responses, `Problem` |
| Registry | `SCHEMAS`, `SCHEMA_NAMES`, `validate(name, value)`, `conforms`, `schemaId`, `BRAIN_ENDPOINTS`, `RUNNER_ENDPOINTS` |
| Vocabularies | `BREAK_REASONS`, `VERDICTS`, `STEP_OUTCOMES`, `RISK_CLASSES`, `ROLES`, `ACTION_TYPES`, `EXPECTATION_KINDS`, `PALETTE`, `USAGE_OPERATIONS`, `PROBLEM_STATUS`, ... as const arrays and unions |
| Canonical JSON | `canonicalize` (RFC 8785), `contentHash` (`sha256:<hex>`), `hashBytes`, `sha256Hex` |
| Scripts | `lintScript` (L1 to L8), `renderSteps`, `parseDuration`, `formatDuration`, `resolvePolicy`, `riskForAction`, `effectiveRisk`, `templateReferences`, `stripForNavigator` |
| Compatibility | `exportJsonSchemas`, `diffSchemaSets` (additive-only check) |
| Ports (types) | `Navigator`, `Analyst`, `Compiler`, `Clock`, `IdGenerator`, `Queue`, `EventBus`, `ObjectStore`, `Mailer`, `Payments`, `Result` with `ok` and `err` |

## Published JSON Schemas

`schemas/argus/v1/<name>.schema.json` (also `@argus/contracts/schemas/<file>`) are
generated from the TypeBox source; never edit them by hand.

```sh
pnpm --filter @argus/contracts export-schemas            # regenerate after a schema change
pnpm --filter @argus/contracts export-schemas --check    # exit 1 when the files are stale
pnpm --filter @argus/contracts export-schemas --baseline # at a release only: new G4 baseline
```

Strict validators must know the two annotation keywords the files use, for example
`new Ajv2020({ keywords: [...CONTRACT_KEYWORDS] })`.

## Decisions

`docs/adr/M01-*.md`: schema conventions, TestScript details, wire bodies, the run
ledger, ports, lint rules, the additive-only check and the isomorphic package.
