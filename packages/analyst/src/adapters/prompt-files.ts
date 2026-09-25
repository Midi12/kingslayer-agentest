/** Loads the prompt templates of a directory (`prompts/` of the repository or the image). */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type Result } from '@argus/contracts';
import {
  parsePromptTemplate,
  PROMPT_ID_PATTERN,
  type PromptTemplate,
} from '../core/prompt-template.js';

/** Every `t-N.md`, `r-N.md` and `v-N.md` of `directory`, parsed and checked. */
export async function loadPromptDirectory(
  directory: string,
): Promise<Result<PromptTemplate[], string[]>> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    return err([
      `cannot read ${directory}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  const templates: PromptTemplate[] = [];
  const errors: string[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.md')) continue;
    const id = name.slice(0, -3);
    if (!PROMPT_ID_PATTERN.test(id)) continue;
    const parsed = parsePromptTemplate(id, await readFile(join(directory, name), 'utf8'));
    if (parsed.ok) templates.push(parsed.value);
    else errors.push(...parsed.error);
  }
  if (errors.length > 0) return err(errors);
  if (templates.length === 0) return err([`${directory} holds no prompt template`]);
  return ok(templates);
}
