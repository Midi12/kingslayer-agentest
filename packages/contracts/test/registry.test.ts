import { describe, expect, it } from 'vitest';
import {
  BRAIN_ENDPOINTS,
  JSON_SCHEMA_DIALECT,
  RUNNER_ENDPOINTS,
  RUNNER_ONLY_KEYWORD,
  SCHEMA_ID_BASE,
  SCHEMA_NAMES,
  exportJsonSchema,
  exportJsonSchemas,
  isSchemaName,
  schemaFileName,
  schemaFileStem,
  schemaId,
} from '../src/index.js';
import { staleFiles } from '../scripts/export-schemas.js';

describe('schema registry', () => {
  it('names files in kebab case under the v1 id base', () => {
    expect(schemaFileName('TestScript')).toBe('test-script.schema.json');
    expect(schemaId('TestScript')).toBe(
      'https://argus.dev/schemas/argus/v1/test-script.schema.json',
    );
    expect(schemaFileStem('RunEventBatch')).toBe('run-event-batch');
    expect(schemaFileStem('HTTPRequest')).toBe('http-request');
    expect(new Set(SCHEMA_NAMES.map(schemaFileName)).size).toBe(SCHEMA_NAMES.length);
    expect(isSchemaName('TestScript')).toBe(true);
    expect(isSchemaName('toString')).toBe(false);
  });

  it('exports self-contained JSON Schema 2020-12 documents', () => {
    const files = exportJsonSchemas();
    expect(files.size).toBe(SCHEMA_NAMES.length);
    for (const name of SCHEMA_NAMES) {
      const schema = exportJsonSchema(name);
      expect(schema.$schema).toBe(JSON_SCHEMA_DIALECT);
      expect(schema.$id).toBe(`${SCHEMA_ID_BASE}${schemaFileName(name)}`);
      expect(JSON.stringify(schema)).not.toContain('"$ref"');
      // Only the top level carries an $id.
      expect(JSON.stringify(schema).split('"$id"').length).toBe(2);
    }
  });

  it('marks the runner-only candidate fields', () => {
    const candidate = exportJsonSchema('Candidate') as {
      properties: Record<string, Record<string, unknown>>;
    };
    for (const field of ['bbox', 'attrs', 'fingerprint']) {
      expect(candidate.properties[field]?.[RUNNER_ONLY_KEYWORD]).toBe(true);
    }
    const navigator = exportJsonSchema('NavigatorObservation');
    expect(JSON.stringify(navigator)).not.toContain(RUNNER_ONLY_KEYWORD);
  });

  it('wires every endpoint to registered schemas', () => {
    for (const endpoint of [
      ...Object.values(BRAIN_ENDPOINTS),
      ...Object.values(RUNNER_ENDPOINTS),
    ]) {
      expect(isSchemaName(endpoint.request)).toBe(true);
      expect(isSchemaName(endpoint.response)).toBe(true);
    }
    expect(Object.keys(BRAIN_ENDPOINTS)).toEqual([
      'compile',
      'ground',
      'verify',
      'triage',
      'ground-visual',
      'assert-visual',
      'report',
    ]);
  });

  it('keeps the committed schema files fresh', () => {
    expect(staleFiles()).toEqual([]);
  });
});
