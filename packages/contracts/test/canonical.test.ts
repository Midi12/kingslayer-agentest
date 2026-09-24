import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CanonicalizationError,
  canonicalize,
  contentHash,
  hashBytes,
  sha256Hex,
  utf8,
} from '../src/index.js';

function sparseArray(): unknown[] {
  const array: unknown[] = [1];
  array[2] = 3;
  return array;
}

describe('canonicalize', () => {
  it('serialises scalars', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize(-0)).toBe('0');
    expect(canonicalize(1e21)).toBe('1e+21');
    expect(canonicalize('é ')).toBe('"é "');
  });

  it('accepts objects without a prototype', () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.b = 1;
    value.a = [];
    expect(canonicalize(value)).toBe('{"a":[],"b":1}');
  });

  it('rejects values outside JSON with the path of the value', () => {
    const cases: [unknown, string][] = [
      [{ a: [1, { b: Number.NaN }] }, '/a/1/b'],
      [{ 'x/y~z': undefined }, '/x~1y~0z'],
      [sparseArray(), '/1'],
      [{ d: new Date(0) }, '/d'],
      [{ f: () => 1 }, '/f'],
      [{ s: Symbol('s') }, '/s'],
      [{ n: 1n }, '/n'],
      [{ [Symbol('k')]: 1 }, ''],
      [new Map(), ''],
    ];
    for (const [value, path] of cases) {
      let caught: unknown;
      try {
        canonicalize(value);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CanonicalizationError);
      expect((caught as CanonicalizationError).path).toBe(path);
    }
    expect(() => canonicalize(undefined)).toThrow('undefined is not JSON at (root)');
  });

  it('agrees with JSON.parse for arbitrary JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const normalised = JSON.parse(JSON.stringify(value)) as unknown;
        const text = canonicalize(normalised);
        expect(canonicalize(JSON.parse(text))).toBe(text);
      }),
      { numRuns: 300, seed: 7 },
    );
  });
});

describe('hashes', () => {
  it('contentHash is sha256 of the canonical UTF-8 bytes', () => {
    const value = { b: 'ü', a: [1, 2.5] };
    const expected = createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
    expect(contentHash(value)).toBe(`sha256:${expected}`);
    expect(contentHash({ a: [1, 2.5], b: 'ü' })).toBe(contentHash(value));
  });

  it('hashBytes hashes text and bytes alike', () => {
    expect(hashBytes('abc')).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashBytes(utf8('abc'))).toBe(hashBytes('abc'));
    expect(hashBytes('')).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('sha256Hex matches node:crypto for every length around the block boundaries', () => {
    for (let length = 0; length < 200; length++) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 31 + length) & 0xff);
      expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });

  it('sha256Hex matches node:crypto on random data', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 3000 }), (bytes) => {
        expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
      }),
      { numRuns: 200, seed: 11 },
    );
  });
});
