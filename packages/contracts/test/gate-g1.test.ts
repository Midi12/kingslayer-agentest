/**
 * M01-G1: schemas accept and reject correctly. Every valid golden validates; every
 * invalid golden fails, and its first error is at the expected JSON Pointer. The
 * published JSON Schema files must agree with TypeBox on every golden (checked with Ajv
 * in JSON Schema 2020-12 mode).
 */
import { recordGateMetrics } from '../../testkit/src/gate-metrics.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CONTRACT_KEYWORDS,
  SCHEMA_NAMES,
  exportJsonSchema,
  isSchemaName,
  validate,
  type SchemaName,
} from '../src/index.js';
import { invalidGoldens, validGoldens } from './support/goldens.js';

const valid = validGoldens();
const invalid = invalidGoldens();

const ajv = new Ajv2020({
  strict: true,
  allErrors: false,
  allowUnionTypes: true,
  strictTypes: false,
});
for (const keyword of CONTRACT_KEYWORDS) ajv.addKeyword(keyword);
const ajvValidators = new Map(
  SCHEMA_NAMES.map((name) => [name, ajv.compile(exportJsonSchema(name))] as const),
);

const failures: string[] = [];
let ajvDisagreements = 0;

function ajvAccepts(schema: SchemaName, document: unknown): boolean {
  const check = ajvValidators.get(schema);
  if (check === undefined) throw new Error(`no Ajv validator for ${schema}`);
  return check(document);
}

describe('M01-G1 valid goldens', () => {
  it.each(valid.map((golden) => [`${golden.schema}/${golden.name}`, golden] as const))(
    '%s validates',
    (_label, golden) => {
      expect(isSchemaName(golden.schema)).toBe(true);
      const schema = golden.schema as SchemaName;
      const result = validate(schema, golden.document);
      if (!result.ok)
        failures.push(`${golden.schema}/${golden.name}: ${JSON.stringify(result.error)}`);
      expect(result.ok ? [] : result.error).toEqual([]);
      const agrees = ajvAccepts(schema, golden.document);
      if (!agrees) ajvDisagreements++;
      expect(agrees).toBe(true);
    },
  );
});

describe('M01-G1 invalid goldens', () => {
  it.each(invalid.map((golden) => [`${golden.schema}/${golden.rule}`, golden] as const))(
    '%s is rejected at its expected path',
    (_label, golden) => {
      expect(isSchemaName(golden.schema)).toBe(true);
      const schema = golden.schema as SchemaName;
      const result = validate(schema, golden.document);
      const firstPath = result.ok ? null : (result.error[0]?.path ?? null);
      if (firstPath !== golden.expectedPath) {
        failures.push(
          `${golden.schema}/${golden.rule}: expected ${golden.expectedPath}, got ${String(firstPath)}`,
        );
      }
      expect(result.ok).toBe(false);
      expect(firstPath).toBe(golden.expectedPath);
      const agrees = !ajvAccepts(schema, golden.document);
      if (!agrees) ajvDisagreements++;
      expect(agrees).toBe(true);
    },
  );
});

describe('M01-G1 coverage of the golden set', () => {
  it('holds the conveyor C12 script from the spec and the login-operator fragment', () => {
    const c12 = valid.find(
      (golden) => golden.schema === 'TestScript' && golden.name === 'conveyor-start-and-jam',
    );
    const fragment = valid.find(
      (golden) => golden.schema === 'Fragment' && golden.name === 'login-operator',
    );
    expect(c12).toBeDefined();
    expect(fragment).toBeDefined();
    expect(validate('TestScript', c12?.document).ok).toBe(true);
  });

  it('has at least 40 valid and 60 invalid documents covering every schema', () => {
    const withValid = new Set(valid.map((golden) => golden.schema));
    const withInvalid = new Set(invalid.map((golden) => golden.schema));
    expect(valid.length).toBeGreaterThanOrEqual(40);
    expect(invalid.length).toBeGreaterThanOrEqual(60);
    expect(SCHEMA_NAMES.filter((name) => !withValid.has(name))).toEqual([]);
    expect(SCHEMA_NAMES.filter((name) => !withInvalid.has(name))).toEqual([]);
  });

  it('names every invalid golden after a rule and gives a reason', () => {
    for (const golden of invalid) {
      expect(golden.rule).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(golden.reason.length).toBeGreaterThan(0);
      expect(typeof golden.expectedPath).toBe('string');
    }
  });
});

afterAll(() => {
  const withValid = new Set(valid.map((golden) => golden.schema));
  const withInvalid = new Set(invalid.map((golden) => golden.schema));
  const c12 = valid.find(
    (golden) => golden.schema === 'TestScript' && golden.name === 'conveyor-start-and-jam',
  );
  recordGateMetrics({
    schemas: SCHEMA_NAMES.length,
    validDocuments: valid.length,
    invalidDocuments: invalid.length,
    schemasWithoutValid: SCHEMA_NAMES.filter((name) => !withValid.has(name)).length,
    schemasWithoutInvalid: SCHEMA_NAMES.filter((name) => !withInvalid.has(name)).length,
    c12Valid: c12 !== undefined && validate('TestScript', c12.document).ok,
    failures: failures.length,
    ajvDisagreements,
    failureList: failures.slice(0, 20),
  });
});
