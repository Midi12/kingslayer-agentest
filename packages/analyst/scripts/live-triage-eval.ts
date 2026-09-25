/**
 * M07-G7 (Tier B, run as M19-G6): triage quality against a live model on the labelled
 * breaks. Requires ARGUS_LLM_API_KEY; the gate runner reports not_run without it, and a
 * fake provider is refused (ADR-0016). Writes the metrics to $GATE_METRICS and the full
 * result, with model and prompt versions, under eval/results/M07-G7/.
 *
 * Environment: ARGUS_LLM_PROVIDER (anthropic | openai-compatible), ARGUS_LLM_API_KEY,
 * ARGUS_LLM_BASE_URL, ARGUS_LLM_MODEL / ARGUS_LLM_PREMIUM_MODEL, ARGUS_EVAL_MODEL_TIER
 * (standard | premium), ARGUS_TRIAGE_DATASET (default eval/datasets/triage-breaks.jsonl),
 * ARGUS_EVAL_RESULTS_DIR (default eval/results).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordGateMetrics } from '@argus/testkit';
import {
  AnthropicProvider,
  LlmAnalyst,
  OpenAiCompatibleProvider,
  SharpImageScaler,
  loadPromptDirectory,
  modelForTier,
  parseLabelledBreaks,
  runTriageEvaluation,
  scoreTriage,
  type LlmProvider,
} from '../src/index.js';

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function fail(message: string, metrics: Record<string, number | boolean> = {}): never {
  recordGateMetrics({ cases: 0, ...metrics });
  console.error(`M07-G7: ${message}`);
  process.exit(1);
}

function provider(env: NodeJS.ProcessEnv): LlmProvider {
  const kind = env.ARGUS_LLM_PROVIDER ?? 'anthropic';
  const apiKey = env.ARGUS_LLM_API_KEY ?? '';
  const baseURL = env.ARGUS_LLM_BASE_URL === '' ? undefined : env.ARGUS_LLM_BASE_URL;
  if (apiKey === '') fail('ARGUS_LLM_API_KEY is not set');
  if (kind === 'anthropic') {
    return new AnthropicProvider({ apiKey, ...(baseURL === undefined ? {} : { baseURL }) });
  }
  if (kind === 'openai-compatible') {
    if (baseURL === undefined) fail('ARGUS_LLM_BASE_URL is required for openai-compatible');
    return new OpenAiCompatibleProvider({ apiKey, baseURL });
  }
  return fail(`ARGUS_LLM_PROVIDER=${kind} is not a live provider; Tier B never runs on fakes`);
}

async function main(): Promise<void> {
  const env = process.env;
  const llm = provider(env);
  const tier = env.ARGUS_EVAL_MODEL_TIER === 'premium' ? 'premium' : 'standard';
  const model = modelForTier(tier, env);
  const datasetPath = resolve(
    REPOSITORY,
    env.ARGUS_TRIAGE_DATASET ?? 'eval/datasets/triage-breaks.jsonl',
  );
  let text: string;
  try {
    text = await readFile(datasetPath, 'utf8');
  } catch {
    fail(
      `the labelled breaks dataset ${datasetPath} is missing (built by M19 from M02's breaks.jsonl)`,
      {
        datasetMissing: true,
      },
    );
  }
  const dataset = parseLabelledBreaks(text);
  if (!dataset.ok) fail(`invalid dataset:\n${dataset.error.join('\n')}`);
  const prompts = await loadPromptDirectory(join(REPOSITORY, 'prompts'));
  if (!prompts.ok) fail(prompts.error.join('\n'));
  const analyst = LlmAnalyst.create({
    provider: llm,
    scaler: new SharpImageScaler(),
    prompts: prompts.value,
    model,
  });
  if (!analyst.ok) fail(analyst.error.join('\n'));

  const startedAt = new Date().toISOString();
  const outcomes = await runTriageEvaluation(analyst.value, dataset.value);
  const quality = scoreTriage(dataset.value, outcomes);
  recordGateMetrics({
    ...quality,
    model,
    promptVersion: analyst.value.promptVersions.triage,
    provider: llm.kind,
  });
  const resultsDir = resolve(REPOSITORY, env.ARGUS_EVAL_RESULTS_DIR ?? 'eval/results', 'M07-G7');
  await mkdir(resultsDir, { recursive: true });
  const file = join(resultsDir, `${startedAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(
    file,
    `${JSON.stringify({ gate: 'M07-G7', mirrors: 'M19-G6', startedAt, finishedAt: new Date().toISOString(), provider: llm.kind, model, promptVersion: analyst.value.promptVersions.triage, dataset: datasetPath, quality, outcomes }, null, 2)}\n`,
  );
  console.log(
    `M07-G7: ${String(quality.cases)} breaks, decision ${(quality.decisionMatch * 100).toFixed(1)}%, classification ${(quality.classificationMatch * 100).toFixed(1)}%, invalid after repair ${String(quality.invalidAfterRepair)}; ${file}`,
  );
}

await main();
