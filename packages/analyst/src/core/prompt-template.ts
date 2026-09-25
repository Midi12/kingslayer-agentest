/**
 * Versioned prompt templates (ADR M07-prompts): `prompts/t-N.md` for triage, `r-N.md`
 * for the report and `v-N.md` for vision. A file is a free-form header for reviewers,
 * then sections introduced by a line `=== <name> ===`. Sections hold literal text and
 * placeholders: `{{name}}` takes a string code computes from closed vocabularies (the
 * decision menu), `{{data:name}}` a delimited data block. System sections take no
 * placeholder at all, so nothing page-derived can reach them.
 */
import { err, ok, type Result } from '@argus/contracts';
import { DATA_TAG } from './data-block.js';

export type PromptKind = 'triage' | 'report' | 'vision';

const KIND_BY_LETTER: Readonly<Record<string, PromptKind>> = {
  t: 'triage',
  r: 'report',
  v: 'vision',
};

export const PROMPT_ID_PATTERN = /^([trv])-([1-9][0-9]{0,3})$/;

/** Every section of a kind and the exact placeholders it must contain. */
export const PROMPT_SECTIONS: Readonly<
  Record<PromptKind, Readonly<Record<string, readonly string[]>>>
> = {
  triage: {
    system: [],
    user: ['menu', 'data:packet'],
    repair: ['data:previous', 'data:errors'],
  },
  report: {
    system: [],
    user: ['data:run', 'data:ledger'],
    repair: ['data:previous', 'data:errors'],
  },
  vision: {
    'system:ground': [],
    'user:ground': ['data:step', 'data:marks'],
    'system:assert': [],
    'user:assert': ['data:question'],
    repair: ['data:previous', 'data:errors'],
  },
};

export interface PromptTemplate {
  /** `t-1`, `r-2`, …: the `promptVersion` recorded with every answer. */
  readonly id: string;
  readonly kind: PromptKind;
  readonly version: number;
  readonly sections: Readonly<Record<string, string>>;
}

const SECTION_LINE = /^=== ([a-z]+(?::[a-z]+)?) ===$/;
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const PLACEHOLDER_NAME = /^(?:data:)?[a-z][a-z0-9-]{0,40}$/;

function trimBlankLines(lines: readonly string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim() === '') start++;
  while (end > start && (lines[end - 1] ?? '').trim() === '') end--;
  return lines.slice(start, end).join('\n');
}

/** The placeholders of a section text, in order of first appearance. */
export function placeholdersOf(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? '';
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Parses and checks one template file; `id` is the file name without `.md`. */
export function parsePromptTemplate(id: string, text: string): Result<PromptTemplate, string[]> {
  const idMatch = PROMPT_ID_PATTERN.exec(id);
  const kind = idMatch === null ? undefined : KIND_BY_LETTER[idMatch[1] ?? ''];
  if (idMatch === null || kind === undefined) {
    return err([`${id}: a prompt id is t-N, r-N or v-N`]);
  }
  const errors: string[] = [];
  const sections: Record<string, string> = {};
  let current: string | undefined;
  let buffer: string[] = [];
  const flush = (): void => {
    if (current !== undefined) {
      sections[current] = trimBlankLines(buffer);
    }
    buffer = [];
  };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const header = SECTION_LINE.exec(line);
    if (header !== null) {
      flush();
      current = header[1] ?? '';
      if (current in sections) {
        errors.push(`${id}: section ${current} appears twice`);
      }
      continue;
    }
    buffer.push(line);
  }
  flush();

  const expected = PROMPT_SECTIONS[kind];
  for (const name of Object.keys(sections)) {
    if (!(name in expected)) {
      errors.push(`${id}: unknown section ${name}`);
    }
  }
  for (const [name, placeholders] of Object.entries(expected)) {
    const body = sections[name];
    if (body === undefined || body === '') {
      errors.push(`${id}: section ${name} is missing or empty`);
      continue;
    }
    const found = placeholdersOf(body);
    for (const placeholder of found) {
      if (!PLACEHOLDER_NAME.test(placeholder)) {
        errors.push(`${id}: section ${name} has a malformed placeholder {{${placeholder}}}`);
      }
    }
    const missing = placeholders.filter((placeholder) => !found.includes(placeholder));
    const extra = found.filter((placeholder) => !placeholders.includes(placeholder));
    if (missing.length > 0) {
      errors.push(`${id}: section ${name} lacks ${missing.map((p) => `{{${p}}}`).join(', ')}`);
    }
    if (extra.length > 0) {
      errors.push(
        `${id}: section ${name} has unexpected ${extra.map((p) => `{{${p}}}`).join(', ')}`,
      );
    }
    if (name.startsWith('system') && !(body.includes(`<${DATA_TAG}>`) && /untrusted/i.test(body))) {
      errors.push(`${id}: section ${name} must declare <${DATA_TAG}> content untrusted`);
    }
    if (body.includes(`</${DATA_TAG}`) || body.includes(`<${DATA_TAG} `)) {
      errors.push(`${id}: section ${name} may not contain a literal data element`);
    }
  }
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({ id, kind, version: Number(idMatch[2]), sections });
}

/** The template of `kind` with the given id, or the highest version when no id is given. */
export function selectTemplate(
  templates: readonly PromptTemplate[],
  kind: PromptKind,
  id?: string,
): Result<PromptTemplate, string> {
  const candidates = templates.filter((template) => template.kind === kind);
  if (id !== undefined) {
    const found = candidates.find((template) => template.id === id);
    return found === undefined ? err(`prompt ${id} (${kind}) is not loaded`) : ok(found);
  }
  const latest = candidates.reduce<PromptTemplate | undefined>(
    (best, template) => (best === undefined || template.version > best.version ? template : best),
    undefined,
  );
  return latest === undefined ? err(`no ${kind} prompt is loaded`) : ok(latest);
}

/**
 * Fills a section. `values` must hold exactly the section's placeholders: trusted text
 * under the plain name, a rendered data block under `data:<name>`. A mismatch is a bug.
 */
export function renderSection(
  template: PromptTemplate,
  section: string,
  values: Readonly<Record<string, string>>,
): string {
  const body = template.sections[section];
  if (body === undefined) {
    throw new RangeError(`prompt ${template.id} has no section ${section}`);
  }
  const needed = placeholdersOf(body);
  const given = Object.keys(values);
  const missing = needed.filter((name) => !given.includes(name));
  const extra = given.filter((name) => !needed.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new RangeError(
      `prompt ${template.id} section ${section}: missing ${missing.join(', ') || 'none'}, unexpected ${extra.join(', ') || 'none'}`,
    );
  }
  for (const [name, value] of Object.entries(values)) {
    if (name.startsWith('data:') && !value.startsWith(`<${DATA_TAG} name=`)) {
      throw new RangeError(`placeholder ${name} takes a data block`);
    }
  }
  return body.replace(PLACEHOLDER, (_match, name: string) => values[name] ?? '');
}
