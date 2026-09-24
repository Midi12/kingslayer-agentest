/**
 * Shared Vitest configuration for every package and app.
 *
 * A `vitest.config.ts` imports this file by relative path, because Vitest loads config
 * files before any resolve condition applies (ADR M00-vitest-preset):
 *
 *   import { defineArgusVitestConfig } from '../../packages/testkit/src/vitest-preset.js';
 *   export default defineArgusVitestConfig({ kind: 'package' });
 */
import { fileURLToPath } from 'node:url';
import { defineConfig, type ViteUserConfig } from 'vitest/config';

export type ArgusProjectKind = 'package' | 'app';

/** Minimum line coverage by project kind (implementation spec, global gate G0). */
export const COVERAGE_FLOOR: Readonly<Record<ArgusProjectKind, number>> = {
  package: 85,
  app: 70,
};

/** Resolve conditions: workspace packages resolve to their TypeScript sources. */
export const SOURCE_CONDITIONS: readonly string[] = [
  '@argus/source',
  'module',
  'node',
  'development|production',
];

/** At most two worker processes per Vitest run (CLAUDE.md section 1). */
export const MAX_WORKERS = 2;

/**
 * The setup file next to the given module URL: `network-guard.setup.ts` beside the
 * TypeScript source, `network-guard.setup.js` beside the built `dist` module.
 */
export function networkGuardSetupFileFor(moduleUrl: string): string {
  const extension = new URL(moduleUrl).pathname.endsWith('.ts') ? 'ts' : 'js';
  return fileURLToPath(new URL(`./network-guard.setup.${extension}`, moduleUrl));
}

export const networkGuardSetupFile = networkGuardSetupFileFor(import.meta.url);

export interface ArgusCoverageOptions {
  /** Line coverage threshold; may be raised above the floor, never lowered below it. */
  lines?: number;
  functions?: number;
  branches?: number;
  statements?: number;
  /** Extra coverage exclusions, relative to the package root. */
  exclude?: readonly string[];
}

export interface ArgusVitestOptions {
  kind?: ArgusProjectKind;
  coverage?: ArgusCoverageOptions;
  /** Test file globs; defaults to `test/**\/*.test.ts`. */
  include?: readonly string[];
  /** Extra setup files, run after the network guard. */
  setupFiles?: readonly string[];
  /** Worker processes, capped at MAX_WORKERS. */
  maxWorkers?: number;
  testTimeout?: number;
  hookTimeout?: number;
}

/** Resolved coverage thresholds; throws when a threshold is set below the floor. */
export function coverageThresholds(
  kind: ArgusProjectKind,
  coverage: ArgusCoverageOptions = {},
): { lines: number; functions?: number; branches?: number; statements?: number } {
  const floor = COVERAGE_FLOOR[kind];
  const lines = coverage.lines ?? floor;
  if (lines < floor) {
    throw new Error(
      `line coverage threshold ${String(lines)} is below the ${kind} floor of ${String(floor)}`,
    );
  }
  return {
    lines,
    ...(coverage.functions === undefined ? {} : { functions: coverage.functions }),
    ...(coverage.branches === undefined ? {} : { branches: coverage.branches }),
    ...(coverage.statements === undefined ? {} : { statements: coverage.statements }),
  };
}

export function defineArgusVitestConfig(options: ArgusVitestOptions = {}): ViteUserConfig {
  const kind = options.kind ?? 'package';
  const conditions = [...SOURCE_CONDITIONS];
  const workers = Math.max(1, Math.min(options.maxWorkers ?? MAX_WORKERS, MAX_WORKERS));
  return defineConfig({
    resolve: { conditions },
    ssr: { resolve: { conditions, externalConditions: ['@argus/source'] } },
    test: {
      include: [...(options.include ?? ['test/**/*.test.ts'])],
      exclude: ['**/node_modules/**', '**/dist/**', '**/fixtures/**'],
      setupFiles: [networkGuardSetupFile, ...(options.setupFiles ?? [])],
      pool: 'forks',
      poolOptions: { forks: { minForks: 1, maxForks: workers } },
      testTimeout: options.testTimeout ?? 15_000,
      hookTimeout: options.hookTimeout ?? 30_000,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.d.ts', ...(options.coverage?.exclude ?? [])],
        reporter: ['text-summary', 'json-summary'],
        thresholds: coverageThresholds(kind, options.coverage),
      },
    },
  });
}
