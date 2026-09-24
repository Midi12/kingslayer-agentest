/**
 * TypeBox schemas for the two datasets (`grounding.jsonl`, `breaks.jsonl`). `step` inside
 * a break task is validated separately against `@argus/contracts`' `Step` schema, so this
 * file does not duplicate the script contract.
 */
import { Type, type Static } from '@sinclair/typebox';
import { FAULT_NAMES } from './types.js';

export const PAGES = [
  '/login',
  '/conveyors',
  '/synoptic/svg',
  '/synoptic/canvas',
  '/alarms',
  '/trends',
  '/settings',
  '/modal',
] as const;
export type Page = (typeof PAGES)[number];

export const GROUNDING_ACTIONS = ['click', 'read', 'type', 'hover', 'check'] as const;
export type GroundingAction = (typeof GROUNDING_ACTIONS)[number];

const FaultNameLiteral = Type.Union(FAULT_NAMES.map((name) => Type.Literal(name)));

export const GroundingTarget = Type.Object(
  {
    description: Type.String({ minLength: 1, maxLength: 500 }),
    hints: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { additionalProperties: false },
);

export const GroundingTask = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$', minLength: 1, maxLength: 100 }),
    page: Type.Union(PAGES.map((page) => Type.Literal(page))),
    faults: Type.Array(FaultNameLiteral, { maxItems: FAULT_NAMES.length }),
    seed: Type.Integer({ minimum: 0 }),
    locale: Type.Union([Type.Literal('en'), Type.Literal('fr')]),
    target: GroundingTarget,
    action: Type.Union(GROUNDING_ACTIONS.map((action) => Type.Literal(action))),
    answer: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);
export type GroundingTask = Static<typeof GroundingTask>;

export const BREAK_EXPECTATIONS = [
  'continue',
  'TARGET_NOT_FOUND',
  'GROUNDING_AMBIGUOUS',
  'AUTH_LOST',
  'BLOCKING_MODAL',
  'UNEXPECTED_ERROR_UI',
  'ASSERTION_FAILED',
  'VISUAL_DIFF',
  'EXPECTATION_FAILED',
  'EXPECTATION_UNCERTAIN',
  'NO_EFFECT',
  'CONSOLE_OR_NETWORK_ERROR',
  'ACTION_ERROR',
  'TIMEOUT',
  'OFF_PATH',
  'OBSERVE_FAILED',
  'SETUP_FAILED',
  'BUDGET_EXHAUSTED',
  'RUNNER_LOST',
  'ANALYST_UNAVAILABLE',
  'ANALYST_INVALID',
  'NAVIGATOR_UNAVAILABLE',
] as const;
export type BreakExpectation = (typeof BREAK_EXPECTATIONS)[number];

export const BreakTask = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$', minLength: 1, maxLength: 100 }),
    faults: Type.Array(FaultNameLiteral, { maxItems: FAULT_NAMES.length }),
    page: Type.Union(PAGES.map((page) => Type.Literal(page))),
    step: Type.Unknown(),
    expected: Type.Union(BREAK_EXPECTATIONS.map((reason) => Type.Literal(reason))),
  },
  { additionalProperties: false },
);
export type BreakTask = Static<typeof BreakTask>;

export function parseJsonl(text: string): unknown[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

export function toJsonl(rows: readonly unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}
