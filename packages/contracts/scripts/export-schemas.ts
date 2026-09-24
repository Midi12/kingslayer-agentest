/**
 * Writes the JSON Schema 2020-12 files of every registered schema to
 * `schemas/argus/v1/<name>.schema.json` and removes files no schema produces.
 *
 *   pnpm --filter @argus/contracts export-schemas             # regenerate
 *   pnpm --filter @argus/contracts export-schemas --check     # exit 1 when stale
 *   pnpm --filter @argus/contracts export-schemas --baseline  # also snapshot schemas/baseline/
 *
 * `--baseline` is for a release: the snapshot is what M01-G4 compares against until a
 * `v*` tag exists (ADR M01-schema-compatibility).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportJsonSchemas, serializeJsonSchema } from '../src/index.js';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA_DIR = join(packageDir, 'schemas', 'argus', 'v1');
export const BASELINE_DIR = join(packageDir, 'schemas', 'baseline');

function listJson(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith('.schema.json'))
        .sort()
    : [];
}

/** Files whose committed text differs from the generated text, plus extra files. */
export function staleFiles(dir: string = SCHEMA_DIR): string[] {
  const generated = exportJsonSchemas();
  const stale: string[] = [];
  for (const [file, schema] of generated) {
    const path = join(dir, file);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== serializeJsonSchema(schema)) {
      stale.push(file);
    }
  }
  for (const file of listJson(dir)) {
    if (!generated.has(file)) stale.push(file);
  }
  return stale.sort();
}

export function writeSchemas(dir: string): number {
  const generated = exportJsonSchemas();
  mkdirSync(dir, { recursive: true });
  for (const file of listJson(dir)) {
    if (!generated.has(file)) rmSync(join(dir, file));
  }
  for (const [file, schema] of generated) {
    writeFileSync(join(dir, file), serializeJsonSchema(schema));
  }
  return generated.size;
}

function main(args: readonly string[]): number {
  if (args.includes('--check')) {
    const stale = staleFiles();
    if (stale.length > 0) {
      console.error(`stale schema files (run export-schemas): ${stale.join(', ')}`);
      return 1;
    }
    console.log('schema files are up to date');
    return 0;
  }
  const count = writeSchemas(SCHEMA_DIR);
  console.log(`wrote ${count} schemas to ${SCHEMA_DIR}`);
  if (args.includes('--baseline')) {
    writeSchemas(BASELINE_DIR);
    console.log(`snapshot written to ${BASELINE_DIR}`);
  }
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
