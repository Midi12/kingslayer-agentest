import { defineArgusVitestConfig } from '../../packages/testkit/src/vitest-preset.js';

export default defineArgusVitestConfig({
  kind: 'app',
  testTimeout: 90_000,
  hookTimeout: 60_000,
  coverage: {
    // Playwright-driven gate suites exercise the routes end to end; the process
    // entrypoint's bootstrap guard is excluded (it is `/* c8 ignore */`d, see main.ts).
    exclude: ['scripts/**'],
  },
});
