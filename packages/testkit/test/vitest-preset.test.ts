import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_FLOOR,
  MAX_WORKERS,
  SOURCE_CONDITIONS,
  coverageThresholds,
  defineArgusVitestConfig,
  networkGuardSetupFile,
} from '../src/vitest-preset.js';

describe('defineArgusVitestConfig', () => {
  it('installs the network guard, the source condition, forks and the package floor', () => {
    const config = defineArgusVitestConfig();
    expect(existsSync(networkGuardSetupFile)).toBe(true);
    expect(config.test?.setupFiles).toEqual([networkGuardSetupFile]);
    expect(config.resolve?.conditions).toEqual([...SOURCE_CONDITIONS]);
    expect(config.ssr?.resolve?.conditions).toEqual([...SOURCE_CONDITIONS]);
    expect(SOURCE_CONDITIONS[0]).toBe('@argus/source');
    expect(config.test?.pool).toBe('forks');
    expect(config.test?.poolOptions?.forks?.maxForks).toBe(MAX_WORKERS);
    expect(config.test?.coverage?.provider).toBe('v8');
    const coverage = config.test?.coverage as { thresholds?: { lines?: number } } | undefined;
    expect(coverage?.thresholds?.lines).toBe(85);
    expect(config.test?.include).toEqual(['test/**/*.test.ts']);
  });

  it('applies app floors, raised thresholds, extra setup files and caps the workers', () => {
    const config = defineArgusVitestConfig({
      kind: 'app',
      coverage: {
        lines: 90,
        branches: 80,
        functions: 75,
        statements: 88,
        exclude: ['src/generated/**'],
      },
      include: ['test/**/*.spec.ts'],
      setupFiles: ['./test/setup.ts'],
      maxWorkers: 8,
      testTimeout: 1_000,
      hookTimeout: 2_000,
    });
    expect(config.test?.setupFiles).toEqual([networkGuardSetupFile, './test/setup.ts']);
    expect(config.test?.poolOptions?.forks?.maxForks).toBe(2);
    expect(config.test?.testTimeout).toBe(1_000);
    expect(config.test?.hookTimeout).toBe(2_000);
    expect(config.test?.include).toEqual(['test/**/*.spec.ts']);
    const coverage = config.test?.coverage as {
      exclude?: string[];
      thresholds?: Record<string, number>;
    };
    expect(coverage.exclude).toContain('src/generated/**');
    expect(coverage.thresholds).toEqual({ lines: 90, branches: 80, functions: 75, statements: 88 });
    expect(defineArgusVitestConfig({ maxWorkers: 0 }).test?.poolOptions?.forks?.maxForks).toBe(1);
  });
});

describe('coverageThresholds', () => {
  it('uses the floor by kind', () => {
    expect(COVERAGE_FLOOR).toEqual({ package: 85, app: 70 });
    expect(coverageThresholds('package')).toEqual({ lines: 85 });
    expect(coverageThresholds('app')).toEqual({ lines: 70 });
  });

  it('refuses a threshold below the floor', () => {
    expect(() => coverageThresholds('package', { lines: 80 })).toThrow(
      /below the package floor of 85/,
    );
    expect(() => coverageThresholds('app', { lines: 69 })).toThrow(/below the app floor of 70/);
  });
});
