# ADR M07-models: Recommended Analyst models per tier

- Status: accepted; the defaults are to be confirmed by M19-G6 with live keys
- Date: 2026-09-25
- Module: M07

## Context

Model ids come from configuration (`ARGUS_LLM_MODEL` for the standard tier, `ARGUS_LLM_PREMIUM_MODEL` for the premium tier, plan Appendix A). The premium tier multiplies the three LLM operations by 2.5 on the rate card; the unit economics assume "a fast multimodal model near $1 per million input tokens and $5 per million output tokens", an assumption to refresh at launch. Every Analyst call needs vision and structured output.

## Decision

- Recommended defaults for the Anthropic provider: standard `claude-sonnet-5` ($2 / $10 per million tokens), premium `claude-opus-5` ($5 / $25). Both support images and structured outputs (`output_config.format`), and their price ratio (2.5) equals the rate-card multiplier, so the premium tier keeps the standard tier's margin.
- `modelForTier(tier, env)` returns the configured id, else the default. The OpenAI-compatible provider has no meaningful default: an on-prem or private-AI install sets `ARGUS_LLM_MODEL` (ADR-0011 proposes a Qwen2.5-VL 7B for local use).
- Cost check at the spec's token sizes: an escalation (about 18,000 input and 800 output tokens) costs about $0.044 on the standard default and $0.11 on the premium default, against 10 and 25 credits (EUR 0.09 and 0.225 at the pack price); a report (15,000 in, 1,500 out) about $0.045 and $0.11. The standard default is above the spec's $1 / $5 assumption; the product owner re-checks the margin at launch with M19-G5, and `claude-haiku-4-5` ($1 / $5, vision and structured outputs) is the documented fallback for the standard tier if M19-G6 still passes with it.
- Thinking is left at each model's default (adaptive on these models); output limits are generous (8,192 tokens for triage and report) so thinking does not cut answers.

## Consequences

Changing a default is a configuration change, not a code change, but it changes the cost basis: it is recorded here and re-measured by M19-G5 and M19-G6. Model ids never appear outside `core/models.ts` and configuration.
