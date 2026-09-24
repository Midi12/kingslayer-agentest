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
 *   `format`, `propertyNames`, `$ref`, ...) was added or changed, or an old literal meets
 *   one in the new schema so that the diff cannot tell whether it is still accepted. The
 *   check fails closed: such a change is reported as breaking even when it is harmless.
 *
 * Boolean subschemas keep their JSON Schema meaning: `true` accepts every value and
 * `false` rejects every value, so a subschema that becomes `false` is a narrowing.
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

/** A subschema as JSON Schema reads it: `false` rejects everything, `true` is `{}`. */
function toSchema(value: unknown): Node | false {
  return value === false ? false : asNode(value);
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
      if (variant === false) continue;
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

/** JSON equality: member order does not matter, array order does. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => same(item, b[index]))
    );
  }
  const left = a as Node;
  const right = b as Node;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
  );
}

/** Whether a schema accepts a value: `unknown` when it uses a keyword the diff does not model. */
type Verdict = 'yes' | 'no' | 'unknown';

function all(verdicts: Iterable<Verdict>): Verdict {
  let result: Verdict = 'yes';
  for (const verdict of verdicts) {
    if (verdict === 'no') return 'no';
    if (verdict === 'unknown') result = 'unknown';
  }
  return result;
}

function hasKind(types: unknown, value: unknown): boolean {
  const list = Array.isArray(types) ? types : [types];
  const kind = kindOfValue(value);
  return list.some((type) => type === kind || (type === 'number' && kind === 'integer'));
}

/**
 * Evaluates a schema on one value with the keywords `compare` models (JSON Schema
 * semantics: lengths in code points, boolean subschemas). An unmodelled keyword or a
 * pattern that does not compile makes the answer `unknown`, never `yes`.
 */
function accepts(raw: unknown, value: unknown): Verdict {
  if (raw === true) return 'yes';
  if (raw === false) return 'no';
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'unknown';
  const schema = raw as Node;
  const verdicts: Verdict[] = [];
  for (const key of Object.keys(schema)) {
    if (!MODELLED_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) verdicts.push('unknown');
  }
  const check = (condition: boolean) => verdicts.push(condition ? 'yes' : 'no');
  if (schema.type !== undefined) check(hasKind(schema.type, value));
  if ('const' in schema) check(same(schema.const, value));
  if (Array.isArray(schema.enum)) check(schema.enum.some((item) => same(item, value)));
  if (Array.isArray(schema.anyOf)) {
    const options = schema.anyOf.map((variant) => accepts(variant, value));
    verdicts.push(options.includes('yes') ? 'yes' : options.includes('unknown') ? 'unknown' : 'no');
  }
  if (typeof value === 'number') {
    const bound = (key: string, test: (limit: number) => boolean) => {
      const limit = schema[key];
      if (typeof limit === 'number') check(test(limit));
    };
    bound('minimum', (limit) => value >= limit);
    bound('exclusiveMinimum', (limit) => value > limit);
    bound('maximum', (limit) => value <= limit);
    bound('exclusiveMaximum', (limit) => value < limit);
    bound('multipleOf', (limit) => limit > 0 && Number.isInteger(value / limit));
  }
  if (typeof value === 'string') {
    const length = value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length; // code points
    if (typeof schema.minLength === 'number') check(length >= schema.minLength);
    if (typeof schema.maxLength === 'number') check(length <= schema.maxLength);
    if (typeof schema.pattern === 'string') {
      let expression: RegExp | undefined;
      try {
        expression = new RegExp(schema.pattern, 'u');
      } catch {
        verdicts.push('unknown');
      }
      if (expression !== undefined) check(expression.test(value));
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number') check(value.length >= schema.minItems);
    if (typeof schema.maxItems === 'number') check(value.length <= schema.maxItems);
    if (schema.uniqueItems === true) {
      check(value.every((item, index) => value.findIndex((other) => same(other, item)) === index));
    }
    if (schema.items !== undefined) {
      verdicts.push(all(value.map((item) => accepts(schema.items, item))));
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const members = value as Node;
    const names = Object.keys(members);
    if (typeof schema.minProperties === 'number') check(names.length >= schema.minProperties);
    if (typeof schema.maxProperties === 'number') check(names.length <= schema.maxProperties);
    if (Array.isArray(schema.required)) {
      check(
        schema.required.every((name) => typeof name === 'string' && Object.hasOwn(members, name)),
      );
    }
    const properties = asNode(schema.properties);
    const patterns = Object.entries(asNode(schema.patternProperties));
    for (const name of names) {
      const governors: unknown[] = [];
      if (Object.hasOwn(properties, name)) governors.push(properties[name]);
      for (const [pattern, sub] of patterns) {
        let applies: boolean | undefined;
        try {
          applies = new RegExp(pattern, 'u').test(name);
        } catch {
          verdicts.push('unknown');
        }
        if (applies === true) governors.push(sub);
      }
      if (governors.length === 0 && schema.additionalProperties !== undefined) {
        governors.push(schema.additionalProperties);
      }
      verdicts.push(all(governors.map((governor) => accepts(governor, members[name]))));
    }
  }
  return all(verdicts);
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
  rawBefore: unknown,
  rawAfter: unknown,
  path: string,
  out: BreakingChange[],
): void {
  const push = (kind: BreakingKind, detail: string, at = path) => {
    out.push({ file, path: at, kind, detail });
  };
  const before = toSchema(rawBefore);
  const after = toSchema(rawAfter);
  if (before === false) return; // nothing was accepted: nothing can be lost
  if (after === false) {
    push('narrowed-type', 'the schema is now false and rejects every value');
    return;
  }

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
    // Every old literal is evaluated against the whole new schema: kinds, bounds,
    // multiples, lengths, patterns, required members, items and nested subschemas.
    const verdicts = oldLiterals.map((value) => ({ value, verdict: accepts(after, value) }));
    const list = (verdict: Verdict) =>
      verdicts
        .filter((entry) => entry.verdict === verdict)
        .map((entry) => JSON.stringify(entry.value))
        .join(', ');
    const rejected = list('no');
    if (rejected !== '') push('narrowed-type', `no longer accepts ${rejected}`);
    const undecided = list('unknown');
    if (undecided !== '') {
      push(
        'unmodelled-keyword',
        `cannot tell whether ${undecided} is still accepted: the new schema uses a keyword the diff does not model or a pattern that does not compile`,
      );
    }
    return;
  }
  if (Array.isArray(before.anyOf) || Array.isArray(after.anyOf)) {
    const oldVariants: (Node | false)[] = Array.isArray(before.anyOf)
      ? before.anyOf.map(toSchema)
      : [before];
    const newVariants: (Node | false)[] = Array.isArray(after.anyOf)
      ? after.anyOf.map(toSchema)
      : [after];
    const tag = discriminatorOf(before) ?? discriminatorOf(after);
    oldVariants.forEach((variant, index) => {
      if (variant === false) return; // it accepted nothing
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

  // Objects. A member name is governed by its property schema and every pattern property
  // it matches, or by additionalProperties when neither applies (absent or true: any
  // value). Every schema that governs a name now must accept whatever some schema that
  // governed it before accepted, so a property or pattern added to an open object or a
  // record cannot narrow what old documents carried under that name.
  const oldProperties = asNode(before.properties);
  const newProperties = asNode(after.properties);
  const names = new Set([...Object.keys(oldProperties), ...Object.keys(newProperties)]);
  for (const name of names) {
    const at = `${path}/properties/${escape(name)}`;
    if (Object.hasOwn(oldProperties, name) && !Object.hasOwn(newProperties, name)) {
      push('removed-property', `property ${name} was removed`, at);
      continue;
    }
    const sources = governing(before, name);
    if (sources.includes(false)) continue; // the name was rejected before
    for (const next of governing(after, name)) {
      requireImplied(file, sources as Node[], next, at, out);
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
      compare(file, schema, newPatterns[pattern], at, out);
    }
  }
  const oldAdditional = additional(before.additionalProperties);
  for (const [pattern, schema] of Object.entries(newPatterns)) {
    if (pattern in oldPatterns) continue;
    // Which old patterns overlap the new one is not decidable in general: every one of
    // them, and additionalProperties unless it was false, must admit the new schema.
    const at = `${path}/patternProperties/${escape(pattern)}`;
    const sources = [
      ...Object.values(oldPatterns),
      ...(oldAdditional === false ? [] : [oldAdditional]),
    ];
    for (const source of sources) compare(file, source, schema, at, out);
  }
  const newAdditional = additional(after.additionalProperties);
  if (newAdditional === false) {
    if (oldAdditional !== false) push('closed-object', 'unknown properties are now rejected');
  } else if (oldAdditional !== false && typeof after.additionalProperties === 'object') {
    // Absent or true on both sides admits anything: nothing to compare.
    compare(file, oldAdditional, newAdditional, `${path}/additionalProperties`, out);
  }

  // Arrays
  if (after.items !== undefined && after.items !== true) {
    if (before.items === undefined) {
      push('narrowed-type', 'array items are now constrained', `${path}/items`);
    } else {
      compare(file, before.items, after.items, `${path}/items`, out);
    }
  }
}

/** additionalProperties as a schema: absent or true admit anything, false admits nothing. */
function additional(value: unknown): Node | false {
  return toSchema(value);
}

/** Whether a pattern property applies to a name; an unreadable pattern is assumed to. */
function matches(pattern: string, name: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(name);
  } catch {
    return true;
  }
}

/** The schemas that govern a member name of an object schema (false: it is rejected). */
function governing(schema: Node, name: string): (Node | false)[] {
  const properties = asNode(schema.properties);
  const result: (Node | false)[] = [];
  if (Object.hasOwn(properties, name)) result.push(toSchema(properties[name]));
  for (const [pattern, sub] of Object.entries(asNode(schema.patternProperties))) {
    if (matches(pattern, name)) result.push(toSchema(sub));
  }
  if (result.length === 0) result.push(additional(schema.additionalProperties));
  return result;
}

/**
 * Reports the changes from the first source unless some source already accepts
 * everything `next` requires. The test is per source, so a schema implied only by several
 * old schemas together is reported: the diff stays on the safe side.
 */
function requireImplied(
  file: string,
  sources: readonly Node[],
  next: Node | false,
  path: string,
  out: BreakingChange[],
): void {
  let first: BreakingChange[] | undefined;
  for (const source of sources) {
    const changes: BreakingChange[] = [];
    compare(file, source, next, path, changes);
    if (changes.length === 0) return;
    first ??= changes;
  }
  out.push(...(first ?? []));
}

/** Breaking changes between one old and one new schema document. */
export function diffSchema(file: string, before: unknown, after: unknown): BreakingChange[] {
  const out: BreakingChange[] = [];
  compare(file, before, after, '', out);
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
