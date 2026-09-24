/**
 * validate() counts string lengths in code points and matches patterns per code point, as
 * JSON Schema 2020-12 (and Ajv, used by the API) does, including for astral characters.
 */
import { Type, type TSchema } from '@sinclair/typebox';
import { Ajv2020 } from 'ajv/dist/2020.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CONTRACT_KEYWORDS, exportJsonSchema, validate, validateAgainst } from '../src/index.js';
import { inCodePoints } from '../src/core/validate.js';

const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, strictTypes: false });
for (const keyword of CONTRACT_KEYWORDS) ajv.addKeyword(keyword);
const ajvTarget = ajv.compile(exportJsonSchema('Target'));

const emoji = String.fromCodePoint(0x1f600);
/** Strings mixing ASCII, BMP, private-use and astral characters. */
const text = (maxLength: number) =>
  fc
    .array(
      fc.oneof(
        fc.constantFrom('a', ' ', 'é', '', '', emoji, String.fromCodePoint(0x1f680)),
        fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }),
      ),
      { maxLength },
    )
    .map((parts) => parts.join(''));

function agreesWithAjv(schema: TSchema, value: unknown): boolean {
  const check = ajv.compile(JSON.parse(JSON.stringify(schema)) as object);
  return check(value) === validateAgainst(schema, value).ok;
}

describe('validate() counts code points like JSON Schema', () => {
  it('accepts 300 astral characters where the limit is 500 code points', () => {
    const target = { description: emoji.repeat(300) };
    expect(ajvTarget(target)).toBe(true);
    expect(validate('Target', target).ok).toBe(true);
    const tooLong = { description: emoji.repeat(501) };
    expect(ajvTarget(tooLong)).toBe(false);
    expect(validate('Target', tooLong).ok).toBe(false);
    const role = { description: 'Start button of C12', hints: { role: emoji.repeat(40) } };
    expect(ajvTarget(role)).toBe(true);
    expect(validate('Target', role).ok).toBe(true);
  });

  it('agrees with Ajv 2020 on Target descriptions and hints of any length', () => {
    fc.assert(
      fc.property(text(520), text(70), (description, role) => {
        const target = { description, hints: { role } };
        expect(validate('Target', target).ok).toBe(ajvTarget(target));
      }),
      { numRuns: 300 },
    );
  });

  it('agrees with Ajv 2020 on minLength, bounded patterns and uniqueness', () => {
    const schemas: TSchema[] = [
      Type.String({ minLength: 2, maxLength: 3 }),
      Type.String({ pattern: '^.{1,3}$' }),
      Type.String({ pattern: '^[^/]{2}$' }),
      Type.Array(Type.String(), { uniqueItems: true }),
      Type.Object({ a: Type.String({ maxLength: 1 }) }, { additionalProperties: false }),
    ];
    fc.assert(
      fc.property(fc.array(text(4), { minLength: 1, maxLength: 4 }), (values) => {
        const [first = ''] = values;
        for (const schema of schemas) {
          const value =
            schema.type === 'array' ? values : schema.type === 'object' ? { a: first } : first;
          expect(agreesWithAjv(schema, value)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('maps astral characters injectively and leaves other values untouched', () => {
    const plain = { a: ['x', 1, null, true] };
    expect(inCodePoints(plain)).toBe(plain);
    const mapped = inCodePoints({ [emoji]: [emoji, '', String.fromCodePoint(0x1f680)] });
    expect(mapped).toEqual({ [emoji]: ['', '', ''] });
    const crowded = Array.from({ length: 6401 }, (_, index) =>
      String.fromCodePoint(0x10000 + index),
    );
    expect(inCodePoints(crowded)).toBe(crowded);
    const lone = '\uD800x';
    expect(inCodePoints(lone)).toBe(lone);
  });
});
