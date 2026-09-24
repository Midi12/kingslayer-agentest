/**
 * `@argus/fixture-hmi` public surface: `createFixtureServer` builds and starts the
 * fixture HMI for in-process tests (bind port 0 by default) and for `src/main.ts`. This
 * file is the package's composition root: it is the only place that wires the Fastify
 * adapter, the clock adapter and the core simulator together.
 */
import { buildServer } from './adapters/http/server.js';
import { SimClock, type ClockMode } from './adapters/clock.js';
import { FixtureSimulator } from './core/sim.js';

export { FixtureSimulator } from './core/sim.js';
export type { ClockMode } from './adapters/clock.js';
export { FAULT_NAMES, CONVEYOR_IDS } from './core/types.js';
export type { FaultName, ConveyorStatus, SimSnapshot } from './core/types.js';
// The dataset schemas and helpers: M04, M06, M10 and M19 read `datasets/*.jsonl` and
// need these to parse and validate the rows rather than re-deriving the shapes.
export {
  BREAK_EXPECTATIONS,
  GROUNDING_ACTIONS,
  GroundingTarget,
  GroundingTask,
  BreakTask,
  PAGES,
  parseJsonl,
  toJsonl,
} from './core/dataset-schema.js';
export type { BreakExpectation, GroundingAction, Page } from './core/dataset-schema.js';

export const DEFAULT_OPERATOR_PASSWORD = 'op-secret-2026';

export interface CreateFixtureServerOptions {
  readonly seed?: number;
  readonly port?: number;
  readonly host?: string;
  readonly clock?: ClockMode;
  readonly operatorPassword?: string;
  /** Fastify's own request logging; off by default so tests stay quiet. */
  readonly logger?: boolean;
}

export interface FixtureServerHandle {
  /** The server's base URL, e.g. `http://127.0.0.1:51234`. */
  readonly url: string;
  readonly sim: FixtureSimulator;
  readonly clock: SimClock;
  close(): Promise<void>;
}

/** Starts the fixture HMI and returns its URL, the raw simulator and a close function. */
export async function createFixtureServer(
  options: CreateFixtureServerOptions = {},
): Promise<FixtureServerHandle> {
  const seed = options.seed ?? 1;
  const startAtMs = Date.now();
  const clock = new SimClock(options.clock ?? 'real', startAtMs);
  const sim = new FixtureSimulator({
    seed,
    operatorPassword: options.operatorPassword ?? DEFAULT_OPERATOR_PASSWORD,
    atMs: clock.now(),
  });
  const app = buildServer({ sim, clock, logger: options.logger ?? false });
  const address = await app.listen({ port: options.port ?? 0, host: options.host ?? '127.0.0.1' });
  return {
    url: address,
    sim,
    clock,
    close: () => app.close(),
  };
}
