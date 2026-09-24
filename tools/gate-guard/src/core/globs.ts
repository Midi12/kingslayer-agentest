/**
 * Glob matching for repository paths: `**` spans directories (including none), `*` and
 * `?` stay within one path segment. Paths use forward slashes and no leading `./`.
 */
const SPECIAL = /[.+^${}()|[\]\\]/g;

export function globToRegExp(glob: string): RegExp {
  let source = '';
  let index = 0;
  while (index < glob.length) {
    if (glob.startsWith('**/', index)) {
      source += '(?:.*/)?';
      index += 3;
    } else if (glob.startsWith('/**', index) && index + 3 === glob.length) {
      source += '(?:/.*)?';
      index += 3;
    } else if (glob.startsWith('**', index)) {
      source += '.*';
      index += 2;
    } else {
      const char = glob.charAt(index);
      if (char === '*') {
        source += '[^/]*';
      } else if (char === '?') {
        source += '[^/]';
      } else {
        source += char.replace(SPECIAL, '\\$&');
      }
      index += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

/** Normalises a path from git or a file list: forward slashes, no leading `./`. */
export function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '');
}

export function matchesAny(path: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}
