/**
 * fast-check arbitraries producing schema-valid TestScripts with every action type and
 * expectation kind, Unicode text and non-trivial numbers.
 */
import fc from 'fast-check';
import {
  A11Y_IMPACTS,
  A11Y_RULESETS,
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
} from '../../src/index.js';

const text = (maxLength: number) =>
  fc.oneof(
    fc.string({ unit: 'grapheme', minLength: 1, maxLength }),
    fc.string({ unit: 'binary', minLength: 1, maxLength }),
    fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength }),
  );
const anyText = (maxLength: number) => fc.string({ unit: 'binary', maxLength });
const slug = fc.stringMatching(/^[a-z0-9]([a-z0-9-]{0,12}[a-z0-9])?$/);
const stepId = fc.stringMatching(/^[a-z0-9]([a-z0-9_-]{0,8}[a-z0-9])?$/);
const variableName = fc
  .stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,10}$/)
  .filter((name) => name !== '__proto__');
const secretName = fc.stringMatching(/^[A-Z][A-Z0-9_]{0,10}$/);
/** Finite doubles without -0 (RFC 8785 serialises -0 as 0). */
const number = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map((value) => (value === 0 ? 0 : value));
const ratio = fc.double({ min: 0, max: 1, noNaN: true }).map((value) => (value === 0 ? 0 : value));
const hertz = fc.double({ min: 0.01, max: 12, noNaN: true });
const duration = fc
  .tuple(fc.nat(3), fc.nat(59), fc.nat(999))
  .filter(([m, s, ms]) => m + s + ms > 0)
  .map(([m, s, ms]) => `${m > 0 ? `${m}m` : ''}${s > 0 ? `${s}s` : ''}${ms > 0 ? `${ms}ms` : ''}`);

function optional<T>(arbitrary: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> {
  return fc.option(arbitrary, { nil: undefined });
}

/** Drops undefined members so the value is plain JSON. */
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

const hints = fc
  .record(
    {
      role: optional(text(20)),
      text: optional(text(40)),
      label: optional(text(40)),
      testId: optional(text(40)),
      near: optional(text(40)),
      region: optional(text(40)),
    },
    { requiredKeys: [] },
  )
  .map(compact);

export const target = fc
  .record({
    description: text(120),
    hints: optional(hints),
    frame: optional(text(40)),
    locator: optional(text(80)),
  })
  .map(compact);

const jsonValue = fc
  .jsonValue({ maxDepth: 3 })
  .map((value) => JSON.parse(JSON.stringify(value)) as unknown);

export const action = fc.oneof(
  fc.record({ type: fc.constant('navigate'), url: text(100) }),
  fc.record({ type: fc.constantFrom(...POINTER_ACTION_TYPES), target }),
  fc.record({ type: fc.constant('fill'), target, value: anyText(100) }),
  fc.record({ type: fc.constant('clear'), target }),
  fc.record({ type: fc.constant('select'), target, option: text(40) }),
  fc.record({ type: fc.constant('press'), keys: text(20), target: optional(target) }).map(compact),
  fc.record({
    type: fc.constant('upload'),
    target,
    file: fc.stringMatching(/^datasets\/[a-z0-9-]{1,12}\.(json|csv|pdf)$/),
  }),
  fc.record({ type: fc.constant('drag'), source: target, destination: target }),
  fc
    .record({
      type: fc.constant('scroll'),
      target: optional(target),
      direction: fc.constantFrom(...SCROLL_DIRECTIONS),
      amount: fc.integer({ min: 1, max: 100_000 }),
    })
    .map(compact),
  fc.record({ type: fc.constantFrom('wait', 'assert') }),
  fc.record({
    type: fc.constant('extract'),
    target,
    into: variableName,
    parse: fc.constantFrom('text', 'number'),
  }),
  fc.record({
    type: fc.constant('extract'),
    target,
    into: variableName,
    parse: fc.constant('regex'),
    pattern: text(40),
  }),
  fc
    .record({
      type: fc.constant('http'),
      request: fc.oneof(
        fc
          .record({
            method: fc.constantFrom(...HTTP_METHODS),
            url: text(100),
            headers: optional(
              fc.dictionary(fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,15}$/), anyText(40), {
                maxKeys: 3,
                noNullPrototype: true,
              }),
            ),
            json: jsonValue,
          })
          .map(compact),
        fc
          .record({
            method: fc.constantFrom(...HTTP_METHODS),
            url: text(100),
            body: optional(anyText(200)),
          })
          .map(compact),
      ),
      expectStatus: fc.integer({ min: 100, max: 599 }),
      into: optional(variableName),
    })
    .map(compact),
);

const mask = fc.oneof(
  fc.record({ description: text(60) }),
  fc.record({
    rect: fc.record({
      x: fc.nat(4000),
      y: fc.nat(4000),
      width: fc.nat(4000),
      height: fc.nat(4000),
    }),
  }),
);

export const expectation = fc.oneof(
  fc
    .record({
      kind: fc.constant('noul'),
      statement: text(120),
      criteria: optional(fc.record({ true: text(60), false: text(60) })),
    })
    .map(compact),
  fc.record({ kind: fc.constant('dom'), target, op: fc.constantFrom(...DOM_STATE_OPS) }),
  fc.record({
    kind: fc.constant('dom'),
    target,
    op: fc.constantFrom(...DOM_TEXT_OPS),
    value: anyText(60),
  }),
  fc.record({
    kind: fc.constant('dom'),
    target,
    op: fc.constant('textMatches'),
    pattern: text(40),
  }),
  fc
    .record({
      kind: fc.constant('dom'),
      target,
      op: fc.constant('numberCompare'),
      cmp: fc.constantFrom(...NUMBER_COMPARATORS),
      value: number,
      tolerance: optional(ratio),
    })
    .map(compact),
  fc.record({
    kind: fc.constant('dom'),
    target,
    op: fc.constant('countEquals'),
    value: fc.nat(10_000),
  }),
  fc.record({ kind: fc.constant('url'), op: fc.constantFrom(...URL_OPS), value: text(80) }),
  fc.record({
    kind: fc.constant('color'),
    target,
    op: fc.constantFrom(...COLOR_OPS),
    value: fc.constantFrom(...PALETTE),
  }),
  fc.record({ kind: fc.constant('blink'), target, minHz: hertz, maxHz: hertz }),
  fc.record({ kind: fc.constant('blink'), target, op: fc.constant('absent') }),
  fc
    .record({
      kind: fc.constant('visual'),
      baseline: slug,
      maxDiffRatio: ratio,
      masks: optional(fc.array(mask, { maxLength: 4 })),
    })
    .map(compact),
  fc.record({ kind: fc.constant('vision'), question: text(80), expected: fc.boolean() }),
  fc.record({ kind: fc.constant('console'), pattern: optional(text(30)) }).map(compact),
  fc.record({ kind: fc.constant('network'), pattern: optional(text(30)) }).map(compact),
  fc.record({
    kind: fc.constant('a11y'),
    ruleset: fc.constantFrom(...A11Y_RULESETS),
    impact: fc.constantFrom(...A11Y_IMPACTS),
  }),
);

const actionStep = fc
  .record({
    id: stepId,
    intent: text(100),
    risk: optional(fc.constantFrom(...RISK_CLASSES)),
    action,
    expect: optional(fc.array(expectation, { maxLength: 4 })),
    within: optional(duration),
    allowInProduction: optional(fc.boolean()),
    expectedScreen: optional(text(60)),
    artifacts: optional(fc.constantFrom(...ARTIFACT_POLICIES)),
  })
  .map(compact);

const fragmentStep = fc.record({ id: stepId, use: slug, intent: optional(text(60)) }).map(compact);

export const step = fc.oneof(
  { weight: 6, arbitrary: actionStep },
  { weight: 1, arbitrary: fragmentStep },
);

const handler = fc.record({
  id: stepId,
  when: fc.oneof(
    fc.record({ kind: fc.constant('probe'), name: fc.constantFrom(...PROBE_NAMES) }),
    fc.record({ kind: fc.constant('noul'), statement: text(80) }),
  ),
  steps: fc.array(step, { minLength: 1, maxLength: 3 }),
});

const policy = fc
  .record({
    strict: fc.boolean(),
    onBreak: fc.constantFrom(...ON_BREAK_POLICIES),
    failOnConsoleError: fc.boolean(),
    shareScreenshotsWithLlm: fc.constantFrom(...SCREENSHOT_SHARING),
    artifacts: fc.constantFrom(...ARTIFACT_POLICIES),
    pii: optional(fc.constantFrom(...PII_MODES)),
    degrade: optional(fc.constantFrom(...DEGRADE_POLICIES)),
    healApproval: optional(fc.constantFrom(...HEAL_APPROVALS)),
  })
  .map(compact);

const hex64 = fc.stringMatching(/^[0-9a-f]{64}$/);

export const testScript = fc
  .record({
    apiVersion: fc.constant('argus/v1'),
    kind: fc.constant('TestScript'),
    metadata: fc
      .record({
        name: slug,
        title: text(80),
        tags: optional(fc.uniqueArray(slug, { maxLength: 4 })),
        sourceHash: optional(hex64.map((hex) => `sha256:${hex}`)),
        compiler: optional(
          fc.record({ model: text(30), promptVersion: fc.stringMatching(/^[a-z]-[0-9]{1,3}$/) }),
        ),
      })
      .map(compact),
    target: fc
      .record({
        baseUrl: text(80),
        viewport: fc.record({
          width: fc.integer({ min: 320, max: 7680 }),
          height: fc.integer({ min: 200, max: 4320 }),
        }),
        locale: fc.constantFrom('en-GB', 'fr-FR', 'de', 'zh-Hant-TW'),
        timezone: fc.constantFrom(
          'UTC',
          'Europe/Paris',
          'America/Argentina/Buenos_Aires',
          'Etc/GMT+1',
        ),
        storageState: optional(text(30)),
      })
      .map(compact),
    policy,
    variables: optional(
      fc.dictionary(variableName, fc.oneof(anyText(40), number, fc.boolean()), {
        maxKeys: 4,
        noNullPrototype: true,
      }),
    ),
    secrets: optional(fc.uniqueArray(secretName, { maxLength: 3 })),
    handlers: optional(fc.array(handler, { maxLength: 2 })),
    steps: fc.array(step, { minLength: 1, maxLength: 8 }),
  })
  .map(compact)
  // fast-check builds some objects without a prototype; scripts are plain JSON data.
  .map((script) => JSON.parse(JSON.stringify(script)) as Record<string, unknown>);
