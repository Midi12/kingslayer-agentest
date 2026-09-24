/** Loading of the golden documents under test/__golden__. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_DIR = join(TEST_DIR, '..');
export const GOLDEN_DIR = join(TEST_DIR, '__golden__');

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

export interface ValidGolden {
  schema: string;
  name: string;
  file: string;
  document: unknown;
}

export interface InvalidGolden {
  schema: string;
  rule: string;
  file: string;
  reason: string;
  expectedPath: string;
  document: unknown;
}

export function validGoldens(): ValidGolden[] {
  const root = join(GOLDEN_DIR, 'valid');
  return listDir(root).flatMap((schema) =>
    listDir(join(root, schema))
      .filter((file) => file.endsWith('.json'))
      .map((file) => ({
        schema,
        name: file.replace(/\.json$/, ''),
        file: join(root, schema, file),
        document: readJson(join(root, schema, file)),
      })),
  );
}

export function invalidGoldens(): InvalidGolden[] {
  const root = join(GOLDEN_DIR, 'invalid');
  return listDir(root).flatMap((schema) =>
    listDir(join(root, schema))
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const golden = readJson(join(root, schema, file)) as {
          reason: string;
          expectedPath: string;
          document: unknown;
        };
        return {
          schema,
          rule: file.replace(/\.json$/, ''),
          file: join(root, schema, file),
          reason: golden.reason,
          expectedPath: golden.expectedPath,
          document: golden.document,
        };
      }),
  );
}

export interface LintFixture {
  name: string;
  context: {
    criticalVerbs: string[];
    allowedOrigins: string[];
    allowedHttpHosts: string[];
    runTimeoutMs: number;
    previous?: unknown;
  };
  script: unknown;
  expected: { code: string; stepId: string | null }[];
}

export function lintFixtures(): LintFixture[] {
  const root = join(GOLDEN_DIR, 'lint');
  return listDir(root)
    .filter((file) => file.endsWith('.json'))
    .map((file) => ({
      name: file.replace(/\.json$/, ''),
      ...(readJson(join(root, file)) as Omit<LintFixture, 'name'>),
    }));
}

export interface RenderGolden {
  name: string;
  script: unknown;
  expected: string;
}

/** Each `render/<name>.txt` with the script `valid/TestScript/<name>.json`. */
export function renderGoldens(): RenderGolden[] {
  const root = join(GOLDEN_DIR, 'render');
  return listDir(root)
    .filter((file) => file.endsWith('.txt'))
    .map((file) => {
      const name = file.replace(/\.txt$/, '');
      return {
        name,
        script: readJson(join(GOLDEN_DIR, 'valid', 'TestScript', `${name}.json`)),
        expected: readFileSync(join(root, file), 'utf8'),
      };
    });
}

/** Schema files of a directory, keyed by file name. */
export function readSchemaDir(dir: string): Map<string, unknown> {
  const files = new Map<string, unknown>();
  for (const file of listDir(dir)) {
    if (file.endsWith('.json')) files.set(file, readJson(join(dir, file)));
  }
  return files;
}

export interface DiffCase {
  name: string;
  note: string;
  expectedKinds: string[];
  before: Map<string, unknown>;
  after: Map<string, unknown>;
}

export function schemaDiffCases(): DiffCase[] {
  const root = join(GOLDEN_DIR, 'schema-diff');
  return listDir(root).map((name) => {
    const meta = readJson(join(root, name, 'case.json')) as {
      note: string;
      expectedKinds: string[];
    };
    return {
      name,
      note: meta.note,
      expectedKinds: meta.expectedKinds,
      before: readSchemaDir(join(root, name, 'before')),
      after: readSchemaDir(join(root, name, 'after')),
    };
  });
}
