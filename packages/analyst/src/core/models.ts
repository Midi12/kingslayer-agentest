/**
 * Analyst model ids (ADR M07-models). The ids come from configuration:
 * ARGUS_LLM_MODEL for the standard tier and ARGUS_LLM_PREMIUM_MODEL for the premium
 * tier; these are the recommended defaults for the Anthropic provider.
 */
import type { ModelTier } from '@argus/contracts';

export const DEFAULT_STANDARD_MODEL = 'claude-sonnet-5';
export const DEFAULT_PREMIUM_MODEL = 'claude-opus-5';

export interface ModelEnvironment {
  readonly ARGUS_LLM_MODEL?: string | undefined;
  readonly ARGUS_LLM_PREMIUM_MODEL?: string | undefined;
}

function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** The model id for a tier: the configured one, else the recommended default. */
export function modelForTier(tier: ModelTier, env: ModelEnvironment): string {
  return tier === 'premium'
    ? (configured(env.ARGUS_LLM_PREMIUM_MODEL) ?? DEFAULT_PREMIUM_MODEL)
    : (configured(env.ARGUS_LLM_MODEL) ?? DEFAULT_STANDARD_MODEL);
}
