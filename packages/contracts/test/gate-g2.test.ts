/**
 * M01-G2: the canonical form is stable. For 1,000 generated scripts, parsing the RFC 8785
 * serialisation gives the script back, and the content hash ignores key order and
 * whitespace. The RFC 8785 test vectors (key sorting, string escapes, number
 * serialisation) are checked too.
 */
import { recordGateMetrics } from '@argus/testkit';
import fc from 'fast-check';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { CanonicalizationError, canonicalize, contentHash, validate } from '../src/index.js';
import { testScript } from './support/arbitraries.js';

const RUNS = 1000;
const stats = { runs: 0, roundTripFailures: 0, hashMismatches: 0, invalidGenerated: 0 };

/** A deep copy with every object's members in a pseudo-random order. */
function reorder(value: unknown, seed: number): unknown {
  let state = seed >>> 0 || 1;
  const next = () => {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    return state;
  };
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (typeof node === 'object' && node !== null) {
      const keys = Object.keys(node);
      for (let i = keys.length - 1; i > 0; i--) {
        const j = next() % (i + 1);
        [keys[i], keys[j]] = [keys[j] ?? '', keys[i] ?? ''];
      }
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        Object.defineProperty(out, key, {
          value: visit((node as Record<string, unknown>)[key]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    return node;
  };
  return visit(value);
}

describe('M01-G2 canonical form of generated scripts', () => {
  it(`round-trips and hashes ${RUNS} generated scripts stably`, () => {
    fc.assert(
      fc.property(
        testScript,
        fc.integer(),
        fc.constantFrom<string | number>(0, 2, '\t', 7, ' \n'),
        (script, seed, indent) => {
          stats.runs++;
          const valid = validate('TestScript', script).ok;
          if (!valid) stats.invalidGenerated++;
          const canonical = canonicalize(script);
          const parsed: unknown = JSON.parse(canonical);
          const roundTrips =
            isDeepStrictEqual(parsed, script) && canonicalize(parsed) === canonical;
          if (!roundTrips) stats.roundTripFailures++;
          const shuffledText = JSON.stringify(reorder(script, seed), null, indent);
          const reparsed: unknown = JSON.parse(shuffledText);
          const sameHash =
            contentHash(reparsed) === contentHash(script) && canonicalize(reparsed) === canonical;
          if (!sameHash) stats.hashMismatches++;
          expect(valid).toBe(true);
          expect(parsed).toStrictEqual(script);
          expect(roundTrips).toBe(true);
          expect(sameHash).toBe(true);
        },
      ),
      { numRuns: RUNS, seed: 20260921 },
    );
  });
});

/** IEEE 754 bit patterns and their RFC 8785 serialisation (RFC 8785, appendix B). */
const NUMBER_VECTORS: readonly [string, string][] = [
  ['0000000000000000', '0'],
  ['8000000000000000', '0'],
  ['0000000000000001', '5e-324'],
  ['8000000000000001', '-5e-324'],
  ['7fefffffffffffff', '1.7976931348623157e+308'],
  ['ffefffffffffffff', '-1.7976931348623157e+308'],
  ['4340000000000000', '9007199254740992'],
  ['c340000000000000', '-9007199254740992'],
  ['4430000000000000', '295147905179352830000'],
  ['44b52d02c7e14af5', '9.999999999999997e+22'],
  ['44b52d02c7e14af6', '1e+23'],
  ['44b52d02c7e14af7', '1.0000000000000001e+23'],
  ['444b1ae4d6e2ef4e', '999999999999999700000'],
  ['444b1ae4d6e2ef4f', '999999999999999900000'],
  ['444b1ae4d6e2ef50', '1e+21'],
  ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
  ['3eb0c6f7a0b5ed8d', '0.000001'],
  ['41b3de4355555553', '333333333.3333332'],
  ['41b3de4355555554', '333333333.33333325'],
  ['41b3de4355555555', '333333333.3333333'],
  ['41b3de4355555556', '333333333.3333334'],
  ['41b3de4355555557', '333333333.33333343'],
  ['becbf647612f3696', '-0.0000033333333333333333'],
  ['43143ff3c1cb0959', '1424953923781206.2'],
];

function fromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

/** Documents and their canonical form (RFC 8785, sections 3.2.2, 3.2.3 and 3.2.4). */
const DOCUMENT_VECTORS: readonly [string, unknown, string][] = [
  [
    'section 3.2.2 example',
    JSON.parse(
      '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001], "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/", "literals": [null, true, false]}',
    ),
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  ],
  [
    'section 3.2.3 sorting by UTF-16 code units',
    JSON.parse(
      '{"\\u20ac": "Euro Sign", "\\r": "Carriage Return", "\\ufb33": "Hebrew Letter Dalet With Dagesh", "1": "One", "\\ud83d\\ude00": "Emoji: Grinning Face", "\\u0080": "Control", "\\u00f6": "Latin Small Letter O With Diaeresis"}',
    ),
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
  ],
  [
    'nested members sorted at every level',
    { b: [{ z: 1, a: 2 }], a: { d: true, c: null } },
    '{"a":{"c":null,"d":true},"b":[{"a":2,"z":1}]}',
  ],
  [
    'control characters',
    { s: '\u0000\u0008\u0009\u000a\u000c\u000d\u001f\u007f' },
    '{"s":"\\u0000\\b\\t\\n\\f\\r\\u001f\u007f"}',
  ],
];

const REJECTED: readonly [string, unknown][] = [
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity in an array', [1, Number.NEGATIVE_INFINITY]],
  ['undefined', undefined],
  ['undefined member', { a: undefined }],
  ['lone high surrogate', '\ud800'],
  ['lone low surrogate as a key', { '\udc00': 1 }],
];

let jcsVectors = 0;
let jcsVectorFailures = 0;

describe('M01-G2 RFC 8785 vectors', () => {
  it.each(NUMBER_VECTORS)('number %s serialises as %s', (hex, expected) => {
    jcsVectors++;
    const actual = canonicalize(fromBits(hex));
    if (actual !== expected) jcsVectorFailures++;
    expect(actual).toBe(expected);
  });

  it.each(DOCUMENT_VECTORS)('%s', (_name, document, expected) => {
    jcsVectors++;
    const actual = canonicalize(document);
    if (actual !== expected) jcsVectorFailures++;
    expect(actual).toBe(expected);
  });

  it.each(REJECTED)('rejects %s', (_name, value) => {
    jcsVectors++;
    let rejected = false;
    try {
      canonicalize(value);
    } catch (error) {
      rejected = error instanceof CanonicalizationError;
    }
    if (!rejected) jcsVectorFailures++;
    expect(rejected).toBe(true);
  });
});

afterAll(() => {
  recordGateMetrics({ ...stats, jcsVectors, jcsVectorFailures });
});
