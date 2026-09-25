/**
 * The triage request under its budget (ADR M07-budgets). The packet is rendered as one
 * data block; when the estimate exceeds the budget, whole records are dropped in a fixed
 * order and counted in `omitted`, never cut: low-level console lines, passing checks,
 * older step intents, successful requests, warnings, the before page, frames beyond the
 * minimum (farthest first), console errors, failed requests, the after page, and last
 * the failing checks.
 */
import { err, ok, type BreakFrame, type BreakPacket, type Result } from '@argus/contracts';
import type { LlmRequest } from '../ports/llm.js';
import type { ScaledImage } from '../ports/images.js';
import type { AnalystLimits } from './budgets.js';
import { dataBlock } from './data-block.js';
import { frameDropOrder } from './frames.js';
import { renderSection, type PromptTemplate } from './prompt-template.js';
import { triageAnswerSchema } from './provider-schema.js';
import { estimateLlmRequest, sizesOf, toRequest, userMessage } from './request.js';

export interface TriageFrame {
  readonly frame: BreakFrame;
  readonly scaled: ScaledImage;
}

export interface TriageOmissions {
  console: number;
  network: number;
  checks: number;
  previousIntents: number;
  frames: number;
  beforePage: boolean;
  afterPage: boolean;
}

export interface BuiltRequest<O> {
  readonly request: LlmRequest;
  readonly estimatedTokens: number;
  readonly omitted: O;
}

/** The decision menu as trusted text: only closed vocabularies and configured origins. */
export function renderMenu(packet: BreakPacket): string {
  const lines = [`- Decisions: ${packet.allowed.decisions.join(', ')}`];
  if (packet.allowed.decisions.includes('PATCH')) {
    lines.push(
      packet.allowed.patchActions.length === 0
        ? '- Patch actions: none, so PATCH cannot be used'
        : `- Patch actions: ${packet.allowed.patchActions.join(', ')}; at most ${String(packet.budget.patchActionsMax)} in one PATCH`,
    );
    lines.push(
      packet.allowed.origins.length === 0
        ? '- Navigation: not allowed'
        : `- Navigation only inside: ${packet.allowed.origins.join(', ')}`,
    );
  }
  if (packet.allowed.decisions.includes('RESOLVE_TARGET')) {
    lines.push('- RESOLVE_TARGET: give the cid of one candidate listed in the packet');
  }
  lines.push(
    `- Escalations left in this run after this one: ${String(Math.max(0, packet.budget.escalationsLeft - 1))}`,
  );
  return lines.join('\n');
}

type Unit =
  | { readonly kind: 'console' | 'network' | 'checks' | 'previousIntents'; readonly index: number }
  | { readonly kind: 'frame'; readonly ref: string }
  | { readonly kind: 'beforePage' | 'afterPage' };

/** The drop order of the module comment. */
function dropUnits(packet: BreakPacket, frames: readonly TriageFrame[], minFrames: number): Unit[] {
  const units: Unit[] = [];
  const consoleOf = (levels: readonly string[]): void => {
    packet.console.forEach((entry, index) => {
      if (levels.includes(entry.level)) units.push({ kind: 'console', index });
    });
  };
  const networkOf = (success: boolean): void => {
    packet.network.forEach((entry, index) => {
      const ok = entry.status >= 100 && entry.status < 400;
      if (ok === success) units.push({ kind: 'network', index });
    });
  };
  const checksOf = (passing: boolean): void => {
    packet.signals.checks.forEach((check, index) => {
      if ((check.outcome === 'pass') === passing) units.push({ kind: 'checks', index });
    });
  };
  consoleOf(['debug', 'info']);
  checksOf(true);
  const intents = packet.script.previousIntents.length;
  for (let index = 0; index < intents - 3; index++) units.push({ kind: 'previousIntents', index });
  networkOf(true);
  consoleOf(['warning']);
  if (packet.observations.before?.page !== undefined) units.push({ kind: 'beforePage' });
  for (const frame of frameDropOrder(
    frames.map((f) => f.frame),
    minFrames,
  )) {
    units.push({ kind: 'frame', ref: frame.ref });
  }
  consoleOf(['error']);
  networkOf(false);
  if (packet.observations.after?.page !== undefined) units.push({ kind: 'afterPage' });
  checksOf(false);
  return units;
}

interface Dropped {
  readonly console: Set<number>;
  readonly network: Set<number>;
  readonly checks: Set<number>;
  readonly previousIntents: Set<number>;
  readonly frames: Set<string>;
  beforePage: boolean;
  afterPage: boolean;
}

function omissions(dropped: Dropped): TriageOmissions {
  return {
    console: dropped.console.size,
    network: dropped.network.size,
    checks: dropped.checks.size,
    previousIntents: dropped.previousIntents.size,
    frames: dropped.frames.size,
    beforePage: dropped.beforePage,
    afterPage: dropped.afterPage,
  };
}

function withoutPage<T extends { page?: unknown }>(observation: T | null, drop: boolean): T | null {
  if (observation === null || !drop) return observation;
  const { page: _page, ...rest } = observation;
  return rest as T;
}

/** The packet as the model reads it: indices kept, the menu and budget left to the menu. */
function packetView(
  packet: BreakPacket,
  frames: readonly TriageFrame[],
  dropped: Dropped,
): unknown {
  const sent = new Set(
    frames.filter((f) => !dropped.frames.has(f.frame.ref)).map((f) => f.frame.ref),
  );
  return {
    runId: packet.runId,
    stepId: packet.stepId,
    attempt: packet.attempt,
    reason: packet.reason,
    script: {
      ...packet.script,
      previousIntents: packet.script.previousIntents.filter(
        (_, i) => !dropped.previousIntents.has(i),
      ),
    },
    signals: {
      jev: packet.signals.jev,
      checks: packet.signals.checks
        .map((check, index) => ({ index, ...check }))
        .filter(({ index }) => !dropped.checks.has(index)),
      actionError: packet.signals.actionError,
      elapsedMs: packet.signals.elapsedMs,
    },
    observations: {
      before: withoutPage(packet.observations.before, dropped.beforePage),
      after: withoutPage(packet.observations.after, dropped.afterPage),
    },
    frames: packet.frames.map((frame) => ({ ...frame, imageAttached: sent.has(frame.ref) })),
    console: packet.console
      .map((entry, index) => ({ index, ...entry }))
      .filter(({ index }) => !dropped.console.has(index)),
    network: packet.network
      .map((entry, index) => ({ index, ...entry }))
      .filter(({ index }) => !dropped.network.has(index)),
    candidates: packet.candidates ?? [],
    omitted: omissions(dropped),
  };
}

export interface TriageRequestOptions {
  readonly model: string;
  readonly template: PromptTemplate;
  readonly limits: AnalystLimits;
  readonly temperature?: number | undefined;
}

/**
 * The first triage request, estimated at most `triageTokenBudget - repairReserveTokens`
 * so the repair request fits the budget too; an error when even the reduced packet does
 * not fit. `frames` are the selected frames in time order.
 */
export function buildTriageRequest(
  packet: BreakPacket,
  frames: readonly TriageFrame[],
  options: TriageRequestOptions,
): Result<BuiltRequest<TriageOmissions>, string> {
  const { limits, template } = options;
  const budget = limits.triageTokenBudget - limits.repairReserveTokens;
  const system = renderSection(template, 'system', {});
  const schema = { name: 'analyst_decision', schema: triageAnswerSchema(packet) };
  const sizes = sizesOf(frames.map((frame) => frame.scaled));
  const menu = renderMenu(packet);
  const dropped: Dropped = {
    console: new Set(),
    network: new Set(),
    checks: new Set(),
    previousIntents: new Set(),
    frames: new Set(),
    beforePage: false,
    afterPage: false,
  };
  const render = (): { request: LlmRequest; tokens: number } => {
    const text = renderSection(template, 'user', {
      menu,
      'data:packet': dataBlock('packet', packetView(packet, frames, dropped)),
    });
    const images = frames
      .filter((frame) => !dropped.frames.has(frame.frame.ref))
      .map((frame) => ({
        label: { ref: frame.frame.ref, tMs: frame.frame.tMs },
        scaled: frame.scaled,
      }));
    const request = toRequest({
      model: options.model,
      system,
      messages: [userMessage(text, images)],
      jsonSchema: schema,
      maxTokens: limits.triageMaxOutputTokens,
      timeoutMs: limits.triageTimeoutMs,
      temperature: options.temperature,
    });
    return { request, tokens: estimateLlmRequest(request, sizes) };
  };
  let current = render();
  for (const unit of dropUnits(packet, frames, limits.triageMinFrames)) {
    if (current.tokens <= budget) break;
    switch (unit.kind) {
      case 'frame':
        dropped.frames.add(unit.ref);
        break;
      case 'beforePage':
        dropped.beforePage = true;
        break;
      case 'afterPage':
        dropped.afterPage = true;
        break;
      default:
        dropped[unit.kind].add(unit.index);
    }
    current = render();
  }
  if (current.tokens > budget) {
    return err(
      `the triage request needs about ${String(current.tokens)} tokens even reduced; the budget is ${String(budget)} (${String(limits.triageTokenBudget)} less ${String(limits.repairReserveTokens)} for a repair)`,
    );
  }
  return ok({
    request: current.request,
    estimatedTokens: current.tokens,
    omitted: omissions(dropped),
  });
}
