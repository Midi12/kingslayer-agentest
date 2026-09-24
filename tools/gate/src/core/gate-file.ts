/**
 * Gate file format (CLAUDE.md section 4), validated with a TypeBox schema plus the rules
 * a schema cannot state: gate ids carry the module id, are unique, and every pass
 * expression parses.
 */
import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type Expression, parseExpression } from './expression.js';
import { REQUIREMENT_PATTERN } from './requirements.js';
import { type Result, err, ok } from './result.js';

export const TIERS = ['A', 'B', 'C'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Module ids: build modules `M00`..`M99`, scenarios `S01`..`S99` and delivery modules
 * `D1`, `D2` (implementation plan, delivery stream).
 */
export const MODULE_ID_SOURCE = '(?:[MS]\\d{2}|D\\d{1,2})';
export const MODULE_ID_PATTERN = `^${MODULE_ID_SOURCE}$`;

export function isModuleId(value: string): boolean {
  return new RegExp(MODULE_ID_PATTERN).test(value);
}

/** Gate file names that `pnpm gate all` reads: `<module id>.yaml`. */
export const GATE_FILE_NAME = new RegExp(`^(${MODULE_ID_SOURCE})\\.yaml$`);

export const GateSchema = Type.Object(
  {
    id: Type.String({ pattern: `^${MODULE_ID_SOURCE}-G\\d+$` }),
    tier: Type.Union(TIERS.map((tier) => Type.Literal(tier))),
    title: Type.String({ minLength: 1 }),
    command: Type.String({ minLength: 1 }),
    timeoutSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
    requires: Type.Optional(Type.Array(Type.String({ pattern: REQUIREMENT_PATTERN }))),
    pass: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const GateFileSchema = Type.Object(
  {
    module: Type.String({ pattern: MODULE_ID_PATTERN }),
    title: Type.String({ minLength: 1 }),
    gates: Type.Array(GateSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type GateFileDocument = Static<typeof GateFileSchema>;

export interface GateDefinition {
  readonly id: string;
  readonly tier: Tier;
  readonly title: string;
  readonly command: string;
  readonly timeoutSec: number;
  readonly requires: readonly string[];
  readonly pass: string;
  readonly expression: Expression;
}

export interface GateFile {
  readonly module: string;
  readonly title: string;
  readonly gates: readonly GateDefinition[];
}

/** Validates a parsed YAML document; errors are "path: message" strings. */
export function validateGateFile(document: unknown): Result<GateFile, string[]> {
  if (!Value.Check(GateFileSchema, document)) {
    const errors = [...Value.Errors(GateFileSchema, document)].map(
      (error) => `${error.path === '' ? '/' : error.path}: ${error.message}`,
    );
    return err(errors);
  }
  const errors: string[] = [];
  const seen = new Set<string>();
  const gates: GateDefinition[] = [];
  document.gates.forEach((gate, index) => {
    if (!gate.id.startsWith(`${document.module}-`)) {
      errors.push(`/gates/${index}/id: ${gate.id} does not belong to module ${document.module}`);
    }
    if (seen.has(gate.id)) {
      errors.push(`/gates/${index}/id: duplicate gate id ${gate.id}`);
    }
    seen.add(gate.id);
    const parsed = parseExpression(gate.pass);
    if (!parsed.ok) {
      errors.push(
        `/gates/${index}/pass: ${parsed.error.message} at column ${parsed.error.position + 1}`,
      );
      return;
    }
    gates.push({ ...gate, requires: gate.requires ?? [], expression: parsed.value });
  });
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({ module: document.module, title: document.title, gates });
}
