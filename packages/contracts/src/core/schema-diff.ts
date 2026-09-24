/**
 * Additive-only check for published JSON Schemas (M01-G4, "Changes inside v1 are
 * additive only"). `diffSchemaSets(old, new)` lists every change that could make a
 * document valid under the old schemas invalid under the new ones:
 *
 * - `removed-schema`: a published schema file disappeared;
 * - `removed-property`: an object property or pattern property is gone;
 * - `new-required`: a property became required;
 * - `narrowed-type`: a type accepts fewer JSON kinds, or array items became constrained;
 * - `narrowed-enum`: a `const`, `enum` or literal union accepts fewer values;
 * - `closed-object`: an open object now rejects unknown properties;
 * - `narrowed-constraint`: a bound, length, pattern, uniqueness or multiple got stricter;
 * - `removed-variant`: a union variant no longer has an equally permissive counterpart;
 * - `unmodelled-keyword`: a keyword the diff does not model (`allOf`, `not`, `if`,
 *   `format`, `propertyNames`, `$ref`, ...) was added or changed. The check fails closed:
 *   such a change is reported as breaking even when it happens to be harmless.
 */

export type BreakingKind =
  | 'removed-schema'
  | 'removed-property'
  | 'new-required'
  | 'narrowed-type'
  | 'narrowed-enum'
  | 'closed-object'
  | 'narrowed-constraint'
  | 'removed-variant'
  | 'unmodelled-keyword';

export interface BreakingChange {
  readonly file: string;
  /** JSON Pointer into the old schema. */
  readonly path: string;
  readonly kind: BreakingKind;
  readonly detail: string;
}

import { discriminatorOf, discriminatorValues } from './discriminator.js';

type Node = Record<string, unknown>;

function asNode(value: unknown): Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Node)
    : {};
}

function escape(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

const ALL_KINDS = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];

function kindOfValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/** Literal values a schema is limited to, or undefined when it is not a literal set. */
function literalValues(schema: Node): unknown[] | undefined {
  if ('const' in schema) return [schema.const];
  if (Array.isArray(schema.enum)) return schema.enum as unknown[];
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const variants = schema.anyOf.map(asNode);
    if (variants.every((variant) => 'const' in variant || Array.isArray(variant.enum))) {
      return variants.flatMap((variant) => literalValues(variant) ?? []);
    }
  }
  return undefined;
}

/** JSON kinds a schema admits; undefined means every kind. */
function kinds(schema: Node): Set<string> | undefined {
  const literals = literalValues(schema);
  if (literals !== undefined) {
    return new Set(literals.map(kindOfValue));
  }
  if (Array.isArray(schema.anyOf)) {
    const union = new Set<string>();
    for (const variant of schema.anyOf) {
      const inner = kinds(asNode(variant));
      if (inner === undefined) return undefined;
      inner.forEach((kind) => union.add(kind));
    }
    return union;
  }
  if (typeof schema.type === 'string') return expand([schema.type]);
  if (Array.isArray(schema.type)) return expand(schema.type as string[]);
  return undefined;
}

function expand(types: string[]): Set<string> {
  const set = new Set(types);
  if (set.has('number')) set.add('integer');
  return set;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether a non-literal schema accepts a literal, judged on kind, pattern and length. */
function admitsLiteral(schema: Node, value: unknown): boolean {
  const admitted = kinds(schema);
  if (admitted !== undefined && !admitted.has(kindOfValue(value))) return false;
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value))
      return false;
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
  }
  return true;
}

/** Keywords whose changes `compare` understands. */
const MODELLED_KEYWORDS = new Set([
  'type',
  'const',
  'enum',
  'anyOf',
  'properties',
  'required',
  'patternProperties',
  'additionalProperties',
  'items',
  'minimum',
  'exclusiveMinimum',
  'maximum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'pattern',
  'multipleOf',
  'uniqueItems',
]);

/** Annotations: they never change which documents are valid. */
const ANNOTATION_KEYWORDS = new Set([
  '$id',
  '$schema',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  'discriminator',
  'x-runner-only',
]);

const LOWER_BOUNDS = ['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties'];
const UPPER_BOUNDS = ['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties'];

function compare(
  file: string,
  before: Node,
  after: Node,
  path: string,
  out: BreakingChange[],
): void {
  const push = (kind: BreakingKind, detail: string, at = path) => {
    out.push({ file, path: at, kind, detail });
  };

  // Fail closed on any assertion keyword the diff does not model.
  for (const key of Object.keys(after).sort()) {
    if (MODELLED_KEYWORDS.has(key) || ANNOTATION_KEYWORDS.has(key)) continue;
    if (!(key in before)) {
      push('unmodelled-keyword', `keyword ${key} was added`);
    } else if (!same(before[key], after[key])) {
      push('unmodelled-keyword', `keyword ${key} changed`);
    }
  }

  // Union on either side: every old variant needs an equally permissive new variant.
  const oldLiterals = literalValues(before);
  const newLiterals = literalValues(after);
  if (newLiterals !== undefined) {
    if (oldLiterals === undefined) {
      push('narrowed-enum', `now limited to ${JSON.stringify(newLiterals)}`);
    } else {
      const missing = oldLiterals.filter(
        (value) => !newLiterals.some((candidate) => same(candidate, value)),
      );
      if (missing.length > 0) {
        push(
          'narrowed-enum',
          `no longer accepts ${missing.map((v) => JSON.stringify(v)).join(', ')}`,
        );
      }
    }
    return;
  }
  if (oldLiterals !== undefined) {
    const rejected = oldLiterals.filter((value) => !admitsLiteral(after, value));
    if (rejected.length > 0) {
      push(
        'narrowed-type',
        `no longer accepts ${rejected.map((v) => JSON.stringify(v)).join(', ')}`,
      );
    }
    return;
  }
  if (Array.isArray(before.anyOf) || Array.isArray(after.anyOf)) {
    const oldVariants = Array.isArray(before.anyOf) ? before.anyOf.map(asNode) : [before];
    const newVariants = Array.isArray(after.anyOf) ? after.anyOf.map(asNode) : [after];
    const tag = discriminatorOf(before) ?? discriminatorOf(after);
    oldVariants.forEach((variant, index) => {
      const at = Array.isArray(before.anyOf) ? `${path}/anyOf/${index}` : path;
      const values = tag === undefined ? [] : discriminatorValues(variant, tag);
      if (tag !== undefined && values.length > 0) {
        // Discriminated: compare with the variants that now take the same tag values.
        const lost = values.filter(
          (value) =>
            !newVariants.some((candidate) =>
              discriminatorValues(candidate, tag).some((v) => same(v, value)),
            ),
        );
        if (lost.length > 0) {
          push(
            'removed-variant',
            `no variant accepts ${tag} ${lost.map((v) => JSON.stringify(v)).join(', ')}`,
            at,
          );
          return;
        }
        const matches = newVariants.filter((candidate) =>
          discriminatorValues(candidate, tag).some((v) => values.some((value) => same(v, value))),
        );
        for (const candidate of matches) compare(file, variant, candidate, at, out);
        return;
      }
      const attempts = newVariants.map((candidate) => {
        const changes: BreakingChange[] = [];
        compare(file, variant, candidate, at, changes);
        return changes;
      });
      if (attempts.some((changes) => changes.length === 0)) return;
      const aligned = attempts[Math.min(index, attempts.length - 1)] ?? [];
      push(
        'removed-variant',
        `no new variant accepts everything old variant ${index} accepted (${aligned.map((c) => `${c.kind} at ${c.path}`).join('; ')})`,
        at,
      );
    });
    return;
  }
  const oldKinds = kinds(before);
  const newKinds = kinds(after);
  if (newKinds !== undefined) {
    const lost = [...(oldKinds ?? ALL_KINDS)].filter((kind) => !newKinds.has(kind));
    if (lost.length > 0) {
      push('narrowed-type', `no longer accepts ${lost.join(', ')}`);
      return;
    }
  }

  for (const key of LOWER_BOUNDS) {
    const a = before[key];
    const b = after[key];
    if (typeof b === 'number' && (typeof a !== 'number' || b > a)) {
      push('narrowed-constraint', `${key} ${String(a)} -> ${b}`);
    }
  }
  for (const key of UPPER_BOUNDS) {
    const a = before[key];
    const b = after[key];
    if (typeof b === 'number' && (typeof a !== 'number' || b < a)) {
      push('narrowed-constraint', `${key} ${String(a)} -> ${b}`);
    }
  }
  if (after.pattern !== undefined && after.pattern !== before.pattern) {
    push(
      'narrowed-constraint',
      `pattern ${JSON.stringify(before.pattern)} -> ${JSON.stringify(after.pattern)}`,
    );
  }
  if (after.multipleOf !== undefined && after.multipleOf !== before.multipleOf) {
    push(
      'narrowed-constraint',
      `multipleOf ${JSON.stringify(before.multipleOf)} -> ${JSON.stringify(after.multipleOf)}`,
    );
  }
  if (after.uniqueItems === true && before.uniqueItems !== true) {
    push('narrowed-constraint', 'uniqueItems added');
  }

  // Objects
  const oldProperties = asNode(before.properties);
  const newProperties = asNode(after.properties);
  for (const [name, schema] of Object.entries(oldProperties)) {
    const at = `${path}/properties/${escape(name)}`;
    if (!(name in newProperties)) {
      push('removed-property', `property ${name} was removed`, at);
    } else {
      compare(file, asNode(schema), asNode(newProperties[name]), at, out);
    }
  }
  const oldRequired = new Set(Array.isArray(before.required) ? (before.required as string[]) : []);
  const newRequired = Array.isArray(after.required) ? (after.required as string[]) : [];
  for (const name of newRequired) {
    if (!oldRequired.has(name)) {
      push('new-required', `property ${name} is now required`, `${path}/required`);
    }
  }
  const oldPatterns = asNode(before.patternProperties);
  const newPatterns = asNode(after.patternProperties);
  for (const [pattern, schema] of Object.entries(oldPatterns)) {
    const at = `${path}/patternProperties/${escape(pattern)}`;
    if (!(pattern in newPatterns)) {
      push('removed-property', `pattern property ${pattern} was removed`, at);
    } else {
      compare(file, asNode(schema), asNode(newPatterns[pattern]), at, out);
    }
  }
  if (after.additionalProperties === false && before.additionalProperties !== false) {
    push('closed-object', 'unknown properties are now rejected');
  } else if (
    typeof before.additionalProperties === 'object' &&
    typeof after.additionalProperties === 'object'
  ) {
    compare(
      file,
      asNode(before.additionalProperties),
      asNode(after.additionalProperties),
      `${path}/additionalProperties`,
      out,
    );
  }

  // Arrays
  if (after.items !== undefined) {
    if (before.items === undefined) {
      push('narrowed-type', 'array items are now constrained', `${path}/items`);
    } else {
      compare(file, asNode(before.items), asNode(after.items), `${path}/items`, out);
    }
  }
}

/** Breaking changes between one old and one new schema document. */
export function diffSchema(file: string, before: unknown, after: unknown): BreakingChange[] {
  const out: BreakingChange[] = [];
  compare(file, asNode(before), asNode(after), '', out);
  return out;
}

/** Breaking changes between two sets of published schemas keyed by file name. */
export function diffSchemaSets(
  before: ReadonlyMap<string, unknown>,
  after: ReadonlyMap<string, unknown>,
): BreakingChange[] {
  const out: BreakingChange[] = [];
  for (const [file, schema] of [...before.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const next = after.get(file);
    if (next === undefined) {
      out.push({ file, path: '', kind: 'removed-schema', detail: `${file} was removed` });
    } else {
      out.push(...diffSchema(file, schema, next));
    }
  }
  return out;
}
