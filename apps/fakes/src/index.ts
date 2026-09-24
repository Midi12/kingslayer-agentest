/**
 * @argus/fakes: the dev-only servers of the argus/fakes image. `src/main.ts` is the entry
 * point; the functions below let tests and tools start the same servers in-process.
 */
export { COMMANDS, EX_CONFIG, formatProblems, loadConfig } from './config.js';
export type { Command, ConfigProblem, ConfigResult, FakesConfig, JevModeConfig } from './config.js';
export { startFakes } from './run.js';
export type { FakesLogger, ReadText, RunningFakes, RunningServer, StartResult } from './run.js';
export { runCli } from './cli.js';
export type { CliIo, CliResult } from './cli.js';
export { DEFAULT_STATUS_FILE, checkHealth, statusFile, writeStatus } from './health.js';
export type { FetchStatus } from './health.js';
