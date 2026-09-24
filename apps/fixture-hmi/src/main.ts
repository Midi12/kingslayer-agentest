/**
 * Process entrypoint: `node dist/main.js`, configured entirely from the environment
 * (CLAUDE.md section 3: adapters are wired only here and in `src/index.ts`).
 *
 *   FIXTURE_PORT (default 4000), FIXTURE_HOST (default 0.0.0.0),
 *   FIXTURE_SEED (default 1), FIXTURE_OPERATOR_PASSWORD (default op-secret-2026)
 *
 * `readConfig`, `main` and `installShutdownHandlers` are exported so a test can drive
 * them directly (with an injected environment and exit function) without touching the
 * real process; only the bottom guard runs when this file is the process entrypoint.
 */
import { pathToFileURL } from 'node:url';
import { createFixtureServer, DEFAULT_OPERATOR_PASSWORD, type FixtureServerHandle } from './index.js';

export interface FixtureConfig {
  readonly port: number;
  readonly host: string;
  readonly seed: number;
  readonly operatorPassword: string;
}

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readConfig(env: NodeJS.ProcessEnv): FixtureConfig {
  return {
    port: envInt(env, 'FIXTURE_PORT', 4000),
    host: env['FIXTURE_HOST'] ?? '0.0.0.0',
    seed: envInt(env, 'FIXTURE_SEED', 1),
    operatorPassword: env['FIXTURE_OPERATOR_PASSWORD'] ?? DEFAULT_OPERATOR_PASSWORD,
  };
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<FixtureServerHandle> {
  const config = readConfig(env);
  const handle = await createFixtureServer({ ...config, clock: 'real', logger: true });
  console.log(`fixture-hmi listening at ${handle.url}`);
  return handle;
}

/** Registers SIGTERM/SIGINT handlers that close the server and exit; `exit` is injectable for tests. */
export function installShutdownHandlers(
  handle: FixtureServerHandle,
  exit: (code: number) => void = process.exit.bind(process),
): void {
  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`fixture-hmi received ${signal}, closing`);
    handle
      .close()
      .then(() => {
        exit(0);
      })
      .catch(() => {
        exit(1);
      });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
/* c8 ignore start -- process bootstrap, exercised by running the built entrypoint, not by unit tests */
if (isMainModule) {
  main()
    .then((handle) => {
      installShutdownHandlers(handle);
    })
    .catch((error: unknown) => {
      console.error('fixture-hmi failed to start', error);
      process.exit(1);
    });
}
/* c8 ignore stop */
