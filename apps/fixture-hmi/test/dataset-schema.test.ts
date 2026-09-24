import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { BreakTask, GroundingTask, parseJsonl, toJsonl } from '../src/core/dataset-schema.js';

describe('parseJsonl / toJsonl', () => {
  it('round-trips a list of objects, ignoring blank lines', () => {
    const rows = [{ a: 1 }, { b: 2 }];
    const text = toJsonl(rows);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseJsonl(`\n${text}\n`)).toEqual(rows);
  });
});

const validGrounding = {
  id: 'g-example',
  page: '/conveyors',
  faults: [],
  seed: 1,
  locale: 'en',
  target: { description: 'The Start button for conveyor C01' },
  action: 'click',
  answer: 'start-c01',
};

describe('GroundingTask schema', () => {
  it('accepts a valid task', () => {
    expect(Value.Check(GroundingTask, validGrounding)).toBe(true);
  });

  it('rejects an unknown page, action or fault', () => {
    expect(Value.Check(GroundingTask, { ...validGrounding, page: '/nope' })).toBe(false);
    expect(Value.Check(GroundingTask, { ...validGrounding, action: 'teleport' })).toBe(false);
    expect(Value.Check(GroundingTask, { ...validGrounding, faults: ['not-a-fault'] })).toBe(false);
  });

  it('rejects an additional property', () => {
    expect(Value.Check(GroundingTask, { ...validGrounding, extra: true })).toBe(false);
  });
});

const validBreak = {
  id: 'b-example',
  faults: [],
  page: '/conveyors',
  step: { id: 'step-1', intent: 'x', action: { type: 'wait' } },
  expected: 'continue',
};

describe('BreakTask schema', () => {
  it('accepts a valid task', () => {
    expect(Value.Check(BreakTask, validBreak)).toBe(true);
  });

  it('accepts every declared break reason and rejects a made-up one', () => {
    expect(Value.Check(BreakTask, { ...validBreak, expected: 'TARGET_NOT_FOUND' })).toBe(true);
    expect(Value.Check(BreakTask, { ...validBreak, expected: 'NOT_A_REASON' })).toBe(false);
  });
});
