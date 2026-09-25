/**
 * Budgets and limits of the Analyst (implementation spec M07; ADR M07-budgets). Token
 * budgets are input tokens, estimated before the call; a request that cannot be brought
 * under its budget is never sent.
 */

export interface AnalystLimits {
  /** Triage input budget, frames included. */
  readonly triageTokenBudget: number;
  readonly triageMaxFrames: number;
  /** Frames the triage keeps whatever the budget, when the packet has that many. */
  readonly triageMinFrames: number;
  /**
   * Report input budget, ledger and key frames included. The spec allows 16,000 (M07-G5);
   * the default is 12,000 so the report also meets M19-G5 (report input at most 12,000).
   */
  readonly reportTokenBudget: number;
  readonly reportMaxKeyFrames: number;
  /** Visual grounding and vision assertion input budget. */
  readonly visionTokenBudget: number;
  /** Long edge of every image sent to a provider, in pixels. */
  readonly maxLongEdge: number;
  /** Tokens kept free for the repair message (previous answer and validator errors). */
  readonly repairReserveTokens: number;
  /** Characters of a rejected answer quoted back in the repair message. */
  readonly repairAnswerChars: number;
  readonly triageMaxOutputTokens: number;
  readonly reportMaxOutputTokens: number;
  readonly visionMaxOutputTokens: number;
  readonly triageTimeoutMs: number;
  readonly reportTimeoutMs: number;
  readonly visionTimeoutMs: number;
}

export const DEFAULT_LIMITS: AnalystLimits = {
  triageTokenBudget: 20_000,
  triageMaxFrames: 6,
  triageMinFrames: 3,
  reportTokenBudget: 12_000,
  reportMaxKeyFrames: 4,
  visionTokenBudget: 20_000,
  maxLongEdge: 1280,
  repairReserveTokens: 2500,
  repairAnswerChars: 3000,
  triageMaxOutputTokens: 8192,
  reportMaxOutputTokens: 8192,
  visionMaxOutputTokens: 4096,
  triageTimeoutMs: 90_000,
  reportTimeoutMs: 120_000,
  visionTimeoutMs: 60_000,
};

/**
 * Ceilings a caller may not exceed (implementation spec M07; ADR M07-budgets): triage
 * 20,000 tokens and six frames, report 16,000 tokens, images 1,280 px on the long edge,
 * vision 20,000 tokens and at most four report key frames.
 */
export const LIMIT_CEILINGS = {
  triageTokenBudget: 20_000,
  triageMaxFrames: 6,
  reportTokenBudget: 16_000,
  reportMaxKeyFrames: 4,
  visionTokenBudget: 20_000,
  maxLongEdge: 1280,
} as const satisfies Partial<Record<keyof AnalystLimits, number>>;

/** Limits that must be at least 1; every other limit may be 0. */
const POSITIVE: readonly (keyof AnalystLimits)[] = [
  'triageTokenBudget',
  'triageMaxFrames',
  'reportTokenBudget',
  'visionTokenBudget',
  'maxLongEdge',
  'triageMaxOutputTokens',
  'reportMaxOutputTokens',
  'visionMaxOutputTokens',
  'triageTimeoutMs',
  'reportTimeoutMs',
  'visionTimeoutMs',
];

/**
 * Why a set of limits cannot be used, or an empty list: every limit is a whole number,
 * none exceeds its ceiling, and the triage keeps no more frames than it may send.
 */
export function checkLimits(limits: AnalystLimits): string[] {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(limits) as [keyof AnalystLimits, number][]) {
    const least = POSITIVE.includes(name) ? 1 : 0;
    if (!Number.isSafeInteger(value) || value < least) {
      errors.push(`limit ${name} must be a whole number of at least ${String(least)}`);
    }
  }
  for (const [name, ceiling] of Object.entries(LIMIT_CEILINGS) as [
    keyof typeof LIMIT_CEILINGS,
    number,
  ][]) {
    if (limits[name] > ceiling) {
      errors.push(
        `limit ${name} is ${String(limits[name])}; at most ${String(ceiling)} is allowed`,
      );
    }
  }
  if (limits.triageMinFrames > limits.triageMaxFrames) {
    errors.push('limit triageMinFrames exceeds triageMaxFrames');
  }
  return errors;
}
