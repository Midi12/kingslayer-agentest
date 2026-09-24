/**
 * Configuration of the fakes app, from the environment (ADR-0006 conventions: every
 * invalid key is reported by name and the process exits with 78). The command picks the
 * servers: `fake-jev`, `fake-llm`, `cassette-proxy` or `all` (fake-jev and fake-llm).
 */
import { isLlmFault, type CassetteMode, type LlmFault } from '@argus/testkit';

export const COMMANDS = ['fake-jev', 'fake-llm', 'cassette-proxy', 'all'] as const;
export type Command = (typeof COMMANDS)[number];

export const EX_CONFIG = 78;

export type JevModeConfig =
  | { readonly kind: 'scripted'; readonly scriptFile: string | undefined }
  | { readonly kind: 'cassette'; readonly cassetteDir: string }
  | {
      readonly kind: 'oracle';
      readonly targetsFile: string;
      readonly seed: number;
      readonly noise: number;
    };

export interface FakesConfig {
  readonly command: Command;
  readonly host: string;
  readonly version: string;
  readonly logLevel: string;
  readonly jev: {
    readonly port: number;
    readonly apiKeys: readonly string[] | undefined;
    readonly mode: JevModeConfig;
  };
  readonly llm: {
    readonly port: number;
    readonly apiKeys: readonly string[] | undefined;
    readonly scriptFile: string | undefined;
    readonly fault: LlmFault | undefined;
  };
  readonly proxy: {
    readonly port: number;
    readonly upstream: string | undefined;
    readonly cassetteDir: string | undefined;
    readonly mode: CassetteMode;
  };
}

export interface ConfigProblem {
  readonly key: string;
  readonly message: string;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: FakesConfig }
  | { readonly ok: false; readonly problems: readonly ConfigProblem[] };

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

class Reader {
  readonly problems: ConfigProblem[] = [];
  constructor(private readonly env: Readonly<Record<string, string | undefined>>) {}

  text(key: string): string | undefined {
    const value = this.env[key]?.trim();
    return value === undefined || value === '' ? undefined : value;
  }

  required(key: string, why: string): string {
    const value = this.text(key);
    if (value === undefined) {
      this.problems.push({ key, message: `required ${why}` });
      return '';
    }
    return value;
  }

  port(key: string, fallback: number): number {
    const value = this.text(key);
    if (value === undefined) {
      return fallback;
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      this.problems.push({ key, message: 'must be a port number from 0 to 65535' });
      return fallback;
    }
    return port;
  }

  number(key: string, fallback: number, min: number, max: number): number {
    const value = this.text(key);
    if (value === undefined) {
      return fallback;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
      this.problems.push({
        key,
        message: `must be a number from ${String(min)} to ${String(max)}`,
      });
      return fallback;
    }
    return number;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    const value = this.text(key);
    if (value === undefined) {
      return fallback;
    }
    if (!(allowed as readonly string[]).includes(value)) {
      this.problems.push({ key, message: `must be one of ${allowed.join(', ')}` });
      return fallback;
    }
    return value as T;
  }

  list(key: string): string[] | undefined {
    const value = this.text(key);
    return value === undefined
      ? undefined
      : value
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== '');
  }
}

/** Reads the configuration of `command` (argv[2]) from `env`; `all` when no command is given. */
export function loadConfig(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): ConfigResult {
  const reader = new Reader(env);
  const commandArg = argv[0] ?? 'all';
  const command = (COMMANDS as readonly string[]).includes(commandArg)
    ? (commandArg as Command)
    : undefined;
  if (command === undefined) {
    reader.problems.push({
      key: 'command',
      message: `must be one of ${COMMANDS.join(', ')}; got ${commandArg}`,
    });
  }
  const effective = command ?? 'all';
  const wantsJev = effective === 'fake-jev' || effective === 'all';
  const wantsProxy = effective === 'cassette-proxy';

  const jevKind = reader.oneOf(
    'FAKE_JEV_MODE',
    ['scripted', 'cassette', 'oracle'] as const,
    'scripted',
  );
  let mode: JevModeConfig;
  if (jevKind === 'cassette') {
    mode = {
      kind: 'cassette',
      cassetteDir: wantsJev ? reader.required('FAKE_JEV_CASSETTE_DIR', 'in cassette mode') : '',
    };
  } else if (jevKind === 'oracle') {
    mode = {
      kind: 'oracle',
      targetsFile: wantsJev ? reader.required('FAKE_JEV_ORACLE_TARGETS', 'in oracle mode') : '',
      seed: reader.number(
        'FAKE_JEV_ORACLE_SEED',
        0,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ),
      noise: reader.number('FAKE_JEV_ORACLE_NOISE', 0, 0, 1),
    };
  } else {
    mode = { kind: 'scripted', scriptFile: reader.text('FAKE_JEV_SCRIPT') };
  }

  const faultText = reader.text('FAKE_LLM_FAULT');
  if (faultText !== undefined && !isLlmFault(faultText)) {
    reader.problems.push({
      key: 'FAKE_LLM_FAULT',
      message: 'must be one of the seven fault modes',
    });
  }
  const upstream = wantsProxy
    ? reader.required('FAKE_PROXY_UPSTREAM', 'for cassette-proxy')
    : reader.text('FAKE_PROXY_UPSTREAM');
  if (upstream !== undefined && upstream !== '' && !/^https?:\/\/[^\s]+$/.test(upstream)) {
    reader.problems.push({ key: 'FAKE_PROXY_UPSTREAM', message: 'must be an http or https URL' });
  }
  const config: FakesConfig = {
    command: effective,
    host: reader.text('FAKE_HOST') ?? '127.0.0.1',
    version: reader.text('ARGUS_VERSION') ?? 'dev',
    logLevel: reader.oneOf('LOG_LEVEL', LOG_LEVELS, 'info'),
    jev: {
      port: reader.port('FAKE_JEV_PORT', 4100),
      apiKeys: reader.list('FAKE_JEV_API_KEY'),
      mode,
    },
    llm: {
      port: reader.port('FAKE_LLM_PORT', 4200),
      apiKeys: reader.list('FAKE_LLM_API_KEY'),
      scriptFile: reader.text('FAKE_LLM_SCRIPT'),
      fault: isLlmFault(faultText) ? faultText : undefined,
    },
    proxy: {
      port: reader.port('FAKE_PROXY_PORT', 4300),
      upstream,
      cassetteDir: wantsProxy
        ? reader.required('FAKE_PROXY_CASSETTE_DIR', 'for cassette-proxy')
        : reader.text('FAKE_PROXY_CASSETTE_DIR'),
      mode: reader.oneOf('FAKE_PROXY_MODE', ['strict', 'record', 'auto'] as const, 'strict'),
    },
  };
  return reader.problems.length > 0
    ? { ok: false, problems: reader.problems }
    : { ok: true, config };
}

/** One line per invalid key, naming the key; values are never printed. */
export function formatProblems(problems: readonly ConfigProblem[]): string {
  return problems
    .map((problem) => `invalid configuration: ${problem.key} ${problem.message}`)
    .join('\n');
}
