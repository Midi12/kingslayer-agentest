/**
 * Contract: TestScript (Architecture and contracts, "Contract: TestScript").
 *
 * A TestScript is frozen, self-contained data: it names what to do and what must be true,
 * never how to find an element. JSON is canonical.
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import {
  A11Y_IMPACTS,
  A11Y_RULESETS,
  API_VERSION,
  ARTIFACT_POLICIES,
  COLOR_OPS,
  DEGRADE_POLICIES,
  DOM_STATE_OPS,
  DOM_TEXT_OPS,
  HEAL_APPROVALS,
  HTTP_METHODS,
  NUMBER_COMPARATORS,
  ON_BREAK_POLICIES,
  PALETTE,
  PII_MODES,
  POINTER_ACTION_TYPES,
  PROBE_NAMES,
  RISK_CLASSES,
  SCREENSHOT_SHARING,
  SCROLL_DIRECTIONS,
  URL_OPS,
} from '../enums.js';
import {
  Duration,
  LOCALE_PATTERN,
  NonEmptyText,
  NonNegativeInteger,
  ScalarValue,
  SecretName,
  Sha256,
  Slug,
  StepId,
  TIMEZONE_PATTERN,
  VariableName,
  closedObject,
  discriminatedUnion,
  literalUnion,
} from './common.js';

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

export const TargetHints = closedObject(
  {
    role: Type.Optional(NonEmptyText(64)),
    text: Type.Optional(NonEmptyText(200)),
    label: Type.Optional(NonEmptyText(200)),
    testId: Type.Optional(NonEmptyText(200)),
    near: Type.Optional(NonEmptyText(200)),
    region: Type.Optional(NonEmptyText(200)),
  },
  { description: 'Optional grounding hints; the description stays authoritative' },
);
export type TargetHints = Static<typeof TargetHints>;

const targetProperties = {
  description: NonEmptyText(500, 'Literal description of the element, used for grounding'),
  hints: Type.Optional(TargetHints),
  frame: Type.Optional(NonEmptyText(500, 'Name or URL fragment of the frame holding the element')),
};

export const Target = closedObject(
  {
    ...targetProperties,
    locator: Type.Optional(
      NonEmptyText(2000, 'Explicit Playwright locator; bypasses AI grounding'),
    ),
  },
  { description: 'A user-interface element named by what it is, not how to find it' },
);
export type Target = Static<typeof Target>;

/** The target of an Analyst patch action: no explicit locator, it is always grounded. */
export const PatchTarget = closedObject(targetProperties, {
  description: 'Patch targets are descriptions and pass through the grounding gate',
});
export type PatchTarget = Static<typeof PatchTarget>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Builds the action union for a target schema (script steps and Analyst patches). */
function actionUnion<T extends TSchema>(target: T) {
  const templatedText = (maxLength: number) => Type.String({ maxLength });
  const navigate = closedObject({
    type: Type.Literal('navigate'),
    url: NonEmptyText(2048, 'Relative URL, or absolute inside the origin allow-list'),
  });
  const pointer = closedObject({ type: literalUnion(POINTER_ACTION_TYPES), target });
  const fill = closedObject({
    type: Type.Literal('fill'),
    target,
    value: Type.String({
      maxLength: 10_000,
      description: 'Text to enter; secrets only as ${secret.NAME}',
    }),
  });
  const clear = closedObject({ type: Type.Literal('clear'), target });
  const select = closedObject({
    type: Type.Literal('select'),
    target,
    option: NonEmptyText(500, 'Visible label or value of the option to select'),
  });
  const press = closedObject({
    type: Type.Literal('press'),
    keys: NonEmptyText(200, 'Playwright key or chord, e.g. Enter or Control+A'),
    target: Type.Optional(target),
  });
  const upload = closedObject({
    type: Type.Literal('upload'),
    target,
    file: Type.String({
      pattern: '^(?![/\\\\])(?!(.*/)?\\.\\.(/|$))[^\\\\]+$',
      maxLength: 500,
      description: 'Relative reference to a project dataset file',
    }),
  });
  const drag = closedObject({ type: Type.Literal('drag'), source: target, destination: target });
  const scroll = closedObject({
    type: Type.Literal('scroll'),
    target: Type.Optional(target),
    direction: literalUnion(SCROLL_DIRECTIONS),
    amount: Type.Integer({ minimum: 1, maximum: 100_000, description: 'Pixels' }),
  });
  const wait = closedObject({ type: Type.Literal('wait') });
  const assert = closedObject({ type: Type.Literal('assert') });
  const extractBase = {
    type: Type.Literal('extract'),
    target,
    into: VariableName,
  };
  const extract = discriminatedUnion('parse', [
    closedObject({ ...extractBase, parse: literalUnion(['text', 'number'] as const) }),
    closedObject({
      ...extractBase,
      parse: Type.Literal('regex'),
      pattern: NonEmptyText(1000, 'ECMAScript regular expression; group 1, else the match'),
    }),
  ]);
  const requestBase = {
    method: literalUnion(HTTP_METHODS),
    url: NonEmptyText(2048, 'Absolute URL whose host is allow-listed, or ${env.NAME}/…'),
    headers: Type.Optional(
      Type.Record(
        Type.String({ pattern: "^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$" }),
        templatedText(4096),
        {
          additionalProperties: false,
        },
      ),
    ),
  };
  const request = Type.Union([
    closedObject({ ...requestBase, json: Type.Unknown({ description: 'JSON request body' }) }),
    closedObject({ ...requestBase, body: Type.Optional(templatedText(1_000_000)) }),
  ]);
  const http = closedObject({
    type: Type.Literal('http'),
    request,
    expectStatus: Type.Integer({ minimum: 100, maximum: 599 }),
    into: Type.Optional(VariableName),
  });
  return discriminatedUnion('type', [
    navigate,
    pointer,
    fill,
    clear,
    select,
    press,
    upload,
    drag,
    scroll,
    wait,
    assert,
    extract,
    http,
  ]);
}

export const Action = actionUnion(Target);
export type Action = Static<typeof Action>;

/** Actions an Analyst may propose in a PATCH; their targets are always grounded. */
export const PatchAction = actionUnion(PatchTarget);
export type PatchAction = Static<typeof PatchAction>;

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

export const NoulExpectation = closedObject({
  kind: Type.Literal('noul'),
  statement: NonEmptyText(500, 'One literal, self-contained claim in English'),
  criteria: Type.Optional(closedObject({ true: NonEmptyText(500), false: NonEmptyText(500) })),
});

export const DomExpectation = discriminatedUnion('op', [
  closedObject({ kind: Type.Literal('dom'), target: Target, op: literalUnion(DOM_STATE_OPS) }),
  closedObject({
    kind: Type.Literal('dom'),
    target: Target,
    op: literalUnion(DOM_TEXT_OPS),
    value: Type.String({ maxLength: 10_000 }),
  }),
  closedObject({
    kind: Type.Literal('dom'),
    target: Target,
    op: Type.Literal('textMatches'),
    pattern: NonEmptyText(1000, 'ECMAScript regular expression'),
  }),
  closedObject({
    kind: Type.Literal('dom'),
    target: Target,
    op: Type.Literal('numberCompare'),
    cmp: literalUnion(NUMBER_COMPARATORS),
    value: Type.Number(),
    tolerance: Type.Optional(Type.Number({ minimum: 0 })),
  }),
  closedObject({
    kind: Type.Literal('dom'),
    target: Target,
    op: Type.Literal('countEquals'),
    value: NonNegativeInteger,
  }),
]);

export const UrlExpectation = closedObject({
  kind: Type.Literal('url'),
  op: literalUnion(URL_OPS),
  value: NonEmptyText(2048),
});

export const ColorExpectation = closedObject({
  kind: Type.Literal('color'),
  target: Target,
  op: literalUnion(COLOR_OPS),
  value: literalUnion(PALETTE),
});

export const BlinkExpectation = Type.Union([
  closedObject({
    kind: Type.Literal('blink'),
    target: Target,
    minHz: Type.Number({ exclusiveMinimum: 0, maximum: 12 }),
    maxHz: Type.Number({ exclusiveMinimum: 0, maximum: 12 }),
  }),
  closedObject({ kind: Type.Literal('blink'), target: Target, op: Type.Literal('absent') }),
]);

export const MaskRect = closedObject({
  x: NonNegativeInteger,
  y: NonNegativeInteger,
  width: NonNegativeInteger,
  height: NonNegativeInteger,
});

export const VisualMask = Type.Union([
  closedObject({ description: NonEmptyText(500) }),
  closedObject({ rect: MaskRect }),
]);
export type VisualMask = Static<typeof VisualMask>;

export const VisualExpectation = closedObject({
  kind: Type.Literal('visual'),
  baseline: Slug,
  maxDiffRatio: Type.Number({ minimum: 0, maximum: 1 }),
  masks: Type.Optional(Type.Array(VisualMask, { maxItems: 50 })),
});

export const VisionExpectation = closedObject({
  kind: Type.Literal('vision'),
  question: NonEmptyText(500, 'A yes-or-no question about the screenshot'),
  expected: Type.Boolean({ description: 'The answer that makes the expectation pass' }),
});

export const ConsoleExpectation = closedObject({
  kind: Type.Literal('console'),
  pattern: Type.Optional(NonEmptyText(1000, 'Only console errors matching this pattern count')),
});

export const NetworkExpectation = closedObject({
  kind: Type.Literal('network'),
  pattern: Type.Optional(NonEmptyText(1000, 'Only responses whose URL matches this pattern count')),
});

export const A11yExpectation = closedObject({
  kind: Type.Literal('a11y'),
  ruleset: literalUnion(A11Y_RULESETS),
  impact: literalUnion(A11Y_IMPACTS, { description: 'Violations at or above this impact fail' }),
});

export const Expectation = discriminatedUnion('kind', [
  NoulExpectation,
  DomExpectation,
  UrlExpectation,
  ColorExpectation,
  BlinkExpectation,
  VisualExpectation,
  VisionExpectation,
  ConsoleExpectation,
  NetworkExpectation,
  A11yExpectation,
]);
export type Expectation = Static<typeof Expectation>;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const ActionStep = closedObject({
  id: StepId,
  intent: NonEmptyText(300),
  risk: Type.Optional(literalUnion(RISK_CLASSES)),
  action: Action,
  expect: Type.Optional(Type.Array(Expectation, { maxItems: 32 })),
  within: Type.Optional(Duration),
  allowInProduction: Type.Optional(Type.Boolean()),
  expectedScreen: Type.Optional(NonEmptyText(300, 'Description of the screen this step expects')),
  artifacts: Type.Optional(literalUnion(ARTIFACT_POLICIES)),
});
export type ActionStep = Static<typeof ActionStep>;

/** A fragment reference; the compiler inlines the fragment, the runner never sees it. */
export const FragmentStep = closedObject({
  id: StepId,
  use: Slug,
  intent: Type.Optional(NonEmptyText(300)),
});
export type FragmentStep = Static<typeof FragmentStep>;

export const Step = Type.Union([ActionStep, FragmentStep]);
export type Step = Static<typeof Step>;

// ---------------------------------------------------------------------------
// Handlers, policy, target, metadata
// ---------------------------------------------------------------------------

export const HandlerCondition = discriminatedUnion('kind', [
  closedObject({ kind: Type.Literal('probe'), name: literalUnion(PROBE_NAMES) }),
  closedObject({ kind: Type.Literal('noul'), statement: NonEmptyText(500) }),
]);
export type HandlerCondition = Static<typeof HandlerCondition>;

export const Handler = closedObject({
  id: StepId,
  when: HandlerCondition,
  steps: Type.Array(Step, { minItems: 1, maxItems: 20 }),
});
export type Handler = Static<typeof Handler>;

export const Policy = closedObject({
  strict: Type.Boolean(),
  onBreak: literalUnion(ON_BREAK_POLICIES),
  failOnConsoleError: Type.Boolean(),
  shareScreenshotsWithLlm: literalUnion(SCREENSHOT_SHARING),
  artifacts: literalUnion(ARTIFACT_POLICIES),
  pii: Type.Optional(literalUnion(PII_MODES)),
  degrade: Type.Optional(literalUnion(DEGRADE_POLICIES)),
  healApproval: Type.Optional(literalUnion(HEAL_APPROVALS)),
});
export type Policy = Static<typeof Policy>;

/** A policy with every optional field resolved to its default. */
export const ResolvedPolicy = closedObject({
  strict: Type.Boolean(),
  onBreak: literalUnion(ON_BREAK_POLICIES),
  failOnConsoleError: Type.Boolean(),
  shareScreenshotsWithLlm: literalUnion(SCREENSHOT_SHARING),
  artifacts: literalUnion(ARTIFACT_POLICIES),
  pii: literalUnion(PII_MODES),
  degrade: literalUnion(DEGRADE_POLICIES),
  healApproval: literalUnion(HEAL_APPROVALS),
});
export type ResolvedPolicy = Static<typeof ResolvedPolicy>;

export const Viewport = closedObject({
  width: Type.Integer({ minimum: 320, maximum: 7680 }),
  height: Type.Integer({ minimum: 200, maximum: 4320 }),
});
export type Viewport = Static<typeof Viewport>;

export const ScriptTarget = closedObject({
  baseUrl: NonEmptyText(2048, 'Absolute URL or ${env.NAME}'),
  viewport: Viewport,
  locale: Type.String({ pattern: LOCALE_PATTERN }),
  timezone: Type.String({ pattern: TIMEZONE_PATTERN }),
  storageState: Type.Optional(NonEmptyText(500, 'Name of a stored browser state to start from')),
});
export type ScriptTarget = Static<typeof ScriptTarget>;

export const CompilerInfo = closedObject({
  model: NonEmptyText(128),
  promptVersion: Type.String({ pattern: '^[a-z]-[0-9]+$' }),
});

export const ScriptMetadata = closedObject({
  name: Slug,
  title: NonEmptyText(200),
  tags: Type.Optional(Type.Array(Slug, { uniqueItems: true, maxItems: 32 })),
  sourceHash: Type.Optional(Sha256),
  compiler: Type.Optional(CompilerInfo),
});

export const Variables = Type.Record(VariableName, ScalarValue, { additionalProperties: false });

export const TestScript = closedObject({
  apiVersion: Type.Literal(API_VERSION),
  kind: Type.Literal('TestScript'),
  metadata: ScriptMetadata,
  target: ScriptTarget,
  policy: Policy,
  variables: Type.Optional(Variables),
  secrets: Type.Optional(Type.Array(SecretName, { uniqueItems: true, maxItems: 64 })),
  handlers: Type.Optional(Type.Array(Handler, { maxItems: 20 })),
  steps: Type.Array(Step, { minItems: 1, maxItems: 500 }),
});
export type TestScript = Static<typeof TestScript>;

/** A reusable fragment such as login-operator, inlined at compile time. */
export const Fragment = closedObject({
  apiVersion: Type.Literal(API_VERSION),
  kind: Type.Literal('Fragment'),
  metadata: closedObject({
    name: Slug,
    title: NonEmptyText(200),
    sourceHash: Type.Optional(Sha256),
  }),
  variables: Type.Optional(Variables),
  secrets: Type.Optional(Type.Array(SecretName, { uniqueItems: true, maxItems: 64 })),
  steps: Type.Array(Step, { minItems: 1, maxItems: 100 }),
});
export type Fragment = Static<typeof Fragment>;
