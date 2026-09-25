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
  /** Report input budget, ledger and key frames included. */
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
  reportTokenBudget: 16_000,
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
