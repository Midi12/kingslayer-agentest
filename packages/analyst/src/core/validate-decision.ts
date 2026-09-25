/**
 * `validateDecision(packet, candidate)`: code validates every Analyst answer before
 * anything acts on it (Architecture and contracts, "AnalystDecision"; ADR
 * M07-decision-matrix). The candidate is untrusted JSON: it is checked against the
 * `AnalystDecision` schema first, then against the packet's closed menus.
 */
import {
  err,
  ok,
  validate,
  type AnalystDecision,
  type BreakPacket,
  type PatchAction,
  type Result,
} from '@argus/contracts';
import { allowedDecisions } from './matrix.js';

export const DECISION_RULES = [
  'schema',
  'menu',
  'matrix',
  'patch-required',
  'patch-forbidden',
  'patch-action',
  'patch-budget',
  'patch-origin',
  'patch-template',
  'resolve-target',
  'evidence',
  'defect',
] as const;
export type DecisionRule = (typeof DECISION_RULES)[number];

export interface DecisionIssue {
  /** JSON Pointer into the answer; empty for the root. */
  readonly path: string;
  readonly rule: DecisionRule;
  readonly message: string;
}

/** `path: message`, the form the repair prompt carries. */
export function formatIssue(issue: DecisionIssue): string {
  return `${issue.path === '' ? '/' : issue.path}: ${issue.message} [${issue.rule}]`;
}

function normalisedOrigins(origins: readonly string[]): string[] {
  const out: string[] = [];
  for (const origin of origins) {
    try {
      out.push(new URL(origin).origin);
    } catch {
      // An origin that does not parse allows nothing.
    }
  }
  return out;
}

/** A scheme at the start of a URL (RFC 3986 `scheme ":"`). */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** The only absolute form accepted: `http://` or `https://`, whose parse needs no base. */
const HTTP_ABSOLUTE = /^https?:\/\//i;
/**
 * Characters the URL parser strips or rewrites before parsing (C0 controls, space, DEL)
 * and the backslash, which special schemes read as `/`. A URL holding one can mean
 * something other than it shows (`/\\host`, `\t//host`), so none is accepted.
 */
// eslint-disable-next-line no-control-regex
const AMBIGUOUS_CHARS = /[\u0000-\u001f\u007f\\]/;

/**
 * True when `url` stays inside `origins` whatever base the runner resolves it against,
 * as long as that base is a page of an allowed origin:
 *
 * - an absolute URL must be written `http://…` or `https://…` (never `https:host`, whose
 *   meaning depends on the base's scheme), carry no credentials, and have an allowed
 *   origin;
 * - any other scheme (`javascript:`, `data:`, `https:host`) is refused;
 * - a relative URL must not start with `//` and must resolve, against every allowed
 *   origin, to that same origin;
 * - leading or trailing spaces, control characters and backslashes are refused.
 */
export function staysInsideOrigins(url: string, origins: readonly string[]): boolean {
  const allowed = normalisedOrigins(origins);
  if (allowed.length === 0 || url.trim() !== url || AMBIGUOUS_CHARS.test(url)) {
    return false;
  }
  const inside = (parsed: URL): boolean =>
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.username === '' &&
    parsed.password === '';
  if (SCHEME.test(url)) {
    if (!HTTP_ABSOLUTE.test(url)) {
      return false;
    }
    try {
      const parsed = new URL(url);
      return inside(parsed) && allowed.includes(parsed.origin);
    } catch {
      return false;
    }
  }
  if (url.startsWith('//')) {
    return false;
  }
  return allowed.every((base) => {
    try {
      const parsed = new URL(url, base);
      return inside(parsed) && parsed.origin === base;
    } catch {
      return false;
    }
  });
}

function templateStrings(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'string') {
    if (value.includes('${')) {
      out.push(path);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      templateStrings(item, `${path}/${String(index)}`, out);
    });
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      templateStrings(item, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, out);
    }
  }
}

/** URLs a patch action would load: navigate targets and http requests. */
function actionUrls(action: PatchAction): string[] {
  if (action.type === 'navigate') {
    return [action.url];
  }
  if (action.type === 'http') {
    return [action.request.url];
  }
  return [];
}

function checkPatch(packet: BreakPacket, decision: AnalystDecision, issues: DecisionIssue[]): void {
  const patch = decision.patch ?? [];
  if (decision.decision !== 'PATCH') {
    if (patch.length > 0) {
      issues.push({
        path: '/patch',
        rule: 'patch-forbidden',
        message: `patch actions are allowed only with decision PATCH, not ${decision.decision}`,
      });
    }
    return;
  }
  if (patch.length === 0) {
    issues.push({
      path: '/patch',
      rule: 'patch-required',
      message: 'decision PATCH needs at least one patch action',
    });
    return;
  }
  const max = packet.budget.patchActionsMax;
  if (patch.length > max) {
    issues.push({
      path: '/patch',
      rule: 'patch-budget',
      message: `${String(patch.length)} patch actions exceed the budget of ${String(max)}`,
    });
  }
  const allowedTypes: readonly string[] = packet.allowed.patchActions;
  patch.forEach((action, index) => {
    const path = `/patch/${String(index)}`;
    if (!allowedTypes.includes(action.type)) {
      issues.push({
        path: `${path}/type`,
        rule: 'patch-action',
        message: `patch action ${action.type} is not allowed; allowed: ${allowedTypes.join(', ') || 'none'}`,
      });
    }
    for (const url of actionUrls(action)) {
      if (!staysInsideOrigins(url, packet.allowed.origins)) {
        issues.push({
          path: action.type === 'navigate' ? `${path}/url` : `${path}/request/url`,
          rule: 'patch-origin',
          message: `${JSON.stringify(url.slice(0, 200))} leaves the allowed origins (${packet.allowed.origins.join(', ') || 'none'})`,
        });
      }
    }
    const templated: string[] = [];
    templateStrings(action, path, templated);
    for (const location of templated) {
      issues.push({
        path: location,
        rule: 'patch-template',
        message: 'patch values are literal; ${...} templates are not allowed',
      });
    }
  });
}

function checkResolveTarget(
  packet: BreakPacket,
  decision: AnalystDecision,
  issues: DecisionIssue[],
): void {
  if (decision.decision !== 'RESOLVE_TARGET') {
    if (decision.resolveTarget !== undefined) {
      issues.push({
        path: '/resolveTarget',
        rule: 'resolve-target',
        message: `resolveTarget is allowed only with decision RESOLVE_TARGET, not ${decision.decision}`,
      });
    }
    return;
  }
  const cids = (packet.candidates ?? []).map((candidate) => candidate.cid);
  if (decision.resolveTarget === undefined) {
    issues.push({
      path: '/resolveTarget',
      rule: 'resolve-target',
      message: 'decision RESOLVE_TARGET needs resolveTarget.cid',
    });
  } else if (!cids.includes(decision.resolveTarget.cid)) {
    issues.push({
      path: '/resolveTarget/cid',
      rule: 'resolve-target',
      message: `${decision.resolveTarget.cid} is not a candidate of the packet; candidates: ${cids.join(', ') || 'none'}`,
    });
  }
}

function checkEvidence(
  packet: BreakPacket,
  decision: AnalystDecision,
  issues: DecisionIssue[],
): void {
  const frames = new Set(packet.frames.map((frame) => frame.ref));
  decision.evidence.forEach((evidence, index) => {
    const path = `/evidence/${String(index)}`;
    if (evidence.frame !== undefined && !frames.has(evidence.frame)) {
      issues.push({
        path: `${path}/frame`,
        rule: 'evidence',
        message: `frame ${evidence.frame} is not in the packet`,
      });
    }
    if (evidence.observation !== undefined && packet.observations[evidence.observation] === null) {
      issues.push({
        path: `${path}/observation`,
        rule: 'evidence',
        message: `the packet has no ${evidence.observation} observation`,
      });
    }
    const indexed = [
      ['check', evidence.check, packet.signals.checks.length],
      ['console', evidence.console, packet.console.length],
      ['network', evidence.network, packet.network.length],
    ] as const;
    for (const [kind, value, length] of indexed) {
      if (value !== undefined && value >= length) {
        issues.push({
          path: `${path}/${kind}`,
          rule: 'evidence',
          message: `${kind} ${String(value)} is not in the packet, which has ${String(length)}`,
        });
      }
    }
  });
}

/**
 * The decision when it is valid for the packet, otherwise every issue found. A schema
 * failure stops the check there, since the menu rules need a well-formed decision.
 */
export function validateDecision(
  packet: BreakPacket,
  candidate: unknown,
): Result<AnalystDecision, DecisionIssue[]> {
  const shaped = validate('AnalystDecision', candidate);
  if (!shaped.ok) {
    return err(
      shaped.error.map((error) => ({ path: error.path, rule: 'schema', message: error.message })),
    );
  }
  const decision = shaped.value;
  const issues: DecisionIssue[] = [];
  if (!packet.allowed.decisions.includes(decision.decision)) {
    issues.push({
      path: '/decision',
      rule: 'menu',
      message: `${decision.decision} is not in the menu; allowed: ${packet.allowed.decisions.join(', ')}`,
    });
  }
  const matrix = allowedDecisions(
    packet.reason,
    { strict: false },
    { critical: packet.script.step.risk === 'critical' },
  );
  if (!matrix.includes(decision.decision)) {
    issues.push({
      path: '/decision',
      rule: 'matrix',
      message: `${decision.decision} is never allowed for ${packet.reason}${packet.script.step.risk === 'critical' ? ' on a critical step' : ''}`,
    });
  }
  checkPatch(packet, decision, issues);
  checkResolveTarget(packet, decision, issues);
  checkEvidence(packet, decision, issues);
  if (
    (decision.decision === 'MARK_FAILED_CONTINUE' || decision.decision === 'MARK_FAILED_ABORT') &&
    decision.classification === 'PRODUCT_DEFECT' &&
    (decision.defect === undefined || decision.defect === null)
  ) {
    issues.push({
      path: '/defect',
      rule: 'defect',
      message: `${decision.decision} with PRODUCT_DEFECT needs a defect (title, severity, expected, actual)`,
    });
  }
  return issues.length === 0 ? ok(decision) : err(issues);
}
