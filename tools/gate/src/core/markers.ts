/**
 * Forbidden markers of global gate G0: unfinished-work comments and skipped or focused
 * tests. Each pattern is spelled so that this file does not match itself.
 */
export interface MarkerPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

const word = (...parts: string[]): string => parts.join('');

export const MARKER_PATTERNS: readonly MarkerPattern[] = [
  { name: word('TO', 'DO'), pattern: new RegExp(`\\b${word('TO', 'DO')}\\b`) },
  { name: word('FIX', 'ME'), pattern: new RegExp(`\\b${word('FIX', 'ME')}\\b`) },
  { name: word('.', 'skip'), pattern: new RegExp(`\\.${word('sk', 'ip')}(If)?\\b`) },
  // The focus modifier as a whole word, so chained forms such as `.each` match as well.
  { name: word('.', 'only'), pattern: new RegExp(`\\.${word('on', 'ly')}\\b`) },
  { name: word('.', 'todo('), pattern: new RegExp(`\\.${word('to', 'do')}\\(`) },
  // Excluded-test helpers followed by a call, a chained modifier or a template tag.
  { name: word('x', 'it'), pattern: new RegExp(`\\b${word('x', 'it')}\\s*[(.\`]`) },
  { name: word('x', 'test'), pattern: new RegExp(`\\b${word('x', 'test')}\\s*[(.\`]`) },
  {
    name: word('x', 'describe'),
    pattern: new RegExp(`\\b${word('x', 'describe')}\\s*[(.\`]`),
  },
];

export interface MarkerHit {
  readonly file: string;
  readonly line: number;
  readonly marker: string;
  readonly text: string;
}

/** Every marker occurrence in `text`, one hit per marker and line. */
export function scanForMarkers(file: string, text: string): MarkerHit[] {
  const hits: MarkerHit[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const { name, pattern } of MARKER_PATTERNS) {
      if (pattern.test(line)) {
        hits.push({ file, line: index + 1, marker: name, text: line.trim() });
      }
    }
  });
  return hits;
}

const TEXT_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|ya?ml|md|txt|html|css|sql|sh)$/;

/** Whether the scanner reads a file, by extension. */
export function isScannedFile(path: string): boolean {
  return TEXT_FILE.test(path);
}
