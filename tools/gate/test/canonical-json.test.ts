import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CanonicalizationError, canonicalHash, canonicalize } from '../src/index.js';

const vectors = join(import.meta.dirname, '__golden__', 'jcs');
const names = readdirSync(vectors)
  .filter((file) => file.endsWith('.input.json'))
  .map((file) => file.replace('.input.json', ''))
  .sort();

function shuffleKeys(value: unknown, seed: number): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => shuffleKeys(item, seed + index));
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(
      (a, b) =>
        ((a[0].length * 31 + seed) % 7) - ((b[0].length * 31 + seed) % 7) ||
        (seed % 2 === 0 ? 1 : -1),
    );
    return Object.fromEntries(entries.map(([key, item]) => [key, shuffleKeys(item, seed + 1)]));
  }
  return value;
}

describe('canonicalize (RFC 8785)', () => {
  it('has test vectors', () => {
    expect(names).toEqual(['nested', 'numbers', 'rfc8785-sorting', 'rfc8785-values']);
  });

  it.each(names)('matches the %s vector', (name) => {
    const input: unknown = JSON.parse(readFileSync(join(vectors, `${name}.input.json`), 'utf8'));
    const expected = readFileSync(join(vectors, `${name}.expected.txt`), 'utf8');
    expect(canonicalize(input)).toBe(expected);
  });

  it('omits undefined members, as JSON.stringify does', () => {
    expect(canonicalize({ b: undefined, a: 1 })).toBe('{"a":1}');
    expect(canonicalize(Object.assign(Object.create(null) as object, { x: true }))).toBe(
      '{"x":true}',
    );
  });

  it.each([
    ['NaN', Number.NaN, /non-finite number at \$/],
    ['Infinity', { a: [Infinity] }, /non-finite number at \$\.a\[0\]/],
    ['a lone high surrogate', '\ud800x', /lone surrogate/],
    ['a lone low surrogate key', { '\udc00': 1 }, /lone surrogate/],
    ['a Date', new Date(0), /unsupported object/],
    ['a Map', new Map(), /unsupported object/],
    ['undefined in an array', [undefined], /unsupported undefined/],
    ['a function', () => 1, /unsupported function/],
    ['a bigint', 1n, /unsupported bigint/],
  ])('rejects %s', (_name, value, message) => {
    expect(() => canonicalize(value)).toThrow(CanonicalizationError);
    expect(() => canonicalize(value)).toThrow(message);
  });

  it('is idempotent and independent of key order and whitespace', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.nat(1000), (value, seed) => {
        const canonical = canonicalize(value);
        expect(canonicalize(JSON.parse(canonical))).toBe(canonical);
        expect(canonicalize(shuffleKeys(value, seed))).toBe(canonical);
        expect(canonicalize(JSON.parse(JSON.stringify(value, null, 3)))).toBe(canonical);
      }),
      { numRuns: 300 },
    );
  });

  it('hashes the canonical form with SHA-256', () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
    expect(canonicalHash('')).toBe(
      'sha256:12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126',
    );
    expect(canonicalHash({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
