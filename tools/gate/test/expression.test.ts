import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type EvaluationContext,
  evaluateExpression,
  lookupMetric,
  metricReferences,
  parseExpression,
} from '../src/index.js';

const context: EvaluationContext = {
  exitCode: 0,
  durationMs: 1234,
  metrics: {
    tests: 42,
    coverage: 91.5,
    ok: true,
    name: "it's",
    none: null,
    nested: { list: [10, 20, { deep: 'x' }] },
    items: [1, 2],
  },
};

function run(source: string, ctx: EvaluationContext = context) {
  const parsed = parseExpression(source);
  if (!parsed.ok) {
    throw new Error(`parse failed: ${parsed.error.message}`);
  }
  return evaluateExpression(parsed.value, ctx);
}

function parseError(source: string): string {
  const parsed = parseExpression(source);
  return parsed.ok ? '' : `${parsed.error.message} @${String(parsed.error.position)}`;
}

describe('parseExpression', () => {
  it.each([
    ['', /unexpected end of expression/],
    ['exitCode ==', /unexpected end of expression/],
    ['foo == 1', /unknown name 'foo'/],
    ['metrics', /'metrics' needs a path/],
    ['metrics. == 1', /expected a metric name after '.'/],
    ['metrics.a < 1 < 2', /comparisons do not chain/],
    ['(exitCode == 0', /expected '\)' but found end of expression/],
    ['exitCode == 0)', /unexpected '\)'/],
    ['exitCode == 0 exitCode', /unexpected 'exitCode'/],
    ["metrics.a == 'open", /unterminated string/],
    ["metrics.a == 'a\\qb'", /unknown escape \\q/],
    ['exitCode == 0 # comment', /unexpected character '#'/],
    ['exitCode = 0', /unexpected character '='/],
    ['== 1', /unexpected '=='/],
    ['metrics.a == "x" x', /unexpected 'x'/],
    ['metrics.a == \'x\' "y"', /unexpected string 'y'/],
  ])('rejects %j', (source, message) => {
    expect(parseError(source)).toMatch(message);
  });

  it('reports the column of the problem', () => {
    expect(parseError('exitCode == 0 && bogus')).toMatch(/@17$/);
  });

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (source) => {
        const parsed = parseExpression(source);
        expect(typeof parsed.ok).toBe('boolean');
      }),
      { numRuns: 500 },
    );
  });

  it('lists metric references once each', () => {
    const parsed = parseExpression(
      'metrics.a > 1 && (metrics.b.c == 2 || !(metrics.a < 5)) && exitCode == 0',
    );
    expect(parsed.ok && metricReferences(parsed.value)).toEqual(['a', 'b.c']);
  });
});

describe('evaluateExpression', () => {
  it.each([
    ['exitCode == 0', true],
    ['exitCode != 0', false],
    ['durationMs < 2000', true],
    ['durationMs >= 1234 && durationMs <= 1234', true],
    ['metrics.tests >= 42', true],
    ['metrics.tests > 42', false],
    ['metrics.coverage >= 85', true],
    ['metrics.ok == true', true],
    ['metrics.ok', true],
    ['!metrics.ok', false],
    ['!!metrics.ok', true],
    ['metrics.none == null', true],
    ["metrics.name == 'it\\'s'", true],
    ['metrics.name == "it\'s"', true],
    ['metrics.name < "z"', true],
    ['metrics.nested.list.1 == 20', true],
    ['metrics.nested.list.2.deep == "x"', true],
    ['metrics.tests == "42"', false],
    ['metrics.tests != "42"', true],
    ['-1 < exitCode', true],
    ['1.5e1 == 15', true],
    ['false || true && false', false],
    ['true || false && false', true],
    ['(true || false) && false', false],
    ['!metrics.tests == 42', false],
    ['metrics.tests == 42 && metrics.coverage > 90 || false', true],
    ["'\\n\\t\\r\\\\' != ''", true],
  ])('%s is %s', (source, expected) => {
    const evaluation = run(source);
    expect(evaluation).toEqual({ pass: expected, missingMetrics: [], errors: [] });
  });

  it('makes a missing metric fail the expression and reports it, even past a short circuit', () => {
    expect(run('metrics.absent == 1')).toEqual({
      pass: false,
      missingMetrics: ['absent'],
      errors: [],
    });
    expect(run('true || metrics.absent == 1')).toEqual({
      pass: false,
      missingMetrics: ['absent'],
      errors: [],
    });
    expect(run('!(metrics.nested.list.9 == 1)').missingMetrics).toEqual(['nested.list.9']);
    expect(run('metrics.tests.inner == 1').missingMetrics).toEqual(['tests.inner']);
    expect(run('metrics.items.x == 1').missingMetrics).toEqual(['items.x']);
    expect(
      run('metrics.a == 1', { exitCode: 0, durationMs: 0, metrics: null }).missingMetrics,
    ).toEqual(['a']);
  });

  it.each([
    ['metrics.name > 1', /needs two numbers or two strings, got string "it's" and number 1/],
    ['metrics.nested == 1', /cannot compare object/],
    ['metrics.items == 1', /cannot compare array/],
    ['metrics.tests && true', /'&&' needs booleans, got number 42/],
    ['metrics.none || true', /'\|\|' needs booleans, got null/],
    ['!metrics.tests', /'!' needs booleans/],
    ['metrics.tests', /yields number 42, not a boolean/],
    ['exitCode', /yields number 0, not a boolean/],
    ['metrics.ok >= false', /needs two numbers or two strings/],
  ])('reports a type error for %s', (source, message) => {
    const evaluation = run(source);
    expect(evaluation.pass).toBe(false);
    expect(evaluation.errors.join(' ')).toMatch(message);
  });

  it('treats a null exit code (timeout or signal) as not zero', () => {
    expect(run('exitCode == 0', { exitCode: null, durationMs: 0, metrics: {} }).pass).toBe(false);
    expect(run('exitCode == null', { exitCode: null, durationMs: 0, metrics: {} }).pass).toBe(true);
  });

  it('compares numbers exactly as JavaScript does', () => {
    const operators = ['==', '!=', '<', '<=', '>', '>='] as const;
    const reference: Record<(typeof operators)[number], (a: number, b: number) => boolean> = {
      '==': (a, b) => a === b,
      '!=': (a, b) => a !== b,
      '<': (a, b) => a < b,
      '<=': (a, b) => a <= b,
      '>': (a, b) => a > b,
      '>=': (a, b) => a >= b,
    };
    fc.assert(
      fc.property(fc.integer(), fc.integer(), fc.constantFrom(...operators), (a, b, operator) => {
        const evaluation = run(`metrics.a ${operator} metrics.b`, {
          exitCode: 0,
          durationMs: 0,
          metrics: { a, b },
        });
        expect(evaluation.pass).toBe(reference[operator](a, b));
      }),
      { numRuns: 500 },
    );
  });
});

describe('lookupMetric', () => {
  it('walks objects and arrays and stops at anything else', () => {
    expect(lookupMetric({ a: { b: [5] } }, ['a', 'b', '0'])).toBe(5);
    expect(lookupMetric({ a: 1 }, ['a', 'b'])).toBeUndefined();
    expect(lookupMetric({ a: 1 }, ['toString'])).toBeUndefined();
    expect(lookupMetric([1], ['length'])).toBeUndefined();
  });
});
