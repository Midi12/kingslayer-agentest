/**
 * The git-reading half of M01-G4 (`test/gate-g4.git.ts`). It is kept out of the default
 * suite, which also runs in a clean `git archive` export without history (M00-G1), and
 * runs only through `test:gate-g4` (gate change M01-4).
 */
import { defineArgusVitestConfig } from '../../packages/testkit/src/vitest-preset.js';

export default defineArgusVitestConfig({ kind: 'package', include: ['test/**/*.git.ts'] });
