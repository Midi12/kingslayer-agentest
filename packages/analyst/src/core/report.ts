/**
 * The run report (Architecture and contracts, "RunReport"; ADR M07-report). The model
 * writes a draft: summary, defects, adjudications and maintenance suggestions. Code
 * checks the draft against the ledger, adds what code owns (defect ids and signatures,
 * heals, `generatedBy`) to make the `ReportBody`, and `buildRunReport` injects the
 * code-computed verdict, flags and stats. No schema the model answers to has a
 * `verdict`, `flags` or `stats` member, and every one is closed.
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  CLASSIFICATIONS,
  DEFECT_SEVERITIES,
  ReportAdjudication,
  ReportMaintenance,
  StepId,
  contentHash,
  err,
  normalizeIntent,
  ok,
  validate,
  validateAgainst,
  type BreakReason,
  type GeneratedBy,
  type ReportBody,
  type ReportHeal,
  type ReportInput,
  type Result,
  type RunFlags,
  type RunReport,
  type RunStats,
  type Verdict,
} from '@argus/contracts';
import { ledgerEvents, orderedEvents } from './ledger.js';

const literals = <T extends string>(values: readonly T[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));

export const ReportDraftDefect = Type.Object(
  {
    stepId: StepId,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    severity: literals(DEFECT_SEVERITIES),
    classification: literals(CLASSIFICATIONS),
  },
  { additionalProperties: false },
);

/** What the model returns for a report; internal to the Analyst. */
export const ReportDraft = Type.Object(
  {
    summary: Type.String({ minLength: 1, maxLength: 4000 }),
    defects: Type.Array(ReportDraftDefect, { maxItems: 500 }),
    adjudications: Type.Array(ReportAdjudication, { maxItems: 500 }),
    maintenance: Type.Array(ReportMaintenance, { maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type ReportDraft = Static<typeof ReportDraft>;

/**
 * A defect's signature: the hash of the normalised step intent, the break reason and the
 * top console error, which de-duplicates the defect across runs.
 */
export function defectSignature(input: {
  readonly intent: string;
  readonly reason: BreakReason | null;
  readonly topConsoleError: string | null;
}): string {
  return contentHash({
    intent: normalizeIntent(input.intent),
    reason: input.reason,
    consoleError: input.topConsoleError === null ? null : input.topConsoleError.trim(),
  });
}

interface LedgerFacts {
  /** Last `step.finished` outcome and reason per step. */
  readonly outcomes: Map<string, { outcome: string; reason: BreakReason | null }>;
  /** `stepId|decision` of every valid MARK_PASSED or RESOLVE_TARGET escalation. */
  readonly adjudicated: Set<string>;
}

function ledgerFacts(input: ReportInput): LedgerFacts {
  const outcomes = new Map<string, { outcome: string; reason: BreakReason | null }>();
  const adjudicated = new Set<string>();
  const ordered = orderedEvents(ledgerEvents(input));
  for (const event of ordered) {
    if (event.type === 'step.finished') {
      outcomes.set(event.stepId, { outcome: event.data.outcome, reason: event.data.reason });
    } else if (
      event.type === 'escalation.decided' &&
      event.data.valid &&
      event.data.decision !== null
    ) {
      adjudicated.add(`${event.stepId}|${event.data.decision}`);
    }
  }
  return { outcomes, adjudicated };
}

/** The draft checked against the ledger and completed into a `ReportBody`. */
export function assembleReportBody(
  draft: ReportDraft,
  input: ReportInput,
  generatedBy: GeneratedBy,
): Result<ReportBody, string[]> {
  const errors: string[] = [];
  const intents = new Map(input.script.steps.map((step) => [step.id, step.intent]));
  const facts = ledgerFacts(input);
  const defects = draft.defects.map((defect, index) => {
    const finished = facts.outcomes.get(defect.stepId);
    if (!intents.has(defect.stepId)) {
      errors.push(`/defects/${String(index)}/stepId: ${defect.stepId} is not a step of the script`);
    } else if (finished?.outcome !== 'failed') {
      errors.push(
        `/defects/${String(index)}/stepId: step ${defect.stepId} did not fail (${finished?.outcome ?? 'no outcome'}); report defects only for failed steps`,
      );
    }
    return {
      id: `def_${String(index + 1).padStart(2, '0')}`,
      stepId: defect.stepId,
      title: defect.title,
      severity: defect.severity,
      classification: defect.classification,
      signature: defectSignature({
        intent: intents.get(defect.stepId) ?? defect.stepId,
        reason: finished?.reason ?? null,
        topConsoleError: null,
      }),
    };
  });
  draft.adjudications.forEach((adjudication, index) => {
    if (!facts.adjudicated.has(`${adjudication.stepId}|${adjudication.decision}`)) {
      errors.push(
        `/adjudications/${String(index)}: the ledger has no valid ${adjudication.decision} escalation for step ${adjudication.stepId}`,
      );
    }
  });
  draft.maintenance.forEach((item, index) => {
    if (item.stepId !== null && !intents.has(item.stepId)) {
      errors.push(
        `/maintenance/${String(index)}/stepId: ${item.stepId} is not a step of the script`,
      );
    }
  });
  if (errors.length > 0) {
    return err(errors);
  }
  const body = {
    summary: draft.summary,
    defects,
    adjudications: draft.adjudications,
    heals: [],
    maintenance: draft.maintenance,
    generatedBy,
  };
  const checked = validate('ReportBody', body);
  return checked.ok
    ? ok(checked.value)
    : err(checked.error.map((error) => `${error.path || '/'}: ${error.message}`));
}

/** Validates a model answer as a report draft. */
export function readReportDraft(value: unknown): Result<ReportDraft, string[]> {
  const checked = validateAgainst<ReportDraft>(ReportDraft, value);
  return checked.ok
    ? ok(checked.value)
    : err(checked.error.map((error) => `${error.path || '/'}: ${error.message}`));
}

/** What code computes and the model cannot change. */
export interface ComputedReportFields {
  readonly runId: string;
  readonly verdict: Verdict;
  readonly flags: RunFlags;
  readonly stats: RunStats;
  /** Heals from locator memory, when the caller knows them; otherwise the body's. */
  readonly heals?: readonly ReportHeal[];
}

/**
 * The `RunReport`: the body (which may carry no `verdict`, `flags` or `stats`) with the
 * code-computed fields injected.
 */
export function buildRunReport(
  reportBody: unknown,
  computed: ComputedReportFields,
): Result<RunReport, string[]> {
  const body = validate('ReportBody', reportBody);
  if (!body.ok) {
    return err(body.error.map((error) => `body${error.path}: ${error.message}`));
  }
  const report = {
    runId: computed.runId,
    verdict: computed.verdict,
    flags: { adjudicated: computed.flags.adjudicated, healed: computed.flags.healed },
    stats: { ...computed.stats },
    summary: body.value.summary,
    defects: body.value.defects,
    adjudications: body.value.adjudications,
    heals: computed.heals === undefined ? body.value.heals : [...computed.heals],
    maintenance: body.value.maintenance,
    generatedBy: body.value.generatedBy,
  };
  const checked = validate('RunReport', report);
  return checked.ok
    ? ok(checked.value)
    : err(checked.error.map((error) => `report${error.path}: ${error.message}`));
}
