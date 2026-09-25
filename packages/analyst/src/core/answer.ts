/**
 * Reading a provider answer as JSON. A refusal, an answer cut at the token limit, and
 * text that is not one JSON value are invalid answers, repaired like a schema failure.
 */
import { err, ok, type Result } from '@argus/contracts';
import type { LlmResponse } from '../ports/llm.js';

const FENCED = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/;

/** The JSON value of an answer, or the reasons it has none. */
export function readJsonAnswer(response: LlmResponse): Result<unknown, string[]> {
  if (response.stopReason === 'refusal') {
    return err([`/: the model refused to answer: ${JSON.stringify(response.text.slice(0, 300))}`]);
  }
  if (response.stopReason === 'max_tokens') {
    return err([
      `/: the answer was cut at the output limit after ${String(response.usage.outputTokens)} tokens; answer with a shorter JSON object`,
    ]);
  }
  if (response.json !== undefined) {
    return ok(response.json);
  }
  const trimmed = response.text.trim();
  const body = FENCED.exec(trimmed)?.[1] ?? trimmed;
  try {
    return ok(JSON.parse(body) as unknown);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return err([`/: the answer is not one JSON object (${reason})`]);
  }
}
