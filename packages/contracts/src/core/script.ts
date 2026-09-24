/**
 * Pure helpers over TestScripts: policy defaults, risk classes, template references and
 * a traversal of every step (handler steps included).
 */
import { READ_ONLY_ACTION_TYPES, RISK_CLASSES, type ActionType, type RiskClass } from './enums.js';
import type {
  Action,
  ActionStep,
  FragmentStep,
  Policy,
  ResolvedPolicy,
  Step,
  Target,
  TestScript,
} from './schemas/script.js';

/** Defaults of the optional policy fields. */
export const POLICY_DEFAULTS = {
  pii: 'standard',
  degrade: 'analyst',
  healApproval: 'manual',
} as const satisfies Pick<ResolvedPolicy, 'pii' | 'degrade' | 'healApproval'>;

/** A policy with every optional field set to its default. */
export function resolvePolicy(policy: Policy): ResolvedPolicy {
  return {
    strict: policy.strict,
    onBreak: policy.onBreak,
    failOnConsoleError: policy.failOnConsoleError,
    shareScreenshotsWithLlm: policy.shareScreenshotsWithLlm,
    artifacts: policy.artifacts,
    pii: policy.pii ?? POLICY_DEFAULTS.pii,
    degrade: policy.degrade ?? POLICY_DEFAULTS.degrade,
    healApproval: policy.healApproval ?? POLICY_DEFAULTS.healApproval,
  };
}

export function isActionStep(step: Step): step is ActionStep {
  return 'action' in step;
}

export function isFragmentStep(step: Step): step is FragmentStep {
  return 'use' in step;
}

const READ_ONLY = new Set<ActionType>(READ_ONLY_ACTION_TYPES);

/** True when a read-only (production) environment allows the action type. */
export function isReadOnlyAction(type: ActionType): boolean {
  return READ_ONLY.has(type);
}

/**
 * The risk class code assigns to an action: read for actions that change nothing
 * (navigate, hover, scroll, wait, assert, extract, and GET or HEAD requests), write for
 * everything else.
 */
export function riskForAction(action: Action): RiskClass {
  if (action.type === 'http') {
    return action.request.method === 'GET' || action.request.method === 'HEAD' ? 'read' : 'write';
  }
  return isReadOnlyAction(action.type) ? 'read' : 'write';
}

/** The higher of two risk classes. */
export function maxRisk(a: RiskClass, b: RiskClass): RiskClass {
  return RISK_CLASSES.indexOf(a) >= RISK_CLASSES.indexOf(b) ? a : b;
}

/** The risk a step runs with: its declared risk, never below the action's own class. */
export function effectiveRisk(step: ActionStep): RiskClass {
  const assigned = riskForAction(step.action);
  return step.risk === undefined ? assigned : maxRisk(step.risk, assigned);
}

/** Every target of an action, with its JSON Pointer relative to the action. */
export function actionTargets(action: Action): { target: Target; path: string }[] {
  switch (action.type) {
    case 'drag':
      return [
        { target: action.source, path: '/source' },
        { target: action.destination, path: '/destination' },
      ];
    case 'navigate':
    case 'wait':
    case 'assert':
    case 'http':
      return [];
    case 'press':
    case 'scroll':
      return action.target === undefined ? [] : [{ target: action.target, path: '/target' }];
    default:
      return [{ target: action.target, path: '/target' }];
  }
}

export interface StepVisit {
  step: Step;
  /** JSON Pointer of the step inside the script. */
  path: string;
  /** Handler the step belongs to, or null for a main step. */
  handlerId: string | null;
}

/** Main steps first, then each handler's steps, in document order. */
export function allSteps(script: Pick<TestScript, 'steps' | 'handlers'>): StepVisit[] {
  const visits: StepVisit[] = script.steps.map((step, index) => ({
    step,
    path: `/steps/${index}`,
    handlerId: null,
  }));
  (script.handlers ?? []).forEach((handler, handlerIndex) => {
    handler.steps.forEach((step, index) => {
      visits.push({
        step,
        path: `/handlers/${handlerIndex}/steps/${index}`,
        handlerId: handler.id,
      });
    });
  });
  return visits;
}

export type TemplateScope = 'env' | 'var' | 'secret';

export interface TemplateReference {
  scope: TemplateScope;
  name: string;
  /** The whole `${scope.NAME}` text. */
  text: string;
  index: number;
}

const TEMPLATE = /\$\{(env|var|secret)\.([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Template references in a string: `${env.NAME}` (environment values such as BASE_URL),
 * `${var.NAME}` (script variables and extracted values) and `${secret.NAME}`.
 */
export function templateReferences(text: string): TemplateReference[] {
  return [...text.matchAll(TEMPLATE)].map((match) => ({
    scope: match[1] as TemplateScope,
    name: match[2] ?? '',
    text: match[0],
    index: match.index,
  }));
}

/** Replaces template references; unknown ones stay as they are. */
export function resolveTemplates(
  text: string,
  lookup: (scope: TemplateScope, name: string) => string | undefined,
): string {
  return text.replace(TEMPLATE, (whole: string, scope: string, name: string) => {
    return lookup(scope as TemplateScope, name) ?? whole;
  });
}
