/**
 * Deterministic lint of a TestScript: rules L1 to L8 of the Architecture tab.
 *
 * The rules and their exact checks are documented in ADR M01-lint-rules. Every finding
 * names its rule, the step or handler it is about (null for the script as a whole), a
 * JSON Pointer to the offending value, a message and a severity. Findings are ordered by
 * rule, then by position in the script.
 */
import { DEFAULT_CRITICAL_VERBS, type LintCode } from './enums.js';
import { parseDuration } from './duration.js';
import type { LintFinding } from './schemas/compile.js';
import type { ActionStep, Expectation, Step, TestScript } from './schemas/script.js';
import { actionTargets, allSteps, isActionStep, templateReferences } from './script.js';

export interface LintContext {
  /** Verbs whose use in an intent forces `risk: critical` (L5). */
  readonly criticalVerbs: readonly string[];
  /** Origins a navigation may reach, e.g. https://hmi.test (L4). */
  readonly allowedOrigins: readonly string[];
  /** Hosts, with an optional port, the `http` action may call (L4). */
  readonly allowedHttpHosts: readonly string[];
  /** Run timeout the worst-case duration must fit (L6). */
  readonly runTimeoutMs: number;
  /** The previous version of the same test, for id stability (L8). */
  readonly previous?: TestScript;
}

/** Longest `within` window a step may declare (Budgets table). */
export const MAX_WITHIN_MS = 120_000;
/** Window of a step that declares no `within` (Budgets table). */
export const DEFAULT_WITHIN_MS = 10_000;
/** Default run timeout (Budgets table). */
export const DEFAULT_RUN_TIMEOUT_MS = 15 * 60_000;

/** A lint context with the project defaults of the spec. */
export function defaultLintContext(overrides: Partial<LintContext> = {}): LintContext {
  return {
    criticalVerbs: DEFAULT_CRITICAL_VERBS,
    allowedOrigins: [],
    allowedHttpHosts: [],
    runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS,
    ...overrides,
  };
}

/** Runs rules L1 to L8 and returns every finding. */
export function lintScript(script: TestScript, context: LintContext): LintFinding[] {
  return [
    ...lintL1(script),
    ...lintL2(script),
    ...lintL3(script),
    ...lintL4(script, context),
    ...lintL5(script, context),
    ...lintL6(script, context),
    ...lintL7(script),
    ...lintL8(script, context),
  ];
}

function finding(
  code: LintCode,
  stepId: string | null,
  path: string,
  message: string,
): LintFinding {
  return { code, stepId, path, message, severity: 'error' };
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}'’-]+/u)
    .map((word) => word.replace(/^['’-]+|['’-]+$/g, ''))
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}

function actionSteps(script: TestScript): { step: ActionStep; path: string }[] {
  return allSteps(script).flatMap(({ step, path }) => (isActionStep(step) ? [{ step, path }] : []));
}

// ---------------------------------------------------------------------------
// L1: target descriptions of at least three words, without pronouns
// ---------------------------------------------------------------------------

/** Pronouns that make a description depend on context it does not carry. */
export const DESCRIPTION_PRONOUNS = [
  'it',
  'its',
  'itself',
  'this',
  'these',
  'those',
  'they',
  'them',
  'their',
  'theirs',
  'themselves',
  'he',
  'him',
  'his',
  'she',
  'her',
  'hers',
] as const;
const PRONOUNS = new Set<string>(DESCRIPTION_PRONOUNS);

function lintL1(script: TestScript): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const { step, path } of actionSteps(script)) {
    for (const { target, path: targetPath } of actionTargets(step.action)) {
      const tokens = words(target.description);
      const problems: string[] = [];
      if (tokens.length < 3) {
        problems.push(
          `has ${tokens.length} word${tokens.length === 1 ? '' : 's'}, at least three are needed`,
        );
      }
      const pronouns = [...new Set(tokens.filter((token) => PRONOUNS.has(token)))];
      if (pronouns.length > 0) {
        problems.push(
          `uses the pronoun${pronouns.length === 1 ? '' : 's'} ${pronouns.map((p) => `"${p}"`).join(', ')}`,
        );
      }
      if (problems.length > 0) {
        findings.push(
          finding(
            'L1',
            step.id,
            `${path}/action${targetPath}/description`,
            `Target description ${JSON.stringify(target.description)} ${problems.join(' and ')}.`,
          ),
        );
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// L2: Noul statements are declarative single claims without numbers or dates
// ---------------------------------------------------------------------------

const INTERROGATIVE_START = new Set([
  'is',
  'are',
  'was',
  'were',
  'does',
  'do',
  'did',
  'can',
  'could',
  'should',
  'would',
  'will',
  'has',
  'have',
  'had',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'when',
  'where',
  'why',
  'how',
]);
const IMPERATIVE_START = new Set([
  'check',
  'verify',
  'ensure',
  'make',
  'confirm',
  'click',
  'open',
  'go',
  'wait',
  'see',
  'assert',
  'validate',
  'test',
  'look',
  'find',
  'navigate',
  'press',
  'select',
  'type',
  'enter',
]);
const NUMBER_WORDS =
  /\b(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand|dozens?)\b/i;
const COUNT_PHRASES = /\b(number of|count of|counts?|how many|exactly|several|at least|at most)\b/i;
const COMPARISON =
  /\b(more|less|fewer|greater|higher|lower|larger|smaller|bigger|longer|shorter)\s+than\b|[<>≤≥]|\b(above|below|under|over|exceeds?|exceeding|between|equals?|equal to|up to|within)\s+[-+]?[0-9]/i;
const COUNTED_NUMBER =
  /(?<![\p{L}\p{N}_.])[0-9]+(?:[.,][0-9]+)?\s*(%|(?!(?:is|was|has|does|shows|reads|remains|stays|displays|contains|appears|blinks|turns)\b)\p{L}*[^\P{L}sui]s\b)/u;
const DATE_OR_TIME =
  /\b(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday|tomorrow)\b|\bmay\s+[0-9]|\b[0-9]{4}-[0-9]{2}-[0-9]{2}\b|\b[0-9]{1,2}[/.][0-9]{1,2}[/.][0-9]{2,4}\b|\b[0-9]{1,2}:[0-9]{2}\b/i;
const CONJUNCTION = /\b(and|or|but|as well as|also)\b|;/i;

/** A number written in digits that is not glued to a preceding letter (as in C12). */
const STANDALONE_NUMBER = /(?<![\p{L}\p{N}_.,])[-+]?[0-9]+(?:[.,][0-9]+)*(?![0-9])/gu;
/** Units, ordinals and signs that make a number a measured or counted value. */
const UNIT =
  /^(?:%|‰|°|°c|°f|c|f|k|percent|per|pct|degrees?|x|times|mm|cm|m|km|m\/s|km\/h|mph|s|sec|secs|seconds?|ms|min|mins|minutes?|h|hrs?|hours?|hz|khz|mhz|rpm|v|kv|mv|a|ma|w|kw|mw|kwh|wh|va|bar|mbar|pa|kpa|mpa|psi|kg|g|mg|t|tons?|tonnes?|l|ml|m3|l\/min|l\/h|m3\/h|nm|st|nd|rd|th|px|db|ppm|lux|lx)$/i;
/**
 * Words after which a number is a value rather than the name of a thing: verbs of state
 * and display, prepositions, articles and measured quantities. "conveyor 12" and "line 2"
 * name equipment; "shows 5", "a value of 42" and "reads 80" state a reading.
 */
const VALUE_CONTEXT = new Set([
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'becomes',
  'become',
  'became',
  'remains',
  'remain',
  'stays',
  'stay',
  'shows',
  'show',
  'showing',
  'shown',
  'displays',
  'display',
  'displaying',
  'displayed',
  'reads',
  'read',
  'reading',
  'readings',
  'reaches',
  'reached',
  'equals',
  'equal',
  'contains',
  'contain',
  'lists',
  'indicates',
  'indicate',
  'reports',
  'report',
  'holds',
  'gives',
  'returns',
  'has',
  'have',
  'had',
  'set',
  'sets',
  'at',
  'of',
  'to',
  'from',
  'by',
  'on',
  'in',
  'with',
  'for',
  'about',
  'around',
  'approximately',
  'nearly',
  'almost',
  'only',
  'just',
  'than',
  'a',
  'an',
  'the',
  'value',
  'values',
  'level',
  'speed',
  'rate',
  'temperature',
  'pressure',
  'total',
  'amount',
  'quantity',
  'setpoint',
  'percentage',
  'ratio',
  'score',
  'duration',
  'time',
  'weight',
  'flow',
  'voltage',
  'current',
  'power',
]);

/**
 * Whether the statement states a numeric value. A number is allowed only as an
 * identifier: a whole number right after a naming word ("conveyor 12", "alarm 7") and
 * not followed by a unit. A decimal, a signed number, a number with a unit or a
 * percentage, one that follows a verb, preposition, article or measured quantity, or one
 * that opens the statement is a value.
 */
function statesNumericValue(text: string): boolean {
  for (const match of text.matchAll(STANDALONE_NUMBER)) {
    const number = match[0];
    if (/[.,+-]/.test(number)) return true;
    const before = words(text.slice(0, match.index)).at(-1);
    if (before === undefined || VALUE_CONTEXT.has(before)) return true;
    const after = text.slice(match.index + number.length);
    const glued = /^[\p{L}°%‰][\p{L}\p{N}°%‰/]*/u.exec(after)?.[0];
    if (glued !== undefined) {
      if (UNIT.test(glued)) return true;
      continue; // an identifier such as 12B
    }
    const next = /^\s*([%‰°]|[\p{L}][\p{L}\p{N}/]*)/u.exec(after)?.[1];
    if (next !== undefined && UNIT.test(next)) return true;
  }
  return false;
}

/** Reasons a Noul statement breaks L2; empty when it is fine. */
export function noulStatementProblems(statement: string): string[] {
  const text = statement.trim();
  const problems: string[] = [];
  const first = words(text)[0] ?? '';
  if (text.endsWith('?') || INTERROGATIVE_START.has(first)) {
    problems.push('is a question, not a declarative statement');
  } else if (IMPERATIVE_START.has(first)) {
    problems.push('is an instruction, not a declarative statement');
  }
  const sentences = text.split(/[.!?]+(?:\s+|$)/).filter((part) => part.trim() !== '');
  if (sentences.length > 1 || CONJUNCTION.test(text)) {
    problems.push('makes more than one claim');
  }
  const comparison = COMPARISON.test(text);
  const count = COUNT_PHRASES.test(text) || NUMBER_WORDS.test(text) || COUNTED_NUMBER.test(text);
  const date = DATE_OR_TIME.test(text);
  if (comparison) {
    problems.push('contains a numeric comparison');
  } else if (!count && !date && statesNumericValue(text)) {
    problems.push('states a numeric value, which is checked in code');
  }
  if (count) {
    problems.push('contains a count or quantity');
  }
  if (date) {
    problems.push('contains a date or time');
  }
  return problems;
}

function lintL2(script: TestScript): LintFinding[] {
  const findings: LintFinding[] = [];
  const check = (stepId: string, path: string, statement: string) => {
    const problems = noulStatementProblems(statement);
    if (problems.length > 0) {
      findings.push(
        finding(
          'L2',
          stepId,
          path,
          `Noul statement ${JSON.stringify(statement)} ${problems.join('; ')}.`,
        ),
      );
    }
  };
  for (const { step, path } of actionSteps(script)) {
    (step.expect ?? []).forEach((expectation, index) => {
      if (expectation.kind === 'noul') {
        check(step.id, `${path}/expect/${index}/statement`, expectation.statement);
      }
    });
  }
  (script.handlers ?? []).forEach((handler, index) => {
    if (handler.when.kind === 'noul') {
      check(handler.id, `/handlers/${index}/when/statement`, handler.when.statement);
    }
  });
  return findings;
}

// ---------------------------------------------------------------------------
// L3: no inline secret values; password fields take ${secret.*} only
// ---------------------------------------------------------------------------

const PASSWORD_FIELD = /\b(password|passwd|passcode|passphrase|pwd|pin)\b/i;
const PURE_SECRET = /^\$\{secret\.[A-Za-z_][A-Za-z0-9_]*\}$/;
const SENSITIVE_HEADER =
  /^(authorization|proxy-authorization|cookie|x-api-key|api-key)$|token|secret|password|api[-_]?key/i;
const SENSITIVE_KEY =
  /^(password|passwd|pwd|passcode|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key)$/i;
const CREDENTIAL_PATTERNS: readonly [RegExp, string][] = [
  [/\b(sk|rk)-[A-Za-z0-9_-]{16,}/, 'an API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'a GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./, 'a JSON Web Token'],
  [/\b(Bearer|Basic)\s+(?!\$\{)[A-Za-z0-9._~+/=-]{8,}/, 'a literal bearer or basic credential'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/^[a-z][a-z0-9+.-]*:\/\/[^/@\s:]+:[^/@\s]+@/i, 'credentials in a URL'],
];

/** Where `${secret.*}` may appear: fill values and the headers and body of `http`. */
const SECRET_ALLOWED_PATH =
  /^(\/steps\/[0-9]+|\/handlers\/[0-9]+\/steps\/[0-9]+)\/action\/(value|request\/headers\/[^/]+|request\/body|request\/json(\/.*)?)$/;

function isTemplatedOnly(value: string): boolean {
  const rest = value
    .replace(/\$\{(env|var|secret)\.[A-Za-z_][A-Za-z0-9_]*\}/g, '')
    .replace(/^\s*(Bearer|Basic|Token)\s*/i, '')
    .trim();
  return rest === '';
}

interface StringVisit {
  value: string;
  path: string;
  /** Name of the member holding the string, when it is an object member. */
  key: string | null;
}

function visitStrings(value: unknown, path: string, key: string | null, out: StringVisit[]): void {
  if (typeof value === 'string') {
    out.push({ value, path, key });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visitStrings(item, `${path}/${index}`, null, out);
    });
  } else if (typeof value === 'object' && value !== null) {
    for (const [member, child] of Object.entries(value)) {
      const escaped = member.replace(/~/g, '~0').replace(/\//g, '~1');
      visitStrings(child, `${path}/${escaped}`, member, out);
    }
  }
}

/** Step or handler id owning a JSON Pointer inside the script, or null. */
export function ownerIdAt(script: TestScript, path: string): string | null {
  const handlerStep = /^\/handlers\/([0-9]+)\/steps\/([0-9]+)(\/|$)/.exec(path);
  if (handlerStep !== null) {
    return script.handlers?.[Number(handlerStep[1])]?.steps[Number(handlerStep[2])]?.id ?? null;
  }
  const handler = /^\/handlers\/([0-9]+)(\/|$)/.exec(path);
  if (handler !== null) {
    return script.handlers?.[Number(handler[1])]?.id ?? null;
  }
  const step = /^\/steps\/([0-9]+)(\/|$)/.exec(path);
  if (step !== null) {
    return script.steps[Number(step[1])]?.id ?? null;
  }
  return null;
}

function lintL3(script: TestScript): LintFinding[] {
  const findings: LintFinding[] = [];
  const declared = new Set(script.secrets ?? []);
  const flagged = new Set<string>();
  const add = (path: string, message: string) => {
    if (flagged.has(path)) return;
    flagged.add(path);
    findings.push(finding('L3', ownerIdAt(script, path), path, message));
  };

  const strings: StringVisit[] = [];
  visitStrings(script, '', null, strings);
  for (const { value, path, key } of strings) {
    for (const reference of templateReferences(value)) {
      if (reference.scope !== 'secret') continue;
      if (!declared.has(reference.name)) {
        add(path, `Secret ${reference.name} is used but not declared in secrets.`);
      } else if (!SECRET_ALLOWED_PATH.test(path)) {
        add(
          path,
          `Secret ${reference.name} may appear only in a fill value or an http header or body.`,
        );
      }
    }
    for (const [pattern, what] of CREDENTIAL_PATTERNS) {
      if (pattern.test(value)) {
        add(path, `Value contains ${what}; use \${secret.NAME} instead.`);
      }
    }
    if (
      key !== null &&
      /\/action\/request\/headers\/[^/]+$/.test(path) &&
      SENSITIVE_HEADER.test(key)
    ) {
      if (!isTemplatedOnly(value)) {
        add(path, `Header ${key} carries a literal credential; use \${secret.NAME}.`);
      }
    }
    if (
      key !== null &&
      (/\/action\/request\/json(\/|$)/.test(path) || path.startsWith('/variables/')) &&
      SENSITIVE_KEY.test(key) &&
      value !== '' &&
      !isTemplatedOnly(value)
    ) {
      add(path, `Member ${key} holds a literal secret value; use \${secret.NAME}.`);
    }
  }

  for (const { step, path } of actionSteps(script)) {
    const action = step.action;
    if (action.type !== 'fill') continue;
    const target = action.target;
    const hints = target.hints ?? {};
    const describesPassword = [
      target.description,
      hints.label,
      hints.text,
      hints.testId,
      hints.role,
    ].some((text) => text !== undefined && PASSWORD_FIELD.test(text.replace(/[_-]/g, ' ')));
    if (describesPassword && !PURE_SECRET.test(action.value)) {
      add(`${path}/action/value`, 'A password field must be filled with ${secret.NAME} only.');
    }
  }
  return findings.sort((a, b) => comparePaths(a.path, b.path));
}

/** Orders JSON Pointers by document position (numeric segments compare as numbers). */
function comparePaths(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const x = left[index] ?? '';
    const y = right[index] ?? '';
    if (x === y) continue;
    const bothNumeric = /^[0-9]+$/.test(x) && /^[0-9]+$/.test(y);
    return bothNumeric ? Number(x) - Number(y) : x < y ? -1 : 1;
  }
  return left.length - right.length;
}

// ---------------------------------------------------------------------------
// L4: URLs are relative or inside the allow-lists
// ---------------------------------------------------------------------------

const ENV_PREFIX = /^\$\{env\.[A-Za-z_][A-Za-z0-9_]*\}/;
/**
 * What may follow a leading `${env.NAME}`: nothing, or the path, query or fragment. Any
 * other character (`@`, `.`, `:`, a letter, another template) extends the environment's
 * authority, so the script author, not the environment, would pick the host.
 */
const AFTER_ENV_PREFIX = /^(?:[/?#]|$)/;
/** Start of a template (`${env.*}`, `${var.*}`, `${secret.*}`) or of anything like one. */
const TEMPLATE_START = '${';
/** A prefix that already closes an absolute URL's authority: scheme, host, then / \ ? #. */
const CLOSED_ABSOLUTE = /^[A-Za-z][A-Za-z0-9+.-]*:[/\\]*[^/\\?#]+[/\\?#]/;
/**
 * A prefix that keeps a relative URL on the page's origin whatever follows: one leading
 * slash and a path character, a path segment without a colon and its slash, or a query
 * or fragment.
 */
const CLOSED_RELATIVE = /^(?:[/\\][^/\\]|[^/\\?#:]+[/\\?#]|[?#])/;

/**
 * Bases a URL is resolved against, one per scheme the page may have. A URL is relative
 * only when it stays on the base's origin for each of them and does not parse on its
 * own; every other origin it can reach is checked. So a URL that a browser treats as
 * protocol-relative (`\\evil.com`, `/\evil.com`, ` //evil.com`, a tab before `//`) or
 * that changes meaning with the base (`https:evil.com`) is judged by where it can lead.
 */
const SENTINEL_BASES: Readonly<Record<'https:' | 'http:', string>> = {
  'https:': 'https://relative-a.invalid',
  'http:': 'http://relative-b.invalid',
};
const ALL_SENTINELS = Object.values(SENTINEL_BASES);

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.toLowerCase().replace(/\/+$/, '');
  }
}

interface ParsedUrl {
  kind: 'relative' | 'environment' | 'absolute' | 'invalid';
  /** Every absolute URL the text can resolve to (kind `absolute`). */
  urls?: URL[];
  problem?: string;
}

function parseUrl(text: string, base?: string): URL | undefined {
  try {
    return base === undefined ? new URL(text) : new URL(text, base);
  } catch {
    return undefined;
  }
}

/**
 * The WHATWG URL parser's input preprocessing: leading and trailing C0 controls and
 * spaces are stripped, and tabs and newlines are removed everywhere.
 */
function preprocessUrl(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').replace(/[\t\n\r]/g, '');
}

function classifyUrl(text: string, bases: readonly string[] = ALL_SENTINELS): ParsedUrl {
  const input = preprocessUrl(text);
  const environment = ENV_PREFIX.exec(input);
  if (environment !== null) {
    if (!AFTER_ENV_PREFIX.test(input.slice(environment[0].length))) {
      return {
        kind: 'invalid',
        problem: `the text after ${environment[0]} can change its host; continue with /, ? or #`,
      };
    }
    return { kind: 'environment' };
  }
  // A template before the authority is closed (`${var.dest}`, `/${var.x}`,
  // `https://${var.host}/`, `https://sim.test${var.x}`) lets its value pick the origin:
  // variables are set by the script or by extract steps, not by the environment.
  const template = input.indexOf(TEMPLATE_START);
  if (template >= 0) {
    const prefix = input.slice(0, template);
    if (!CLOSED_ABSOLUTE.test(prefix) && !CLOSED_RELATIVE.test(prefix)) {
      return {
        kind: 'invalid',
        problem:
          'a template decides where it leads; templates may appear only in the path, query or fragment',
      };
    }
  }
  const urls: URL[] = [];
  const standalone = parseUrl(text);
  if (standalone !== undefined) urls.push(standalone);
  for (const base of bases) {
    const resolved = parseUrl(text, base);
    if (resolved === undefined) {
      return { kind: 'invalid', problem: 'it is not a valid URL' };
    }
    if (resolved.origin !== new URL(base).origin) urls.push(resolved);
  }
  if (urls.length === 0) {
    return { kind: 'relative' };
  }
  for (const url of urls) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { kind: 'invalid', problem: `scheme ${url.protocol} is not allowed` };
    }
    if (/[${}]|%7b|%7d/i.test(url.host)) {
      return { kind: 'invalid', problem: 'its host comes from a variable' };
    }
  }
  const unique = new Map(urls.map((url) => [url.host, url]));
  return { kind: 'absolute', urls: [...unique.values()] };
}

function lintL4(script: TestScript, context: LintContext): LintFinding[] {
  const findings: LintFinding[] = [];
  const origins = new Set(context.allowedOrigins.map(normalizeOrigin));
  const hosts = new Set(context.allowedHttpHosts.map((host) => host.toLowerCase()));

  // A navigation resolves against the page, whose scheme is the base URL's when it is known.
  const baseScheme = parseUrl(script.target.baseUrl)?.protocol;
  const pageBases =
    baseScheme === 'https:' || baseScheme === 'http:'
      ? [SENTINEL_BASES[baseScheme]]
      : ALL_SENTINELS;

  const checkOrigin = (
    stepId: string | null,
    path: string,
    text: string,
    what: string,
    bases: readonly string[],
  ) => {
    const parsed = classifyUrl(text, bases);
    if (parsed.kind === 'invalid') {
      findings.push(
        finding(
          'L4',
          stepId,
          path,
          `${what} ${JSON.stringify(text)} is rejected: ${parsed.problem ?? ''}.`,
        ),
      );
    } else if (parsed.kind === 'absolute') {
      const outside = (parsed.urls ?? []).find((url) => !origins.has(url.origin));
      if (outside !== undefined) {
        findings.push(
          finding(
            'L4',
            stepId,
            path,
            `${what} ${JSON.stringify(text)} leaves the origin allow-list (${outside.origin}).`,
          ),
        );
      }
    }
  };

  const baseUrl = script.target.baseUrl;
  if (classifyUrl(baseUrl).kind === 'relative') {
    findings.push(
      finding(
        'L4',
        null,
        '/target/baseUrl',
        `Base URL ${JSON.stringify(baseUrl)} must be absolute or \${env.NAME}.`,
      ),
    );
  } else {
    checkOrigin(null, '/target/baseUrl', baseUrl, 'Base URL', ALL_SENTINELS);
  }

  for (const { step, path } of actionSteps(script)) {
    const action = step.action;
    if (action.type === 'navigate') {
      checkOrigin(step.id, `${path}/action/url`, action.url, 'Navigation URL', pageBases);
    } else if (action.type === 'http') {
      const text = action.request.url;
      const urlPath = `${path}/action/request/url`;
      const parsed = classifyUrl(text);
      if (parsed.kind === 'relative') {
        findings.push(
          finding(
            'L4',
            step.id,
            urlPath,
            `HTTP URL ${JSON.stringify(text)} must be absolute or start with \${env.NAME}.`,
          ),
        );
      } else if (parsed.kind === 'invalid') {
        findings.push(
          finding(
            'L4',
            step.id,
            urlPath,
            `HTTP URL ${JSON.stringify(text)} is rejected: ${parsed.problem ?? ''}.`,
          ),
        );
      } else if (parsed.kind === 'absolute') {
        const outside = (parsed.urls ?? []).find(
          ({ host, hostname, port }) =>
            !hosts.has(host.toLowerCase()) && !(port === '' && hosts.has(hostname.toLowerCase())),
        );
        if (outside !== undefined) {
          findings.push(
            finding('L4', step.id, urlPath, `HTTP host ${outside.host} is not in the allow-list.`),
          );
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// L5: critical verbs force risk: critical
// ---------------------------------------------------------------------------

/** Inflected forms of a verb: stop, stops, stopped, stopping; purge, purging; ... */
export function verbForms(verb: string): Set<string> {
  const v = verb.toLowerCase();
  const forms = new Set([v, `${v}s`, `${v}es`, `${v}d`, `${v}ed`, `${v}ing`]);
  const last = v.at(-1) ?? '';
  if (/[bcdfgklmnprstvz]/.test(last)) {
    forms.add(`${v}${last}ed`);
    forms.add(`${v}${last}ing`);
  }
  if (v.endsWith('e')) {
    forms.add(`${v.slice(0, -1)}ing`);
  }
  if (v.endsWith('y')) {
    forms.add(`${v.slice(0, -1)}ies`);
    forms.add(`${v.slice(0, -1)}ied`);
  }
  return forms;
}

function lintL5(script: TestScript, context: LintContext): LintFinding[] {
  const findings: LintFinding[] = [];
  const verbs = context.criticalVerbs.map((verb) => ({ verb, forms: verbForms(verb) }));
  for (const { step, path } of actionSteps(script)) {
    if (step.risk === 'critical') continue;
    const tokens = words(step.intent);
    const hit = verbs.find(({ forms }) => tokens.some((token) => forms.has(token)));
    if (hit !== undefined) {
      findings.push(
        finding(
          'L5',
          step.id,
          `${path}/risk`,
          `Intent ${JSON.stringify(step.intent)} uses the critical verb "${hit.verb}"; the step must carry risk: critical.`,
        ),
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// L6: within at most 120 s; the worst case fits the run timeout
// ---------------------------------------------------------------------------

function windowOf(step: Step): number {
  if (!isActionStep(step) || step.within === undefined) return DEFAULT_WITHIN_MS;
  const parsed = parseDuration(step.within);
  return parsed.ok ? parsed.value : DEFAULT_WITHIN_MS;
}

function lintL6(script: TestScript, context: LintContext): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const { step, path } of actionSteps(script)) {
    if (step.within === undefined) continue;
    const parsed = parseDuration(step.within);
    if (!parsed.ok) {
      findings.push(finding('L6', step.id, `${path}/within`, parsed.error));
    } else if (parsed.value > MAX_WITHIN_MS) {
      findings.push(
        finding(
          'L6',
          step.id,
          `${path}/within`,
          `within ${step.within} exceeds the maximum of 120s.`,
        ),
      );
    }
  }
  let total = 0;
  for (const [index, step] of script.steps.entries()) {
    total += windowOf(step);
    if (total > context.runTimeoutMs) {
      findings.push(
        finding(
          'L6',
          step.id,
          `/steps/${index}`,
          `Worst-case duration reaches ${total} ms at step ${step.id}, beyond the run timeout of ${context.runTimeoutMs} ms.`,
        ),
      );
      break;
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// L7: unique baselines; every mask has a description or a rectangle; blink ranges not empty
// ---------------------------------------------------------------------------

function lintL7(script: TestScript): LintFinding[] {
  const findings: LintFinding[] = [];
  const baselines = new Map<string, string>();
  for (const { step, path } of actionSteps(script)) {
    (step.expect ?? []).forEach((expectation: Expectation, index) => {
      const expectPath = `${path}/expect/${index}`;
      if (expectation.kind === 'blink' && 'minHz' in expectation) {
        if (expectation.minHz > expectation.maxHz) {
          findings.push(
            finding(
              'L7',
              step.id,
              `${expectPath}/minHz`,
              `Blink range ${expectation.minHz}-${expectation.maxHz} Hz is empty: minHz exceeds maxHz.`,
            ),
          );
        }
        return;
      }
      if (expectation.kind !== 'visual') return;
      const owner = baselines.get(expectation.baseline);
      if (owner !== undefined) {
        findings.push(
          finding(
            'L7',
            step.id,
            `${expectPath}/baseline`,
            `Baseline ${expectation.baseline} is already used by step ${owner}.`,
          ),
        );
      } else {
        baselines.set(expectation.baseline, step.id);
      }
      (expectation.masks ?? []).forEach((mask, maskIndex) => {
        const maskPath = `${expectPath}/masks/${maskIndex}`;
        if ('description' in mask && mask.description.trim() === '') {
          findings.push(
            finding('L7', step.id, `${maskPath}/description`, 'Mask description is blank.'),
          );
        } else if ('rect' in mask && (mask.rect.width === 0 || mask.rect.height === 0)) {
          findings.push(finding('L7', step.id, `${maskPath}/rect`, 'Mask rectangle is empty.'));
        }
      });
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// L8: unique step ids, stable across recompiles when the intent is unchanged
// ---------------------------------------------------------------------------

/** Intent as compared across versions: case, spacing and final punctuation ignored. */
export function normalizeIntent(intent: string): string {
  return intent
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?;:]+$/, '')
    .trim();
}

function intentKey(step: Step): string | null {
  if (isActionStep(step)) return normalizeIntent(step.intent);
  if (step.intent !== undefined) return normalizeIntent(step.intent);
  return `use:${step.use}`;
}

function lintL8(script: TestScript, context: LintContext): LintFinding[] {
  const findings: LintFinding[] = [];
  const seen = new Map<string, string>();
  const ids: { id: string; path: string }[] = [];
  allSteps({ steps: script.steps }).forEach(({ step, path }) => ids.push({ id: step.id, path }));
  (script.handlers ?? []).forEach((handler, handlerIndex) => {
    ids.push({ id: handler.id, path: `/handlers/${handlerIndex}` });
    handler.steps.forEach((step, index) => {
      ids.push({ id: step.id, path: `/handlers/${handlerIndex}/steps/${index}` });
    });
  });
  for (const { id, path } of ids) {
    const first = seen.get(id);
    if (first !== undefined) {
      findings.push(finding('L8', id, `${path}/id`, `Id ${id} is already used at ${first}.`));
    } else {
      seen.set(id, path);
    }
  }

  if (context.previous !== undefined) {
    const previous = new Map<string, string[]>();
    for (const { step } of allSteps(context.previous)) {
      const key = intentKey(step);
      if (key === null) continue;
      previous.set(key, [...(previous.get(key) ?? []), step.id]);
    }
    const occurrences = new Map<string, number>();
    for (const { step, path } of allSteps(script)) {
      const key = intentKey(step);
      if (key === null) continue;
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      const before = previous.get(key)?.[occurrence];
      if (before !== undefined && before !== step.id) {
        findings.push(
          finding(
            'L8',
            step.id,
            `${path}/id`,
            `Intent is unchanged from the previous version, where the step id was ${before}; keep ${before} so locator memory survives.`,
          ),
        );
      }
    }
  }
  return findings;
}
