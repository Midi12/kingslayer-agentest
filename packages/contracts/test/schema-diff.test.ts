import { describe, expect, it } from 'vitest';
import { diffSchema, diffSchemaSets } from '../src/index.js';

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
