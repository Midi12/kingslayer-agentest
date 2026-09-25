/**
 * Triage quality over labelled breaks (M07-G7, run as M19-G6): the share of decisions
 * and classifications that match the label, and the answers that stayed invalid after
 * their repair attempt. The instrument is tested against the fake LLM; its verdict
 * counts only against a live model (ADR-0016).
 */
import {
  ANALYST_DECISIONS,
  CLASSIFICATIONS,
  err,
  ok,
  InlineImage as InlineImageSchema,
  validate,
  validateAgainst,
  type Analyst,
  type AnalystDecisionType,
  type BreakPacket,
  type Classification,
  type InlineImage,
  type Result,
} from '@argus/contracts';

export interface LabelledBreak {
  readonly id: string;
  readonly packet: BreakPacket;
  readonly frameImages: readonly { readonly ref: string; readonly image: InlineImage }[];
  readonly label: {
    readonly decision: AnalystDecisionType;
    readonly classification: Classification;
  };
}

export interface TriageOutcome {
  readonly id: string;
  readonly decision: AnalystDecisionType | null;
  readonly classification: Classification | null;
  /** `invalid_answer`, `unavailable` or `invalid_request` when no decision came back. */
  readonly error: string | null;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface TriageQuality {
  readonly cases: number;
  readonly answered: number;
  readonly decisionMatches: number;
  readonly classificationMatches: number;
  /** Matches over all cases (an unanswered case counts as a miss). */
  readonly decisionMatch: number;
  readonly classificationMatch: number;
  readonly invalidAfterRepair: number;
  readonly unavailable: number;
  readonly repaired: number;
  readonly maxInputTokens: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses a JSON Lines dataset of labelled breaks; every line is checked. */
export function parseLabelledBreaks(text: string): Result<LabelledBreak[], string[]> {
  const cases: LabelledBreak[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    const where = `line ${String(index + 1)}`;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      errors.push(`${where}: not JSON`);
      return;
    }
    if (!isObject(value) || typeof value.id !== 'string' || value.id === '') {
      errors.push(`${where}: an object with a non-empty id is expected`);
      return;
    }
    if (ids.has(value.id)) {
      errors.push(`${where}: duplicate id ${value.id}`);
      return;
    }
    ids.add(value.id);
    const packet = validate('BreakPacket', value.packet);
    if (!packet.ok) {
      errors.push(
        `${where}: packet ${packet.error.map((e) => `${e.path} ${e.message}`).join('; ')}`,
      );
      return;
    }
    const label = isObject(value.label) ? value.label : {};
    const decision = ANALYST_DECISIONS.find((d) => d === label.decision);
    const classification = CLASSIFICATIONS.find((c) => c === label.classification);
    if (decision === undefined || classification === undefined) {
      errors.push(`${where}: label needs a decision and a classification from the contracts`);
      return;
    }
    const frames: { ref: string; image: InlineImage }[] = [];
    for (const frame of Array.isArray(value.frameImages) ? (value.frameImages as unknown[]) : []) {
      const image = isObject(frame)
        ? validateAgainst<InlineImage>(InlineImageSchema, frame.image)
        : undefined;
      if (!isObject(frame) || typeof frame.ref !== 'string' || image === undefined || !image.ok) {
        errors.push(`${where}: frameImages holds { ref, image } entries`);
        return;
      }
      frames.push({ ref: frame.ref, image: image.value });
    }
    cases.push({
      id: value.id,
      packet: packet.value,
      frameImages: frames,
      label: { decision, classification },
    });
  });
  return errors.length > 0 ? err(errors) : ok(cases);
}

/** Triage of every case in order, one at a time. */
export async function runTriageEvaluation(
  analyst: Analyst,
  cases: readonly LabelledBreak[],
): Promise<TriageOutcome[]> {
  const outcomes: TriageOutcome[] = [];
  for (const item of cases) {
    const result = await analyst.triage(item.packet, { frameImages: item.frameImages });
    outcomes.push(
      result.ok
        ? {
            id: item.id,
            decision: result.value.result.decision,
            classification: result.value.result.classification,
            error: null,
            calls: result.value.usage.calls,
            inputTokens: result.value.usage.inputTokens,
            outputTokens: result.value.usage.outputTokens,
          }
        : {
            id: item.id,
            decision: null,
            classification: null,
            error: result.error.code,
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
          },
    );
  }
  return outcomes;
}

/** The quality figures of a run. */
export function scoreTriage(
  cases: readonly LabelledBreak[],
  outcomes: readonly TriageOutcome[],
): TriageQuality {
  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  let answered = 0;
  let decisionMatches = 0;
  let classificationMatches = 0;
  let invalidAfterRepair = 0;
  let unavailable = 0;
  let repaired = 0;
  let maxInputTokens = 0;
  for (const item of cases) {
    const outcome = byId.get(item.id);
    if (outcome === undefined) continue;
    if (outcome.error === 'invalid_answer') invalidAfterRepair++;
    else if (outcome.error !== null) unavailable++;
    if (outcome.decision === null) continue;
    answered++;
    if (outcome.calls > 1) repaired++;
    maxInputTokens = Math.max(
      maxInputTokens,
      Math.ceil(outcome.inputTokens / Math.max(1, outcome.calls)),
    );
    if (outcome.decision === item.label.decision) decisionMatches++;
    if (outcome.classification === item.label.classification) classificationMatches++;
  }
  const total = cases.length;
  return {
    cases: total,
    answered,
    decisionMatches,
    classificationMatches,
    decisionMatch: total === 0 ? 0 : decisionMatches / total,
    classificationMatch: total === 0 ? 0 : classificationMatches / total,
    invalidAfterRepair,
    unavailable,
    repaired,
    maxInputTokens,
  };
}
