export const GUARD_USAGE = `Usage:
  pnpm gate-guard --diff <base> <head>                  merge-request mode: the combined diff base...head
  pnpm gate-guard --range <base>..<head> [--per-commit] each commit separately (ADR-0015), or the whole range
  pnpm gate-guard --files <file-list|->                 a list of changed paths, one per line
Options:
  --conventional   also require conventional commit subjects (range mode)
  --repo <dir>     repository directory (default: current directory)

Fails with exit 1 when protected paths (gates/*.yaml, **/__golden__/**, thresholds/**,
prompts/**, packages/navigator/src/questions.ts) change together with other paths.
gates/evidence/**, docs/gate-changes/** and tests are neutral. Exit 2 on usage or git errors.`;

export type GuardCommand =
  | {
      readonly kind: 'diff';
      readonly base: string;
      readonly head: string;
      readonly repo: string | undefined;
    }
  | {
      readonly kind: 'range';
      readonly range: string;
      readonly perCommit: boolean;
      readonly conventional: boolean;
      readonly repo: string | undefined;
    }
  | { readonly kind: 'files'; readonly list: string }
  | { readonly kind: 'help' };

export type Parsed =
  | { readonly ok: true; readonly value: GuardCommand }
  | { readonly ok: false; readonly error: string };

const RANGE = /^[^.\s]+\.\.[^.\s]+$/;

export function parseGuardArgs(argv: readonly string[]): Parsed {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { ok: true, value: { kind: 'help' } };
  }
  let mode: 'diff' | 'range' | 'files' | undefined;
  let base: string | undefined;
  let head: string | undefined;
  let range: string | undefined;
  let list: string | undefined;
  let repo: string | undefined;
  let perCommit = false;
  let conventional = false;
  const setMode = (next: 'diff' | 'range' | 'files'): string | undefined => {
    if (mode !== undefined) {
      return `--${mode} and --${next} cannot be combined`;
    }
    mode = next;
    return undefined;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    let problem: string | undefined;
    switch (arg) {
      case '--diff':
        problem = setMode('diff');
        base = argv[index + 1];
        head = argv[index + 2];
        index += 2;
        if (problem === undefined && (base === undefined || head === undefined)) {
          problem = '--diff needs <base> <head>';
        }
        break;
      case '--range':
        problem = setMode('range');
        range = argv[index + 1];
        index += 1;
        if (problem === undefined && (range === undefined || !RANGE.test(range))) {
          problem = '--range needs <base>..<head>';
        }
        break;
      case '--files':
        problem = setMode('files');
        list = argv[index + 1];
        index += 1;
        if (problem === undefined && list === undefined) {
          problem = '--files needs a file list or -';
        }
        break;
      case '--per-commit':
        perCommit = true;
        break;
      case '--conventional':
        conventional = true;
        break;
      case '--repo':
        repo = argv[index + 1];
        index += 1;
        if (repo === undefined) {
          problem = '--repo needs a directory';
        }
        break;
      default:
        problem = `unexpected argument ${String(arg)}`;
    }
    if (problem !== undefined) {
      return { ok: false, error: problem };
    }
  }
  if ((perCommit || conventional) && mode !== 'range') {
    return { ok: false, error: '--per-commit and --conventional apply to --range only' };
  }
  switch (mode) {
    case 'diff':
      return { ok: true, value: { kind: 'diff', base: base ?? '', head: head ?? '', repo } };
    case 'range':
      return {
        ok: true,
        value: { kind: 'range', range: range ?? '', perCommit, conventional, repo },
      };
    case 'files':
      if (repo !== undefined) {
        return { ok: false, error: '--repo does not apply to --files' };
      }
      return { ok: true, value: { kind: 'files', list: list ?? '' } };
    case undefined:
      return { ok: false, error: 'choose --diff, --range or --files' };
  }
}

/** Paths of a file list: one per line; blank lines and `#` comments are ignored. */
export function parseFileList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}
