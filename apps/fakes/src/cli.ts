/**
 * The command line of the fakes app: `argus-fakes [fake-jev|fake-llm|cassette-proxy|all]`,
 * configured by environment. Logs are pino JSON; no request body is ever logged.
 */
import { destination, pino } from 'pino';
import { EX_CONFIG, formatProblems, loadConfig } from './config.js';
import { startFakes, type ReadText, type RunningFakes } from './run.js';

export interface CliIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stderr: (text: string) => void;
  /** pino destination; standard output by default. */
  readonly logDestination?: { write(line: string): void };
  readonly read?: ReadText;
}

export type CliResult =
  | { readonly exitCode: 0; readonly fakes: RunningFakes }
  | { readonly exitCode: typeof EX_CONFIG; readonly fakes?: undefined };

export async function runCli(argv: readonly string[], io: CliIo): Promise<CliResult> {
  const loaded = loadConfig(argv, io.env);
  if (!loaded.ok) {
    io.stderr(`${formatProblems(loaded.problems)}\n`);
    return { exitCode: EX_CONFIG };
  }
  const config = loaded.config;
  const logger = pino(
    { level: config.logLevel, base: { app: 'argus-fakes', version: config.version } },
    io.logDestination ?? destination(1),
  );
  const started = await startFakes(config, logger, io.read);
  if (!started.ok) {
    io.stderr(`${formatProblems(started.problems)}\n`);
    return { exitCode: EX_CONFIG };
  }
  return { exitCode: 0, fakes: started.fakes };
}
