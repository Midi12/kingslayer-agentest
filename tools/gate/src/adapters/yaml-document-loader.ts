import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { DocumentLoader } from '../ports/index.js';

export class YamlDocumentLoader implements DocumentLoader {
  async loadYaml(
    path: string,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      return {
        ok: false,
        error: `cannot read: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    try {
      return { ok: true, value: parse(text, { prettyErrors: true, uniqueKeys: true }) as unknown };
    } catch (error) {
      return {
        ok: false,
        error: `invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
