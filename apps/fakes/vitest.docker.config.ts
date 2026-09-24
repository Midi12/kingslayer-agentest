import { defineArgusVitestConfig } from '../../packages/testkit/src/vitest-preset.js';

// Tier C gate M03-G6: builds and runs the argus/fakes image; not part of `pnpm test`.
export default defineArgusVitestConfig({
  kind: 'app',
  include: ['test/**/*.docker.ts'],
  maxWorkers: 1,
  testTimeout: 1_500_000,
  hookTimeout: 1_500_000,
});
