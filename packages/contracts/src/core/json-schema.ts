/**
 * JSON Schema 2020-12 export of the registry. Each schema is published self-contained:
 * nested schemas are inlined and only the top level carries `$id`.
 */
import {
  SCHEMAS,
  SCHEMA_NAMES,
  schemaFileName,
  schemaId,
  type SchemaName,
} from './schemas/registry.js';
import { RUNNER_ONLY_KEYWORD } from './schemas/observation.js';

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/**
 * Non-standard keywords the published schemas use as annotations: `discriminator`
 * (OpenAPI 3.1) and `x-runner-only`. A strict validator such as Ajv must be told about
 * them, e.g. `new Ajv2020({ keywords: [...CONTRACT_KEYWORDS] })`.
 */
export const CONTRACT_KEYWORDS = ['discriminator', RUNNER_ONLY_KEYWORD] as const;

export type JsonSchemaDocument = Record<string, unknown>;

/** The published JSON Schema of one registered schema. */
export function exportJsonSchema(name: SchemaName): JsonSchemaDocument {
  // A JSON round trip drops TypeBox's symbol-keyed metadata and copies the tree.
  const body = JSON.parse(JSON.stringify(SCHEMAS[name])) as JsonSchemaDocument;
  delete body.$id;
  return { $schema: JSON_SCHEMA_DIALECT, $id: schemaId(name), title: name, ...body };
}

/** Every published schema by file name, in registry order. */
export function exportJsonSchemas(): Map<string, JsonSchemaDocument> {
  const files = new Map<string, JsonSchemaDocument>();
  for (const name of SCHEMA_NAMES) {
    files.set(schemaFileName(name), exportJsonSchema(name));
  }
  return files;
}

/** The exact text of a published schema file. */
export function serializeJsonSchema(schema: JsonSchemaDocument): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
