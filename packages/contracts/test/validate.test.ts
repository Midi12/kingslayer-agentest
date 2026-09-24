import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { conforms, explain, validate, validateAgainst } from '../src/index.js';
import { GOLDEN_DIR, readJson } from './support/goldens.js';

const c12 = readJson(`${GOLDEN_DIR}/valid/TestScript/conveyor-start-and-jam.json`) as Record<
  string,
  unknown
>;

/** A copy of the C12 script with the value at a JSON Pointer replaced. */
function withValue(pointer: string, value: unknown): unknown {
  const doc = structuredClone(c12);
  const segments = pointer.split('/').slice(1);
  const last = segments.pop() ?? '';
  let node: unknown = doc;
  for (const segment of segments) node = (node as Record<string, unknown>)[segment];
  (node as Record<string, unknown>)[last] = value;
  return doc;
}

describe('validate', () => {
  it('returns the value on success and a type guard', () => {
    const result = validate('TestScript', c12);
    expect(result.ok).toBe(true);
    expect(conforms('TestScript', c12)).toBe(true);
    expect(conforms('TestScript', {})).toBe(false);
  });

  it('reports inside the variant a discriminator selects', () => {
    const result = validate('TestScript', withValue('/steps/2/expect/0/value', 5));
    expect(result.ok ? [] : result.error[0]).toEqual({
      path: '/steps/2/expect/0/value',
      message: 'Expected string',
    });
  });

  it('reports a missing or unknown discriminator at the tag', () => {
    const missing = validate('Action', { target: { description: 'Start button of C12' } });
    expect(missing.ok ? [] : missing.error).toEqual([
      { path: '/type', message: 'Expected required property' },
    ]);
    const unknown = validate('Action', { type: 3 });
    expect(unknown.ok ? '' : unknown.error[0]?.message).toContain('Expected one of "navigate"');
  });

  it('reports the kind when no union variant takes the value', () => {
    const result = validate('GroundResult', {
      pick: ['c1'],
      confidence: 0.5,
      probabilities: {},
      targetPresent: 0.5,
      model: 'jev-1.13.0',
      usage: { inputTokens: 1 },
      latencyMs: 1,
      cacheHit: false,
    });
    expect(result.ok ? [] : result.error[0]).toEqual({
      path: '/pick',
      message: 'Expected string or null',
    });
  });

  it('picks the closest variant of an undiscriminated union', () => {
    const result = validate('Step', { id: 's1', use: 'login-operator', within: '5s' });
    expect(result.ok ? [] : result.error.map((e) => e.path)).toEqual(['/within']);
    const deeper = validate('Step', {
      id: 's1',
      intent: 'x',
      action: { type: 'click', target: { description: 7 } },
    });
    expect(deeper.ok ? [] : deeper.error[0]?.path).toBe('/action/target/description');
  });

  it('reports non-object values of a discriminated union at the union', () => {
    const result = validate('Expectation', 'noul');
    expect(result.ok ? [] : result.error[0]?.path).toBe('');
  });

  it('validates any TypeBox schema with the same reporting', () => {
    const schema = Type.Object({ a: Type.Union([Type.Literal('x'), Type.Literal('y')]) });
    expect(validateAgainst(schema, { a: 'x' })).toEqual({ ok: true, value: { a: 'x' } });
    const result = validateAgainst(schema, { a: 'z' });
    expect(result.ok ? [] : result.error).toEqual([
      { path: '/a', message: 'Expected one of "x", "y"' },
    ]);
  });

  it('keeps one error per location', () => {
    const errors = explain([]);
    expect(errors).toEqual([]);
    const result = validate('Target', {});
    expect(result.ok ? [] : result.error).toEqual([
      { path: '/description', message: 'Expected required property' },
    ]);
  });

  it('falls back to the union error when no variant yields detail', () => {
    const schema = Type.Union([Type.Object({ a: Type.String() }), Type.Array(Type.String())]);
    const result = validateAgainst(schema, 5);
    expect(result.ok ? [] : result.error[0]?.path).toBe('');
    const nested = validateAgainst(Type.Union([Type.Unknown(), Type.String()], {}), 1);
    expect(nested.ok).toBe(true);
  });
});
