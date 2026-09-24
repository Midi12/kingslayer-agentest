import { defineArgusVitestConfig } from '../../packages/testkit/src/vitest-preset.js';

export default defineArgusVitestConfig({ kind: 'package', testTimeout: 120_000 });
