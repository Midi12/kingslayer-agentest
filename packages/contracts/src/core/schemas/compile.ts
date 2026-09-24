/**
 * Compiler contracts: request, result, lint findings and clarifications
 * (Architecture and contracts, "Analyst and Compiler ports" and "Lint rules").
 */
import { Type, type Static } from '@sinclair/typebox';
import { AI_PROVIDER_KINDS, LINT_CODES, LINT_SEVERITIES, USAGE_OPERATIONS } from '../enums.js';
import {
  HOST_PATTERN,
  Identifier,
  LOCALE_PATTERN,
  NonEmptyText,
  NonNegativeInteger,
  ORIGIN_PATTERN,
  Slug,
  StepId,
  TIMEZONE_PATTERN,
  closedObject,
  literalUnion,
} from './common.js';
import { Fragment, Policy, TestScript, Viewport } from './script.js';

export const LintFinding = closedObject({
  code: literalUnion(LINT_CODES),
  stepId: Type.Union([StepId, Type.Null()], {
    description: 'Step or handler the finding is about; null for the whole script',
  }),
  path: Type.String({ pattern: '^(/[^/]*)*$', description: 'JSON Pointer into the script' }),
  message: NonEmptyText(1000),
  severity: literalUnion(LINT_SEVERITIES),
});
export type LintFinding = Static<typeof LintFinding>;

export const Clarification = closedObject({
  id: Type.String({ pattern: '^q[0-9]{1,3}$' }),
  question: NonEmptyText(1000),
  stepId: Type.Union([StepId, Type.Null()]),
  sourceExcerpt: Type.Optional(NonEmptyText(1000)),
  options: Type.Optional(Type.Array(NonEmptyText(300), { maxItems: 10 })),
});
export type Clarification = Static<typeof Clarification>;

/**
 * Usage block of every brain response and of `CompileResult`: which billable operation
 * the call counts as (null when the step rate already covers it) and the tokens spent.
 */
export const BrainUsage = closedObject({
  provider: literalUnion(AI_PROVIDER_KINDS),
  model: Type.Union([NonEmptyText(128), Type.Null()]),
  calls: NonNegativeInteger,
  inputTokens: NonNegativeInteger,
  outputTokens: NonNegativeInteger,
  billable: Type.Union([
    closedObject({
      operation: literalUnion(USAGE_OPERATIONS),
      quantity: Type.Number({ exclusiveMinimum: 0 }),
    }),
    Type.Null(),
  ]),
});
export type BrainUsage = Static<typeof BrainUsage>;

export const CompileEnvironment = closedObject({
  baseUrl: NonEmptyText(2048),
  allowedOrigins: Type.Array(Type.String({ pattern: ORIGIN_PATTERN }), { uniqueItems: true }),
  allowedHttpHosts: Type.Array(Type.String({ pattern: HOST_PATTERN }), { uniqueItems: true }),
  viewport: Type.Optional(Viewport),
  locale: Type.Optional(Type.String({ pattern: LOCALE_PATTERN })),
  timezone: Type.Optional(Type.String({ pattern: TIMEZONE_PATTERN })),
});

export const CompileRequest = closedObject({
  projectId: Type.Optional(Identifier),
  name: Slug,
  title: Type.Optional(NonEmptyText(200)),
  source: NonEmptyText(20_000, 'Plain-language test description'),
  glossary: Type.Optional(
    Type.Array(closedObject({ term: NonEmptyText(100), meaning: NonEmptyText(500) }), {
      maxItems: 500,
    }),
  ),
  fragments: Type.Optional(Type.Array(Fragment, { maxItems: 100 })),
  criticalVerbs: Type.Array(Type.String({ pattern: '^[a-z][a-z-]{0,39}$' }), {
    uniqueItems: true,
    maxItems: 100,
  }),
  environment: CompileEnvironment,
  policyDefaults: Type.Optional(Policy),
  runTimeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 86_400_000 })),
  previous: Type.Optional(TestScript),
});
export type CompileRequest = Static<typeof CompileRequest>;

export const CompileResult = closedObject({
  script: Type.Optional(TestScript),
  lint: Type.Array(LintFinding, { maxItems: 1000 }),
  clarifications: Type.Array(Clarification, { maxItems: 20 }),
  usage: BrainUsage,
});
export type CompileResult = Static<typeof CompileResult>;

// Static types of the building blocks above, for consumers that build or read them.
export type CompileEnvironment = Static<typeof CompileEnvironment>;
