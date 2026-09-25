/**
 * Delimited data fields (ADR M07-prompts). Page-derived text reaches a prompt only
 * inside `<argus-data name="…">…</argus-data>` elements, which every system text
 * declares untrusted. The content is JSON (or one JSON value per line) with `<`, `>` and
 * `&` escaped as \u003c, \u003e and \u0026, so no data can close the element or open a
 * new one: the three characters can only occur inside JSON strings, where the escape is
 * equivalent.
 */

export const DATA_TAG = 'argus-data';

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;

function escapeJson(text: string): string {
  return text.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function open(name: string, format: 'json' | 'ndjson'): string {
  if (!NAME_PATTERN.test(name)) {
    throw new RangeError(`data block name ${JSON.stringify(name)} is not a lower-case identifier`);
  }
  return `<${DATA_TAG} name="${name}" format="${format}">`;
}

/** One JSON value, indented by two spaces so each member sits on its own line. */
export function dataBlock(name: string, value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return `${open(name, 'json')}\n${escapeJson(json)}\n</${DATA_TAG}>`;
}

/** One JSON value per line: records that are kept or dropped whole, never cut. */
export function ndjsonBlock(name: string, lines: readonly unknown[]): string {
  const body = lines.map((line) => escapeJson(JSON.stringify(line))).join('\n');
  return `${open(name, 'ndjson')}\n${body}\n</${DATA_TAG}>`;
}

export interface ParsedDataBlock {
  readonly name: string;
  readonly format: 'json' | 'ndjson';
  readonly body: string;
  readonly start: number;
  readonly end: number;
}

/** Every data block of a text, in order (for tests and audits). */
export function findDataBlocks(text: string): ParsedDataBlock[] {
  const pattern = new RegExp(
    `<${DATA_TAG} name="([a-z][a-z0-9-]*)" format="(json|ndjson)">\\n([\\s\\S]*?)\\n</${DATA_TAG}>`,
    'g',
  );
  const blocks: ParsedDataBlock[] = [];
  for (const match of text.matchAll(pattern)) {
    blocks.push({
      name: match[1] ?? '',
      format: match[2] === 'ndjson' ? 'ndjson' : 'json',
      body: match[3] ?? '',
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return blocks;
}

/** The text with every data block removed: what the model reads as instructions. */
export function outsideDataBlocks(text: string): string {
  let out = '';
  let cursor = 0;
  for (const block of findDataBlocks(text)) {
    out += text.slice(cursor, block.start);
    cursor = block.end;
  }
  return out + text.slice(cursor);
}
