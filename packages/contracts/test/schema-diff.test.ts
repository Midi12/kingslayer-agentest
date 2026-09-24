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
