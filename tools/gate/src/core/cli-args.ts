/** Argument parsing for `pnpm gate`, `pnpm g0` and `pnpm depcruise`. */
import { TIERS, type Tier } from './gate-file.js';
import { type Result, err, ok } from './result.js';

export const GATE_USAGE = `Usage:
  pnpm gate <MOD|all> [--tier A|B|C] [--evidence-dir <dir>] [--gates-dir <dir>] [--strict] [--verbose]
  pnpm gate verify <evidence.json...>

  <MOD>            a module or scenario id such as M00 or S03, read from <gates-dir>/<MOD>.yaml
  all              every gates/M*.yaml and gates/S*.yaml
  --tier           run only the gates of one tier
  --evidence-dir   where evidence and logs go (default gates/evidence)
  --gates-dir      where gate files are read (default gates)
  --strict         exit 1 when a gate did not run, not only when one failed
  --verbose        stream command output
  verify           recompute the evidenceHash of evidence files

Exit codes: 0 no gate failed, 1 a gate failed (or did not run, with --strict), 2 usage or gate file error.`;

export type GateCommand =
  | {
      readonly kind: 'run';
      readonly target: string;
      readonly tier: Tier | undefined;
      readonly evidenceDir: string | undefined;
      readonly gatesDir: string | undefined;
      readonly strict: boolean;
      readonly verbose: boolean;
    }
  | { readonly kind: 'verify'; readonly files: readonly string[] }
  | { readonly kind: 'help' };

function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

export function parseGateArgs(argv: readonly string[]): Result<GateCommand, string> {
  if (argv.includes('--help') || argv.includes('-h')) {
    return ok({ kind: 'help' });
  }
  if (argv[0] === 'verify') {
    const files = argv.slice(1);
    return files.length === 0
      ? err('verify needs at least one evidence file')
      : ok({ kind: 'verify', files });
  }
  let target: string | undefined;
  let tier: Tier | undefined;
  let evidenceDir: string | undefined;
  let gatesDir: string | undefined;
  let strict = false;
  let verbose = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const value = (): string | undefined => {
      index += 1;
      return argv[index];
    };
    switch (arg) {
      case '--tier': {
        const next = value();
        if (next === undefined || !isTier(next)) {
          return err(`--tier needs one of ${TIERS.join(', ')}`);
        }
        tier = next;
        break;
      }
      case '--evidence-dir': {
        const next = value();
        if (next === undefined) {
          return err('--evidence-dir needs a directory');
        }
        evidenceDir = next;
        break;
      }
      case '--gates-dir': {
        const next = value();
        if (next === undefined) {
          return err('--gates-dir needs a directory');
        }
        gatesDir = next;
        break;
      }
      case '--strict':
        strict = true;
        break;
      case '--verbose':
        verbose = true;
        break;
      default:
        if (arg.startsWith('-')) {
          return err(`unknown option ${arg}`);
        }
        if (target !== undefined) {
          return err(`unexpected argument ${arg}`);
        }
        target = arg;
    }
  }
  if (target === undefined) {
    return err('missing <MOD|all>');
  }
  if (target !== 'all' && !/^[MS]\d{2}$/.test(target)) {
    return err(`invalid module ${target}; expected an id such as M00 or S03, or all`);
  }
  return ok({ kind: 'run', target, tier, evidenceDir, gatesDir, strict, verbose });
}

export const G0_USAGE = `Usage: pnpm g0 <package-dir...>

Runs global gate G0 on each package: typecheck, lint, tests with coverage, dependency
rules and the forbidden-marker scan. Writes metrics to $GATE_METRICS when set.`;

export function parseG0Args(
  argv: readonly string[],
): Result<{ packages: string[] } | 'help', string> {
  if (argv.includes('--help') || argv.includes('-h')) {
    return ok('help');
  }
  const unknown = argv.find((arg) => arg.startsWith('-'));
  if (unknown !== undefined) {
    return err(`unknown option ${unknown}`);
  }
  if (argv.length === 0) {
    return err('name at least one package directory');
  }
  return ok({ packages: [...argv] });
}

export const DEPCRUISE_USAGE = `Usage: pnpm depcruise [--json <file>] [path...]

Checks the dependency rules of .dependency-cruiser.cjs. Without paths it checks the
real tree (packages, apps and tools, without test fixtures); with paths it checks
exactly those paths.`;

export function parseDepcruiseArgs(
  argv: readonly string[],
): Result<{ paths: string[]; jsonFile: string | undefined } | 'help', string> {
  if (argv.includes('--help') || argv.includes('-h')) {
    return ok('help');
  }
  const paths: string[] = [];
  let jsonFile: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--json') {
      index += 1;
      jsonFile = argv[index];
      if (jsonFile === undefined) {
        return err('--json needs a file');
      }
    } else if (arg.startsWith('-')) {
      return err(`unknown option ${arg}`);
    } else {
      paths.push(arg);
    }
  }
  return ok({ paths, jsonFile });
}
