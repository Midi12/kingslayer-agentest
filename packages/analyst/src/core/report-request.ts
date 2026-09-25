/**
 * The report request under its budget (ADR M07-budgets). The run facts (script, verdict,
 * flags, stats) and the ledger go in as data; key frames follow as images. Over budget,
 * units are dropped in this order: routine telemetry events (class 3), routine detail
 * events (class 2), key frames (last first), step events (class 1), each class oldest
 * first. Class 0 events are never dropped; a request that still does not fit is not
 * sent.
 */
import { err, ok, type ReportInput, type Result } from '@argus/contracts';
import type { LlmRequest } from '../ports/llm.js';
import type { ScaledImage } from '../ports/images.js';
import type { AnalystLimits } from './budgets.js';
import { dataBlock, ndjsonBlock } from './data-block.js';
import { eventDropClasses, ledgerEvents, ledgerLines, orderedEvents } from './ledger.js';
import { renderSection, type PromptTemplate } from './prompt-template.js';
import { providerSchema } from './provider-schema.js';
import { ReportDraft } from './report.js';
import { estimateLlmRequest, sizesOf, toRequest, userMessage } from './request.js';
import type { BuiltRequest } from './triage-request.js';

export interface ReportKeyFrame {
  readonly ref: string;
  readonly stepId: string | null;
  readonly scaled: ScaledImage;
}

export interface ReportOmissions {
  readonly events: number;
  readonly keyFrames: number;
}

/** The draft schema with step ids narrowed to the script's. */
export function reportAnswerSchema(input: ReportInput): Record<string, unknown> {
  const schema = providerSchema(JSON.parse(JSON.stringify(ReportDraft)) as unknown);
  const steps = input.script.steps.map((step) => step.id);
  const stepEnum = steps.length === 0 ? { type: 'string' } : { type: 'string', enum: steps };
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  for (const key of ['defects', 'adjudications', 'maintenance'] as const) {
    const items = properties[key]?.items as { properties?: Record<string, unknown> } | undefined;
    if (items?.properties !== undefined) {
      items.properties.stepId =
        key === 'maintenance' ? { anyOf: [stepEnum, { type: 'null' }] } : stepEnum;
    }
  }
  return schema;
}

export interface ReportRequestOptions {
  readonly model: string;
  readonly template: PromptTemplate;
  readonly limits: AnalystLimits;
  readonly temperature?: number | undefined;
}

type Unit =
  | { readonly kind: 'event'; readonly position: number }
  | { readonly kind: 'frame'; readonly index: number };

export function buildReportRequest(
  input: ReportInput,
  keyFrames: readonly ReportKeyFrame[],
  options: ReportRequestOptions,
): Result<BuiltRequest<ReportOmissions>, string> {
  const { limits, template } = options;
  const budget = limits.reportTokenBudget - limits.repairReserveTokens;
  const system = renderSection(template, 'system', {});
  const schema = { name: 'run_report', schema: reportAnswerSchema(input) };
  const frames = keyFrames.slice(0, limits.reportMaxKeyFrames);
  const sizes = sizesOf(frames.map((frame) => frame.scaled));
  const ordered = orderedEvents(ledgerEvents(input));
  const run = dataBlock('run', {
    runId: input.runId,
    script: input.script,
    verdict: input.verdict,
    flags: input.flags,
    stats: input.stats,
  });
  const classes = eventDropClasses(ordered);
  const units: Unit[] = [
    ...classes.telemetry.map((position) => ({ kind: 'event' as const, position })),
    ...classes.detail.map((position) => ({ kind: 'event' as const, position })),
    ...frames.map((_, index) => ({ kind: 'frame' as const, index })).reverse(),
    ...classes.steps.map((position) => ({ kind: 'event' as const, position })),
  ];

  const render = (k: number): { request: LlmRequest; tokens: number; omitted: ReportOmissions } => {
    const droppedEvents = new Set<number>();
    const droppedFrames = new Set<number>();
    for (const unit of units.slice(0, k)) {
      if (unit.kind === 'event') droppedEvents.add(unit.position);
      else droppedFrames.add(unit.index);
    }
    const text = renderSection(template, 'user', {
      'data:run': run,
      'data:ledger': ndjsonBlock('ledger', ledgerLines(ordered, droppedEvents)),
    });
    const images = frames
      .filter((_, i) => !droppedFrames.has(i))
      .map((frame) => ({ label: { ref: frame.ref, stepId: frame.stepId }, scaled: frame.scaled }));
    const request = toRequest({
      model: options.model,
      system,
      messages: [userMessage(text, images)],
      jsonSchema: schema,
      maxTokens: limits.reportMaxOutputTokens,
      timeoutMs: limits.reportTimeoutMs,
      temperature: options.temperature,
    });
    return {
      request,
      tokens: estimateLlmRequest(request, sizes),
      omitted: {
        events: droppedEvents.size,
        keyFrames: droppedFrames.size + (keyFrames.length - frames.length),
      },
    };
  };

  const none = render(0);
  if (none.tokens <= budget) {
    return ok({ request: none.request, estimatedTokens: none.tokens, omitted: none.omitted });
  }
  const all = render(units.length);
  if (all.tokens > budget) {
    return err(
      `the report request needs about ${String(all.tokens)} tokens with only the run outline; the budget is ${String(budget)}`,
    );
  }
  // Smallest k found by bisection; render(hi) always fits.
  let lo = 0;
  let hi = units.length;
  let best = all;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = render(mid);
    if (candidate.tokens <= budget) {
      hi = mid;
      best = candidate;
    } else {
      lo = mid;
    }
  }
  return ok({ request: best.request, estimatedTokens: best.tokens, omitted: best.omitted });
}
