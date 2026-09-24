import { describe, expect, it } from 'vitest';
import { diffSchema, diffSchemaSets, exportJsonSchema } from '../src/index.js';

const kinds = (before: unknown, after: unknown) =>
  diffSchema('x.schema.json', before, after).map((change) => change.kind);

describe('diffSchema', () => {
  it('accepts identical and widened schemas', () => {
    const schema = {
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string', maxLength: 5 } },
    };
    expect(kinds(schema, schema)).toEqual([]);
    expect(kinds({ type: 'integer' }, { type: 'number' })).toEqual([]);
    expect(kinds({ type: 'string', minLength: 2 }, { type: 'string' })).toEqual([]);
    expect(kinds({ type: 'string' }, { type: ['string', 'null'] })).toEqual([]);
    expect(kinds({ const: 'a' }, { enum: ['a', 'b'] })).toEqual([]);
    expect(kinds({ const: 'a' }, { type: 'string', pattern: '^[a-z]$' })).toEqual([]);
    expect(kinds({ type: 'string' }, { anyOf: [{ type: 'string' }, { type: 'null' }] })).toEqual(
      [],
    );
    expect(kinds({ anyOf: [{ type: 'string' }, { type: 'number' }] }, {})).toEqual([]);
  });

  it('detects narrowed bounds, patterns and array constraints', () => {
    expect(kinds({ type: 'number' }, { type: 'number', minimum: 0 })).toEqual([
      'narrowed-constraint',
    ]);
    expect(kinds({ type: 'number', maximum: 10 }, { type: 'number', maximum: 5 })).toEqual([
      'narrowed-constraint',
    ]);
    expect(kinds({ type: 'string' }, { type: 'string', pattern: '^a' })).toEqual([
      'narrowed-constraint',
    ]);
    expect(kinds({ type: 'number' }, { type: 'number', multipleOf: 2 })).toEqual([
      'narrowed-constraint',
    ]);
    expect(kinds({ type: 'array' }, { type: 'array', uniqueItems: true })).toEqual([
      'narrowed-constraint',
    ]);
    expect(kinds({ type: 'array' }, { type: 'array', items: { type: 'string' } })).toEqual([
      'narrowed-type',
    ]);
    expect(
      kinds(
        { type: 'array', items: { type: 'number' } },
        { type: 'array', items: { type: 'integer' } },
      ),
    ).toEqual(['narrowed-type']);
    expect(kinds({}, { type: 'object' })).toEqual(['narrowed-type']);
  });

  it('detects narrowed literals', () => {
    expect(kinds({ type: 'string' }, { enum: ['a'] })).toEqual(['narrowed-enum']);
    expect(kinds({ enum: ['a', 'b'] }, { const: 'a' })).toEqual(['narrowed-enum']);
    expect(kinds({ const: 'abc' }, { type: 'string', maxLength: 2 })).toEqual(['narrowed-type']);
    expect(kinds({ const: 'a' }, { type: 'string', minLength: 2 })).toEqual(['narrowed-type']);
    expect(kinds({ const: 1 }, { type: 'string' })).toEqual(['narrowed-type']);
  });

  it('compares pattern and additional properties', () => {
    const before = {
      type: 'object',
      patternProperties: { '^a': { type: 'string' } },
      additionalProperties: { type: 'number' },
    };
    expect(kinds(before, before)).toEqual([]);
    expect(kinds(before, { type: 'object', additionalProperties: { type: 'number' } })).toEqual([
      'removed-property',
    ]);
    expect(kinds(before, { ...before, patternProperties: { '^a': { type: 'number' } } })).toEqual([
      'narrowed-type',
    ]);
    expect(kinds(before, { ...before, additionalProperties: { type: 'integer' } })).toEqual([
      'narrowed-type',
    ]);
  });

  it('matches undiscriminated variants by permissiveness', () => {
    const before = {
      anyOf: [
        { type: 'object', required: ['a'] },
        { type: 'object', required: ['b'] },
      ],
    };
    expect(
      kinds(before, {
        anyOf: [
          { type: 'object', required: ['b'] },
          { type: 'object', required: ['a'] },
        ],
      }),
    ).toEqual([]);
    expect(kinds(before, { anyOf: [{ type: 'object', required: ['a'] }] })).toEqual([
      'removed-variant',
    ]);
    expect(kinds({ type: 'string' }, { anyOf: [{ type: 'number' }] })).toEqual(['removed-variant']);
  });

  it('reports removed schemas in a set', () => {
    const changes = diffSchemaSets(
      new Map([
        ['b.json', {}],
        ['a.json', {}],
      ]),
      new Map([['b.json', {}]]),
    );
    expect(changes).toEqual([
      { file: 'a.json', path: '', kind: 'removed-schema', detail: 'a.json was removed' },
    ]);
  });
});

describe('diffSchema fails closed on keywords it does not model', () => {
  const published = exportJsonSchema('TestScript') as Record<string, unknown>;
  const additions: Record<string, unknown> = {
    allOf: [{ required: ['variables'] }],
    not: { required: ['handlers'] },
    if: { required: ['handlers'] },
    then: { required: ['secrets'] },
    dependentRequired: { handlers: ['secrets'] },
    dependentSchemas: { handlers: { required: ['secrets'] } },
    propertyNames: { maxLength: 3 },
    format: 'uri',
    oneOf: [{ type: 'object' }],
    $ref: '#/$defs/x',
    unevaluatedProperties: false,
    prefixItems: [{ type: 'string' }],
    contains: { const: 'x' },
  };

  it.each(Object.entries(additions))('reports a new %s at the root and inside', (key, value) => {
    const root = { ...structuredClone(published), [key]: value };
    expect(kinds(published, root)).toEqual(['unmodelled-keyword']);
    const nested = structuredClone(published) as {
      properties: { target: Record<string, unknown> };
    };
    nested.properties.target[key] = value;
    const changes = diffSchema('test-script.schema.json', published, nested);
    expect(changes.map((change) => [change.kind, change.path])).toEqual([
      ['unmodelled-keyword', '/properties/target'],
    ]);
  });

  it('reports a changed unmodelled keyword and ignores unchanged ones and annotations', () => {
    expect(kinds({ format: 'uri' }, { format: 'uri' })).toEqual([]);
    expect(kinds({ format: 'uri' }, { format: 'email' })).toEqual(['unmodelled-keyword']);
    expect(kinds({ not: { const: 1 } }, {})).toEqual([]);
    expect(
      kinds({ type: 'string' }, { type: 'string', title: 'T', description: 'd', examples: ['x'] }),
    ).toEqual([]);
  });

  it('turns an unmodelled keyword inside a union variant into a removed variant', () => {
    const before = { anyOf: [{ type: 'string' }, { type: 'integer' }] };
    const after = { anyOf: [{ type: 'string', format: 'uri' }, { type: 'integer' }] };
    expect(kinds(before, after)).toEqual(['removed-variant']);
  });
});

describe('diffSchema, members governed by patterns and additionalProperties', () => {
  const open = { type: 'object', properties: { code: { type: 'string' } } };
  const record = {
    type: 'object',
    patternProperties: { '^[a-z]+$': { type: ['string', 'boolean'] } },
    additionalProperties: false,
  };

  it('treats a schema for additionalProperties on an open object as narrowing', () => {
    expect(kinds(open, { ...open, additionalProperties: { type: 'string' } })).toEqual([
      'narrowed-type',
    ]);
    expect(
      kinds({ ...open, additionalProperties: true }, { ...open, additionalProperties: {} }),
    ).toEqual([]);
    expect(kinds({ ...open, additionalProperties: { type: 'string' } }, { ...open })).toEqual([]);
  });

  it('reports a typed property added to an open object', () => {
    const after = { ...open, properties: { ...open.properties, extra: { type: 'string' } } };
    expect(diffSchema('x', open, after).map((c) => [c.kind, c.path])).toEqual([
      ['narrowed-type', '/properties/extra'],
    ]);
    const untyped = { ...open, properties: { ...open.properties, extra: {} } };
    expect(kinds(open, untyped)).toEqual([]);
    const closed = { ...open, additionalProperties: false };
    const closedAfter = {
      ...closed,
      properties: { ...open.properties, extra: { type: 'string' } },
    };
    expect(kinds(closed, closedAfter)).toEqual([]);
  });

  it('checks a named property added to a record against the pattern it used to match', () => {
    expect(kinds(record, { ...record, properties: { x: { type: 'boolean' } } })).toEqual([
      'narrowed-type',
    ]);
    expect(
      kinds(record, { ...record, properties: { x: { type: ['string', 'boolean', 'null'] } } }),
    ).toEqual([]);
    // A name the old record rejected may take any schema.
    expect(kinds(record, { ...record, properties: { X1: { type: 'boolean' } } })).toEqual([]);
  });

  it('checks a pattern property added next to an overlapping one or an open remainder', () => {
    const overlapping = {
      ...record,
      patternProperties: { ...record.patternProperties, '^x': { type: 'boolean' } },
    };
    expect(kinds(record, overlapping)).toEqual(['narrowed-type']);
    expect(kinds(open, { ...open, patternProperties: { '^x-': { type: 'string' } } })).toEqual([
      'narrowed-type',
    ]);
    // A new pattern that also constrains an existing property is checked through it.
    const named = { type: 'object', properties: { xray: { type: 'string' } } };
    expect(
      kinds(named, {
        ...named,
        additionalProperties: false,
        patternProperties: { '^x': { type: 'string', maxLength: 3 } },
      }),
    ).toEqual(['narrowed-constraint', 'narrowed-type', 'closed-object']);
    // An unreadable pattern is assumed to match.
    const odd = { ...record, patternProperties: { '(': { type: 'boolean' } } };
    expect(kinds(odd, { ...odd, properties: { a: { type: 'string' } } })).toEqual([
      'narrowed-type',
    ]);
  });

  it('checks every old literal against the whole new schema', () => {
    expect(kinds({ const: 5 }, { type: 'number', maximum: 3 })).toEqual(['narrowed-type']);
    expect(kinds({ const: 5 }, { type: 'number', exclusiveMaximum: 5 })).toEqual(['narrowed-type']);
    expect(kinds({ enum: [1, 2, 3] }, { type: 'integer', minimum: 2 })).toEqual(['narrowed-type']);
    expect(kinds({ enum: [3] }, { type: 'number', exclusiveMinimum: 3 })).toEqual([
      'narrowed-type',
    ]);
    expect(kinds({ enum: [3] }, { type: 'number', multipleOf: 2 })).toEqual(['narrowed-type']);
    expect(kinds({ const: { a: 1 } }, { type: 'object', required: ['b'] })).toEqual([
      'narrowed-type',
    ]);
    expect(kinds({ const: { a: 1 } }, { type: 'object', maxProperties: 0 })).toEqual([
      'narrowed-type',
    ]);
    expect(
      kinds({ const: { a: 1 } }, { type: 'object', properties: { a: { type: 'string' } } }),
    ).toEqual(['narrowed-type']);
    expect(kinds({ const: { a: 1 } }, { type: 'object', additionalProperties: false })).toEqual([
      'narrowed-type',
    ]);
    expect(
      kinds({ const: { xa: 1 } }, { type: 'object', patternProperties: { '^x': false } }),
    ).toEqual(['narrowed-type']);
    expect(kinds({ const: [1, 1] }, { type: 'array', uniqueItems: true })).toEqual([
      'narrowed-type',
    ]);
    expect(kinds({ const: [1, 2] }, { type: 'array', maxItems: 1 })).toEqual(['narrowed-type']);
    expect(kinds({ const: [1] }, { type: 'array', minItems: 2 })).toEqual(['narrowed-type']);
    expect(kinds({ const: ['a'] }, { type: 'array', items: { type: 'number' } })).toEqual([
      'narrowed-type',
    ]);
    expect(
      kinds({ const: 'b' }, { anyOf: [{ type: 'string', pattern: '^a' }, { type: 'null' }] }),
    ).toEqual(['narrowed-type']);
    // Literals the new schema still accepts are not reported.
    expect(kinds({ enum: [2, 4] }, { type: 'integer', minimum: 2, multipleOf: 2 })).toEqual([]);
    expect(
      kinds(
        { const: { a: 1, b: [true] } },
        {
          type: 'object',
          required: ['a'],
          minProperties: 1,
          maxProperties: 2,
          properties: { a: { type: 'integer', maximum: 1 } },
          patternProperties: {
            '^b$': { type: 'array', minItems: 1, maxItems: 1, uniqueItems: true, items: true },
          },
          additionalProperties: false,
        },
      ),
    ).toEqual([]);
    expect(kinds({ const: { b: 1, a: 2 } }, { enum: [{ a: 2, b: 1 }] })).toEqual([]);
    expect(kinds({ const: 'x' }, { anyOf: [{ type: 'number' }, { type: 'string' }] })).toEqual([]);
  });

  it('counts string lengths in code points and survives patterns that do not compile', () => {
    expect(kinds({ enum: ['\u{1F600}\u{1F600}'] }, { type: 'string', maxLength: 2 })).toEqual([]);
    expect(kinds({ enum: ['\u{1F600}'] }, { type: 'string', minLength: 2 })).toEqual([
      'narrowed-type',
    ]);
    expect(kinds({ enum: ['a'] }, { type: 'string', pattern: '\\p{Foo' })).toEqual([
      'unmodelled-keyword',
    ]);
    expect(
      kinds({ const: { a: 1 } }, { type: 'object', patternProperties: { '\\p{Foo': {} } }),
    ).toEqual(['unmodelled-keyword']);
  });

  it('reports a literal it cannot evaluate against an unmodelled keyword', () => {
    const changes = diffSchema(
      'x.schema.json',
      { const: { a: 1 } },
      { type: 'object', properties: { a: { not: { type: 'string' } } } },
    );
    expect(changes.map((change) => change.kind)).toEqual(['unmodelled-keyword']);
    expect(changes[0]?.detail).toContain('{"a":1}');
    expect(kinds({ const: 1 }, true)).toEqual([]);
    expect(kinds({ const: [1] }, { type: 'array', items: [{}] })).toEqual(['unmodelled-keyword']);
  });

  it('reads a false subschema as rejecting everything', () => {
    expect(kinds({}, false)).toEqual(['narrowed-type']);
    expect(kinds(true, false)).toEqual(['narrowed-type']);
    expect(kinds(false, {})).toEqual([]);
    expect(kinds(false, false)).toEqual([]);
    expect(kinds({ type: 'array', items: {} }, { type: 'array', items: false })).toEqual([
      'narrowed-type',
    ]);
    expect(kinds({ type: 'array' }, { type: 'array', items: false })).toEqual(['narrowed-type']);
    expect(kinds({ type: 'array' }, { type: 'array', items: true })).toEqual([]);
    expect(kinds({ type: 'array', items: false }, { type: 'array', items: {} })).toEqual([]);
    expect(
      kinds(
        { type: 'object', properties: { a: {} } },
        { type: 'object', properties: { a: false } },
      ),
    ).toEqual(['narrowed-type']);
    expect(
      kinds(
        { type: 'object', properties: { a: false } },
        { type: 'object', properties: { a: {} } },
      ),
    ).toEqual([]);
    expect(kinds({ type: 'object' }, { type: 'object', properties: { a: false } })).toEqual([
      'narrowed-type',
    ]);
    expect(
      kinds(
        { type: 'object', patternProperties: { '^x': {} } },
        { type: 'object', patternProperties: { '^x': false } },
      ),
    ).toEqual(['narrowed-type']);
    expect(
      kinds(
        { type: 'object', patternProperties: { '^x': false } },
        { type: 'object', patternProperties: { '^x': { type: 'string' } } },
      ),
    ).toEqual([]);
    expect(kinds({ anyOf: [{ type: 'string' }, false] }, { type: 'string' })).toEqual([]);
    expect(kinds({ type: 'string' }, { anyOf: [false, { type: 'number' }] })).toEqual([
      'removed-variant',
    ]);
    expect(kinds({ const: 1 }, false)).toEqual(['narrowed-type']);
    const sets = diffSchemaSets(
      new Map([['a.schema.json', {}]]),
      new Map([['a.schema.json', false]]),
    );
    expect(sets.map((change) => change.kind)).toEqual(['narrowed-type']);
  });
});
