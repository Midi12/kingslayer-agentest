/**
 * Validation against the schema registry, with errors located by JSON Pointer.
 *
 * TypeBox reports a failed union once, at the union. For a discriminated union (the
 * `discriminator` annotation) the error is reported inside the variant the value selects;
 * for other unions of objects, inside the variant the value is closest to (fewest failing
 * locations, then the deepest one, then the first variant). The first error is the most
 * specific location that explains the failure.
 *
 * JSON Schema counts string lengths in code points, TypeBox in UTF-16 code units, and Ajv
 * matches patterns with the `u` flag while TypeBox does not. Before checking, every
 * astral character (a surrogate pair) in a string value is therefore replaced by a
 * distinct private-use BMP character the document does not use, so lengths, bounded
 * quantifiers and `.` count one per code point, as in any 2020-12 validator, while
 * equality and uniqueness are preserved. Property names are left as they are.
 */
import type { TSchema } from '@sinclair/typebox';
import { TypeCompiler, type TypeCheck } from '@sinclair/typebox/compiler';
import { ValueErrorType, type ValueError, type ValueErrorIterator } from '@sinclair/typebox/errors';
import { discriminatorOf, discriminatorValues } from './discriminator.js';
import { err, ok, type Result } from './result.js';
import { SCHEMAS, type SchemaName, type SchemaType } from './schemas/registry.js';

export interface ValidationError {
  /** JSON Pointer (RFC 6901) to the offending value; empty for the root. */
  readonly path: string;
  readonly message: string;
}

const compiled = new Map<TSchema, TypeCheck<TSchema>>();

function checkerFor(schema: TSchema): TypeCheck<TSchema> {
  let checker = compiled.get(schema);
  if (checker === undefined) {
    checker = TypeCompiler.Compile(schema);
    compiled.set(schema, checker);
  }
  return checker;
}

/** Validates `value` against the registered schema `name`. */
export function validate<N extends SchemaName>(
  name: N,
  value: unknown,
): Result<SchemaType<N>, ValidationError[]> {
  return validateAgainst<SchemaType<N>>(SCHEMAS[name], value);
}

/** Validates `value` against any TypeBox schema, with the same error reporting. */
export function validateAgainst<T>(schema: TSchema, value: unknown): Result<T, ValidationError[]> {
  const checker = checkerFor(schema);
  const checked = inCodePoints(value);
  if (checker.Check(checked)) {
    return ok(value as T);
  }
  return err(explain(checker.Errors(checked)));
}

/** True when `value` conforms to the registered schema `name`. */
export function conforms<N extends SchemaName>(name: N, value: unknown): value is SchemaType<N> {
  return checkerFor(SCHEMAS[name]).Check(inCodePoints(value));
}

const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
const PRIVATE_USE = /[\uE000-\uF8FF]/g;
const PRIVATE_USE_FIRST = 0xe000;
const PRIVATE_USE_LAST = 0xf8ff;

function visitStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') {
    visit(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => {
      visitStrings(item, visit);
    });
  } else if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((item) => {
      visitStrings(item, visit);
    });
  }
}

function mapStrings(value: unknown, map: (text: string) => string): unknown {
  if (typeof value === 'string') return map(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]),
    );
  }
  return value;
}

/**
 * `value` with every astral character of its string values replaced by one BMP
 * character, injectively; `value` itself when it has none. A document with more distinct
 * astral characters than free private-use characters (6,400) is checked as it is.
 */
export function inCodePoints(value: unknown): unknown {
  const astral = new Set<string>();
  const used = new Set<string>();
  visitStrings(value, (text) => {
    for (const match of text.matchAll(SURROGATE_PAIR)) astral.add(match[0]);
    for (const match of text.matchAll(PRIVATE_USE)) used.add(match[0]);
  });
  if (astral.size === 0) return value;
  const replacement = new Map<string, string>();
  let code = PRIVATE_USE_FIRST;
  for (const character of astral) {
    while (code <= PRIVATE_USE_LAST && used.has(String.fromCharCode(code))) code++;
    if (code > PRIVATE_USE_LAST) return value;
    replacement.set(character, String.fromCharCode(code));
    code++;
  }
  return mapStrings(value, (text) =>
    text.replace(SURROGATE_PAIR, (pair) => replacement.get(pair) ?? pair),
  );
}

/** Turns TypeBox errors into refined, de-duplicated errors (one per location). */
export function explain(errors: Iterable<ValueError>): ValidationError[] {
  const out: ValidationError[] = [];
  const seen = new Set<string>();
  for (const error of errors) {
    for (const refined of refine(error)) {
      if (!seen.has(refined.path)) {
        seen.add(refined.path);
        out.push(refined);
      }
    }
  }
  return out;
}

function refine(error: ValueError): ValidationError[] {
  if (error.type !== ValueErrorType.Union) {
    return [{ path: error.path, message: error.message }];
  }
  return refineUnion(error);
}

type JsonKind = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

function kindOf(value: unknown): JsonKind | undefined {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'object':
      return 'object';
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number';
    default:
      return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** JSON kinds a schema admits; undefined means any. */
function admittedKinds(schema: unknown): Set<JsonKind> | undefined {
  const node = asRecord(schema);
  if (Array.isArray(node.anyOf)) {
    const kinds = new Set<JsonKind>();
    for (const variant of node.anyOf) {
      const inner = admittedKinds(variant);
      if (inner === undefined) return undefined;
      inner.forEach((kind) => kinds.add(kind));
    }
    return kinds;
  }
  const type = node.type;
  if (typeof type !== 'string') return undefined;
  const kinds = new Set<JsonKind>([type as JsonKind]);
  if (type === 'number') kinds.add('integer');
  return kinds;
}

function escapePointer(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

function describeValues(values: readonly unknown[]): string {
  return [...new Set(values.map((value) => JSON.stringify(value)))].join(', ');
}

function collect(iterator: ValueErrorIterator): ValidationError[] {
  return explain(iterator);
}

function depth(path: string): number {
  return path === '' ? 0 : path.split('/').length - 1;
}

function refineUnion(error: ValueError): ValidationError[] {
  const schema = asRecord(error.schema);
  const variants = Array.isArray(schema.anyOf) ? (schema.anyOf as unknown[]) : [];
  const value = error.value;
  const kind = kindOf(value);
  const discriminator = discriminatorOf(schema);

  if (typeof discriminator === 'string' && kind === 'object') {
    const record = asRecord(value);
    const tagPath = `${error.path}/${escapePointer(discriminator)}`;
    const allowed = variants.flatMap((variant) => discriminatorValues(variant, discriminator));
    if (!(discriminator in record)) {
      return [{ path: tagPath, message: 'Expected required property' }];
    }
    const index = variants.findIndex((variant) =>
      discriminatorValues(variant, discriminator).includes(record[discriminator]),
    );
    const selected = index < 0 ? undefined : error.errors[index];
    if (selected === undefined) {
      return [{ path: tagPath, message: `Expected one of ${describeValues(allowed)}` }];
    }
    return collect(selected);
  }

  const literals = variants
    .map((variant) => asRecord(variant))
    .filter((variant) => 'const' in variant);
  if (literals.length === variants.length && literals.length > 0) {
    return [
      {
        path: error.path,
        message: `Expected one of ${describeValues(literals.map((variant) => variant.const))}`,
      },
    ];
  }

  const plausible = variants
    .map((variant, index) => ({ variant, index }))
    .filter(({ variant }) => {
      const kinds = admittedKinds(variant);
      return kind !== undefined && (kinds === undefined || kinds.has(kind));
    });
  if (plausible.length === 0) {
    const kinds = new Set<string>();
    variants.forEach((variant) => admittedKinds(variant)?.forEach((k) => kinds.add(k)));
    return [{ path: error.path, message: `Expected ${[...kinds].join(' or ')}` }];
  }
  let best: ValidationError[] | undefined;
  for (const { index } of plausible) {
    const iterator = error.errors[index];
    if (iterator === undefined) continue;
    const candidate = collect(iterator);
    if (candidate.length === 0) continue;
    if (best === undefined || better(candidate, best)) {
      best = candidate;
    }
  }
  return best ?? [{ path: error.path, message: error.message }];
}

function better(candidate: ValidationError[], best: ValidationError[]): boolean {
  if (candidate.length !== best.length) return candidate.length < best.length;
  const candidateDepth = Math.max(...candidate.map((e) => depth(e.path)));
  const bestDepth = Math.max(...best.map((e) => depth(e.path)));
  return candidateDepth > bestDepth;
}
