# @argus/analyst

The Analyst gives the LLM a closed menu and validates its answer before anything acts on
it (implementation spec M07). It implements the `Analyst` port of `@argus/contracts`:
break triage, visual grounding on a set-of-marks screenshot, vision assertions and the
run report, over an `LlmProvider` (Anthropic or OpenAI-compatible).

## Run it against the fake LLM

Save as `packages/analyst/try.ts` and run `npx tsx --conditions=@argus/source packages/analyst/try.ts` from the repository root:

```ts
import { readFileSync } from 'node:fs';
import { DEFAULT_FAKE_LLM_API_KEY, startFakeLlm } from '@argus/testkit';
import { AnthropicProvider, LlmAnalyst, SharpImageScaler, loadPromptDirectory } from '@argus/analyst';
const llm = await startFakeLlm({ script: { response: { json: { decision: 'RETRY_STEP', classification: 'TRANSIENT', certainty: 'medium', rationale: 'The alarm table was still loading.', evidence: [] } } } });
const prompts = await loadPromptDirectory('prompts'); // t-1, r-1 and v-1 of the repository
const analyst = LlmAnalyst.create({ provider: new AnthropicProvider({ apiKey: DEFAULT_FAKE_LLM_API_KEY, baseURL: llm.url }), scaler: new SharpImageScaler(), prompts: prompts.ok ? prompts.value : [], model: 'claude-sonnet-5' });
const packet = JSON.parse(readFileSync('packages/contracts/test/__golden__/valid/BreakPacket/spec-example.json', 'utf8'));
if (analyst.ok) console.log(JSON.stringify(await analyst.value.triage(packet))); // { ok: true, value: { result: { decision: 'RETRY_STEP', … }, usage } }
await llm.close();
```

Tests: `pnpm --filter @argus/analyst test`; gates: `pnpm gate M07`.

## What is inside

| Area | Exports |
| --- | --- |
| Ports | `LlmProvider` (`complete` with system, text and image messages, JSON schema, token limit, timeout), `ImageScaler` |
| Adapters | `AnthropicProvider` (`@anthropic-ai/sdk`, `output_config.format`, refusal fallbacks on the first-party API), `OpenAiCompatibleProvider` (`fetch`; OpenAI, Azure, vLLM, Ollama, Mistral), `SharpImageScaler`, `loadPromptDirectory` |
| Menu and validation | `allowedDecisions(reason, { strict }, { critical })`, `isEscalable`, `validateDecision(packet, answer)` |
| Prompts | `prompts/t-N.md`, `r-N.md`, `v-N.md`; `parsePromptTemplate`, `renderSection`, `dataBlock`, `ndjsonBlock` |
| Budgets | `DEFAULT_LIMITS` (triage 20,000 tokens and six frames, report 16,000, images 1,280 px), `selectFrames`, `buildTriageRequest`, `buildReportRequest`, estimates |
| Analyst | `LlmAnalyst` (one repair attempt carrying the validator errors, then `invalid_answer`), `analystBreakReason` |
| Report | `buildRunReport(body, { runId, verdict, flags, stats })`, `defectSignature` |
| Models | `modelForTier(tier, env)` over `ARGUS_LLM_MODEL` and `ARGUS_LLM_PREMIUM_MODEL` |
| Live quality | `parseLabelledBreaks`, `runTriageEvaluation`, `scoreTriage` (M07-G7, M19-G6) |

Adapters are wired only in `apps/brain/src/main.ts`. Decisions: `docs/adr/M07-*.md`.
