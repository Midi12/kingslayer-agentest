/**
 * `renderSteps()` prints a TestScript as a readable step list by template: no model is
 * involved, and the same script always gives the same text (product design, "Author and
 * compile"). Strings are quoted as JSON string literals, numbers in ECMAScript form.
 */
import { canonicalize } from './canonical.js';
import type { NumberComparator } from './enums.js';
import type { Action, Expectation, Handler, Step, Target, TestScript } from './schemas/script.js';
import { isActionStep } from './script.js';

const quote = (text: string): string => JSON.stringify(text);

/**
 * Text printed without quotes (intents, URLs, keys, screen names, titles): control
 * characters and line or paragraph separators are written as escapes, so no field can
 * start a line of its own and pass for another step or expectation.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const ESCAPES: Readonly<Record<string, string>> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
function inline(text: string): string {
  return text.replace(
    CONTROL,
    (char) => ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export function renderTarget(target: Target): string {
  const hints = target.hints ?? {};
  const parts: string[] = [];
  if (hints.role !== undefined) parts.push(`role ${hints.role}`);
  if (hints.text !== undefined) parts.push(`text ${quote(hints.text)}`);
  if (hints.label !== undefined) parts.push(`label ${quote(hints.label)}`);
  if (hints.testId !== undefined) parts.push(`test id ${quote(hints.testId)}`);
  if (hints.near !== undefined) parts.push(`near ${quote(hints.near)}`);
  if (hints.region !== undefined) parts.push(`region ${quote(hints.region)}`);
  let text = quote(target.description);
  if (parts.length > 0) text += ` (${parts.join(', ')})`;
  if (target.frame !== undefined) text += ` in frame ${quote(target.frame)}`;
  if (target.locator !== undefined) text += ` [locator ${quote(target.locator)}]`;
  return text;
}

const POINTER_VERBS = {
  click: 'Click',
  dblclick: 'Double-click',
  rightclick: 'Right-click',
  hover: 'Hover over',
  check: 'Check',
  uncheck: 'Uncheck',
} as const;

export function renderAction(action: Action): string {
  switch (action.type) {
    case 'navigate':
      return `Go to ${inline(action.url)}`;
    case 'click':
    case 'dblclick':
    case 'rightclick':
    case 'hover':
    case 'check':
    case 'uncheck':
      return `${POINTER_VERBS[action.type]} ${renderTarget(action.target)}`;
    case 'fill':
      return `Fill ${renderTarget(action.target)} with ${quote(action.value)}`;
    case 'clear':
      return `Clear ${renderTarget(action.target)}`;
    case 'select':
      return `Select ${quote(action.option)} in ${renderTarget(action.target)}`;
    case 'press':
      return `Press ${inline(action.keys)}${action.target === undefined ? '' : ` in ${renderTarget(action.target)}`}`;
    case 'upload':
      return `Upload ${quote(action.file)} to ${renderTarget(action.target)}`;
    case 'drag':
      return `Drag ${renderTarget(action.source)} onto ${renderTarget(action.destination)}`;
    case 'scroll':
      return `Scroll ${action.direction} by ${action.amount} px ${
        action.target === undefined ? 'on the page' : `in ${renderTarget(action.target)}`
      }`;
    case 'wait':
      return 'Wait until the expectations hold';
    case 'assert':
      return 'Check the expectations';
    case 'extract': {
      const what =
        action.parse === 'regex'
          ? `the match of pattern ${quote(action.pattern)}`
          : action.parse === 'number'
            ? 'the number'
            : 'the text';
      return `Extract ${what} from ${renderTarget(action.target)} into \${var.${action.into}}`;
    }
    case 'http': {
      const request = action.request;
      let text = `Send ${request.method} ${inline(request.url)}`;
      const headers = Object.keys(request.headers ?? {}).sort();
      if (headers.length > 0) text += ` with headers ${headers.map(inline).join(', ')}`;
      if ('json' in request) {
        text += `${headers.length > 0 ? ' and' : ' with'} JSON ${canonicalize(request.json)}`;
      } else if (request.body !== undefined) {
        text += `${headers.length > 0 ? ' and' : ' with'} body ${quote(request.body)}`;
      }
      text += `, expect status ${action.expectStatus}`;
      if (action.into !== undefined) text += `, store the response in \${var.${action.into}}`;
      return text;
    }
  }
}

const COMPARATOR_WORDS: Record<NumberComparator, string> = {
  eq: 'equals',
  ne: 'differs from',
  lt: 'is below',
  le: 'is at most',
  gt: 'is above',
  ge: 'is at least',
};

export function renderExpectation(expectation: Expectation): string {
  switch (expectation.kind) {
    case 'noul': {
      let text = `Jev confirms ${quote(expectation.statement)}`;
      if (expectation.criteria !== undefined) {
        text += ` (true: ${quote(expectation.criteria.true)}; false: ${quote(expectation.criteria.false)})`;
      }
      return text;
    }
    case 'dom': {
      const target = renderTarget(expectation.target);
      switch (expectation.op) {
        case 'exists':
          return `${target} exists`;
        case 'absent':
          return `${target} is absent`;
        case 'visible':
          return `${target} is visible`;
        case 'enabled':
          return `${target} is enabled`;
        case 'disabled':
          return `${target} is disabled`;
        case 'textEquals':
          return `Text of ${target} equals ${quote(expectation.value)}`;
        case 'textContains':
          return `Text of ${target} contains ${quote(expectation.value)}`;
        case 'valueEquals':
          return `Value of ${target} equals ${quote(expectation.value)}`;
        case 'textMatches':
          return `Text of ${target} matches pattern ${quote(expectation.pattern)}`;
        case 'numberCompare':
          return `Number in ${target} ${COMPARATOR_WORDS[expectation.cmp]} ${expectation.value}${
            expectation.tolerance === undefined
              ? ''
              : ` within a tolerance of ${expectation.tolerance}`
          }`;
        case 'countEquals':
          return `Count of ${target} equals ${expectation.value}`;
      }
      break;
    }
    case 'url':
      return `URL ${expectation.op} ${quote(expectation.value)}`;
    case 'color':
      return `Colour of ${renderTarget(expectation.target)} ${expectation.op === 'is' ? 'is' : 'is not'} ${expectation.value}`;
    case 'blink':
      return 'op' in expectation
        ? `${renderTarget(expectation.target)} does not blink`
        : `${renderTarget(expectation.target)} blinks between ${expectation.minHz} and ${expectation.maxHz} Hz`;
    case 'visual': {
      let text = `Screen matches baseline ${quote(expectation.baseline)} with a pixel difference ratio of at most ${expectation.maxDiffRatio}`;
      const masks = (expectation.masks ?? []).map((mask) =>
        'description' in mask
          ? quote(mask.description)
          : `rectangle ${mask.rect.width}x${mask.rect.height} at ${mask.rect.x},${mask.rect.y}`,
      );
      if (masks.length > 0) text += `, masking ${masks.join(', ')}`;
      return text;
    }
    case 'vision':
      return `AI vision answers ${expectation.expected ? 'yes' : 'no'} to ${quote(expectation.question)}`;
    case 'console':
      return expectation.pattern === undefined
        ? 'No console errors'
        : `No console errors matching pattern ${quote(expectation.pattern)}`;
    case 'network':
      return expectation.pattern === undefined
        ? 'No responses with status 500 or above'
        : `No responses with status 500 or above for URLs matching pattern ${quote(expectation.pattern)}`;
    case 'a11y':
      return `No ${expectation.ruleset} accessibility violations of impact ${expectation.impact} or higher`;
  }
  return '';
}

function stepQualifiers(step: Step): string {
  if (!isActionStep(step)) return '';
  const parts: string[] = [];
  if (step.risk !== undefined) parts.push(`risk ${step.risk}`);
  if (step.within !== undefined) parts.push(`within ${step.within}`);
  if (step.allowInProduction === true) parts.push('allowed in production');
  if (step.artifacts !== undefined) parts.push(`artifacts ${step.artifacts}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function renderStep(step: Step, number: number, indent: string): string[] {
  const head = `${indent}${number}. [${step.id}]`;
  if (!isActionStep(step)) {
    const intent = step.intent === undefined ? '' : ` ${inline(step.intent)}:`;
    return [`${head}${intent} Use fragment ${inline(step.use)}`];
  }
  const detail = `${indent}${' '.repeat(String(number).length + 2)}`;
  const lines = [`${head} ${inline(step.intent)}${stepQualifiers(step)}`];
  if (step.expectedScreen !== undefined) {
    lines.push(`${detail}Screen: ${inline(step.expectedScreen)}`);
  }
  lines.push(`${detail}Action: ${renderAction(step.action)}`);
  for (const expectation of step.expect ?? []) {
    lines.push(`${detail}Expect: ${renderExpectation(expectation)}`);
  }
  return lines;
}

function renderHandler(handler: Handler): string[] {
  const condition =
    handler.when.kind === 'probe'
      ? `the probe ${inline(handler.when.name)} fires`
      : `Jev confirms ${quote(handler.when.statement)}`;
  const lines = [`- [${handler.id}] When ${condition}:`];
  handler.steps.forEach((step, index) => lines.push(...renderStep(step, index + 1, '  ')));
  return lines;
}

function renderValue(value: string | number | boolean): string {
  return typeof value === 'string' ? quote(value) : String(value);
}

/** The step list of a script, as plain text ending with a newline. */
export function renderSteps(script: TestScript): string {
  const { metadata, target, policy } = script;
  const lines: string[] = [`${inline(metadata.title)} (${inline(metadata.name)})`];
  if (metadata.tags !== undefined && metadata.tags.length > 0) {
    lines.push(`Tags: ${metadata.tags.map(inline).join(', ')}`);
  }
  lines.push(
    `Target: ${inline(target.baseUrl)}, viewport ${target.viewport.width}x${target.viewport.height}, locale ${inline(target.locale)}, time zone ${inline(target.timezone)}${
      target.storageState === undefined ? '' : `, storage state ${quote(target.storageState)}`
    }`,
  );
  const policyParts = [
    policy.strict ? 'strict' : 'not strict',
    `on break ${policy.onBreak}`,
    policy.failOnConsoleError ? 'console errors fail' : 'console errors ignored',
    `screenshots to the LLM ${policy.shareScreenshotsWithLlm}`,
    `artifacts ${policy.artifacts}`,
  ];
  if (policy.pii !== undefined) policyParts.push(`PII ${policy.pii}`);
  if (policy.degrade !== undefined) policyParts.push(`degrade to ${policy.degrade}`);
  if (policy.healApproval !== undefined) policyParts.push(`heal approval ${policy.healApproval}`);
  lines.push(`Policy: ${policyParts.join(', ')}`);
  const variables = Object.entries(script.variables ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (variables.length > 0) {
    lines.push(
      `Variables: ${variables.map(([name, value]) => `${name} = ${renderValue(value)}`).join(', ')}`,
    );
  }
  if (script.secrets !== undefined && script.secrets.length > 0) {
    lines.push(`Secrets: ${script.secrets.join(', ')}`);
  }
  lines.push('', 'Steps');
  script.steps.forEach((step, index) => lines.push(...renderStep(step, index + 1, '')));
  if (script.handlers !== undefined && script.handlers.length > 0) {
    lines.push('', 'Handlers');
    for (const handler of script.handlers) lines.push(...renderHandler(handler));
  }
  return `${lines.join('\n')}\n`;
}
