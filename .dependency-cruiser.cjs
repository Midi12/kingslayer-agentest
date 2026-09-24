/**
 * Dependency rules of the implementation spec (M00, "Two structural rules" of the
 * architecture): core is pure, adapters are wired only at composition roots, the testkit
 * stays out of production code, and there are no cycles.
 *
 * Paths are matched without a leading anchor so the same rules apply to the M00-G3
 * fixture tree under tools/gate/test/fixtures, which mirrors the repository layout.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */

/** Node built-ins that perform I/O; `core` may not import them. */
const IO_BUILTINS = [
  'fs',
  'fs/promises',
  'net',
  'http',
  'https',
  'http2',
  'child_process',
  'dgram',
  'dns',
  'dns/promises',
  'tls',
  'worker_threads',
  'cluster',
];

/** npm packages `core` may import. */
const CORE_NPM_ALLOW_LIST = ['@argus/contracts', '@sinclair/typebox'];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Captures the path prefix ($1, empty for the real tree), the project kind ($2) and name ($3). */
const PROJECT = '^(|.*/)(packages|apps|tools)/([^/]+)/';

module.exports = {
  forbidden: [
    {
      name: 'core-not-to-adapters',
      comment: 'core is pure: it never imports an adapter, of its own package or another one.',
      severity: 'error',
      from: { path: `${PROJECT}src/core/` },
      to: { path: `${PROJECT}src/adapters/` },
    },
    {
      name: 'core-only-core-and-ports',
      comment:
        'Inside its package, core imports only core and ports, so it cannot reach an adapter through the index or a service.',
      severity: 'error',
      from: { path: `${PROJECT}src/core/` },
      to: {
        path: '^$1$2/$3/src/',
        pathNot: ['^$1$2/$3/src/(core|ports)/'],
      },
    },
    {
      name: 'core-not-to-io-builtins',
      comment: 'core performs no I/O: time, ids and effects come through ports.',
      severity: 'error',
      from: { path: `${PROJECT}src/core/` },
      to: {
        dependencyTypes: ['core'],
        path: `^(node:)?(${IO_BUILTINS.map(escapeRegExp).join('|')})$`,
      },
    },
    {
      name: 'core-npm-allow-list',
      comment: `core imports npm packages only from the allow-list: ${CORE_NPM_ALLOW_LIST.join(', ')}.`,
      severity: 'error',
      from: { path: `${PROJECT}src/core/` },
      to: {
        path: 'node_modules/',
        pathNot: CORE_NPM_ALLOW_LIST.map((name) => `node_modules/${escapeRegExp(name)}/`),
      },
    },
    {
      name: 'core-not-to-other-workspace-packages',
      comment:
        'core imports no other workspace package except @argus/contracts, whether it resolves through node_modules or a workspace link.',
      severity: 'error',
      from: { path: `${PROJECT}src/core/` },
      to: {
        path: `${PROJECT}src/`,
        pathNot: ['^$1$2/$3/src/', '(^|/)packages/contracts/src/'],
      },
    },
    {
      name: 'adapters-only-from-composition-roots',
      comment:
        "A package's adapters are imported only by its own index or adapters, or by apps/*/src/main.ts and apps/*/src/wiring/**.",
      severity: 'error',
      from: {
        path: `${PROJECT}src/`,
        pathNot: [
          `${PROJECT}src/(index\\.ts|adapters/)`,
          '(^|/)apps/[^/]+/src/(main\\.ts|wiring/)',
        ],
      },
      to: { path: `${PROJECT}src/adapters/` },
    },
    {
      name: 'adapters-not-across-packages',
      comment:
        "A package's index and adapters reach only their own adapters; other packages' adapters come through that package's index.",
      severity: 'error',
      from: { path: `${PROJECT}src/(index\\.ts|adapters/)` },
      to: {
        path: `${PROJECT}src/adapters/`,
        pathNot: ['^$1$2/$3/src/adapters/'],
      },
    },
    {
      name: 'no-testkit-in-production',
      comment:
        '@argus/testkit is for tests; production sources import it only in apps/fixture-hmi, apps/fakes (the dev-only fake servers, ADR M03-packaging) and tools/**.',
      severity: 'error',
      from: {
        path: '(^|/)(packages|apps)/[^/]+/src/',
        pathNot: [
          '(^|/)packages/testkit/',
          '(^|/)apps/fixture-hmi/',
          '(^|/)apps/fakes/',
          '\\.test\\.ts$',
        ],
      },
      to: { path: ['(^|/)packages/testkit/', 'node_modules/@argus/testkit/'] },
    },
    {
      name: 'no-circular',
      comment: 'No dependency cycles.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Every import resolves.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    // node_modules stays in the graph as leaves (never excluded), so the npm allow-list
    // rule can see what core imports.
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['^(packages|apps|tools)/[^/]+/(dist|coverage)/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['@argus/source', 'import', 'require', 'node', 'default'],
      mainFields: ['module', 'main'],
      extensions: ['.ts', '.tsx', '.d.ts', '.js', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
