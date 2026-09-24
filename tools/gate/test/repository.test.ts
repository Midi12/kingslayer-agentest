/**
 * The workspace skeleton M00 delivers: root configuration, per-package conventions,
 * shared services and CI definitions. Later packages are held to the same conventions.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '../../..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const json = (path: string): Record<string, unknown> =>
  JSON.parse(read(path)) as Record<string, unknown>;
const yaml = (path: string): Record<string, unknown> =>
  parse(read(path)) as Record<string, unknown>;

function workspacePackages(): string[] {
  return ['apps', 'packages', 'tools'].flatMap((group) =>
    existsSync(join(root, group))
      ? readdirSync(join(root, group))
          .map((name) => `${group}/${name}`)
          .filter((path) => existsSync(join(root, path, 'package.json')))
      : [],
  );
}

describe('root workspace', () => {
  it('pins the package manager, the engine and the scripts', () => {
    const pkg = json('package.json');
    expect(pkg).toMatchObject({
      private: true,
      type: 'module',
      packageManager: 'pnpm@10.33.0',
      engines: { node: '>=22 <23' },
    });
    expect(Object.keys(pkg.scripts as object)).toEqual(
      expect.arrayContaining([
        'build',
        'typecheck',
        'lint',
        'format',
        'test',
        'depcruise',
        'gate',
        'g0',
        'gate-guard',
        'scenario',
      ]),
    );
  });

  it('says the scenario runner is not available yet, with exit 3', () => {
    const run = spawnSync('pnpm', ['--silent', 'scenario', 'S1'], { cwd: root, encoding: 'utf8' });
    expect(run.status).toBe(3);
    expect(run.stderr).toMatch(/not yet available/);
  });

  it('configures the pnpm workspace', () => {
    const workspace = yaml('pnpm-workspace.yaml');
    expect(workspace.packages).toEqual(['apps/*', 'packages/*', 'tools/*']);
    expect(workspace.injectWorkspacePackages).toBe(true);
    expect(workspace.onlyBuiltDependencies).toEqual(expect.arrayContaining(['esbuild', 'sharp']));
  });

  it('defines the Turborepo tasks', () => {
    const tasks = json('turbo.json').tasks as Record<
      string,
      { dependsOn?: string[]; outputs?: string[] }
    >;
    expect(Object.keys(tasks)).toEqual(
      expect.arrayContaining(['build', 'typecheck', 'lint', 'test', 'depcruise']),
    );
    expect(tasks.build).toMatchObject({ dependsOn: ['^build'], outputs: ['dist/**'] });
  });

  it('has a strict TypeScript base with the source condition', () => {
    expect(json('tsconfig.base.json').compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2023',
      customConditions: ['@argus/source'],
      declaration: true,
      sourceMap: true,
      verbatimModuleSyntax: true,
    });
  });

  it('lints with typescript-eslint strict and forbids any and non-null assertions', async () => {
    const module = (await import(join(root, 'eslint.config.js'))) as { default: unknown };
    const configs = module.default as {
      files?: unknown;
      rules?: Record<string, unknown>;
    }[];
    const global = configs.filter((config) => config.files === undefined);
    const rules = Object.assign({}, ...global.map((config) => config.rules ?? {})) as Record<
      string,
      unknown
    >;
    expect(rules['@typescript-eslint/no-explicit-any']).toBe('error');
    expect(rules['@typescript-eslint/no-non-null-assertion']).toBe('error');
    expect(rules['@typescript-eslint/no-unsafe-assignment']).toBe('error');
  });

  it('declares the four dependency rules', () => {
    const require = createRequire(join(root, 'package.json'));
    const config = require(join(root, '.dependency-cruiser.cjs')) as {
      forbidden: { name: string; severity: string }[];
    };
    expect(config.forbidden.map((rule) => rule.name)).toEqual(
      expect.arrayContaining([
        'core-not-to-adapters',
        'core-not-to-io-builtins',
        'core-npm-allow-list',
        'adapters-only-from-composition-roots',
        'no-testkit-in-production',
        'no-circular',
      ]),
    );
    expect(new Set(config.forbidden.map((rule) => rule.severity))).toEqual(new Set(['error']));
  });
});

describe.each(workspacePackages())('workspace package %s', (path) => {
  const pkg = json(`${path}/package.json`);

  it('is an ESM package named @argus/* whose exports resolve to sources under @argus/source', () => {
    expect(pkg.name).toMatch(/^@argus\/[a-z0-9-]+$/);
    expect(pkg.type).toBe('module');
    const dot = (pkg.exports as Record<string, Record<string, string>>)['.'];
    expect(Object.keys(dot ?? {})).toEqual(['@argus/source', 'types', 'default']);
    expect(dot).toEqual({
      '@argus/source': './src/index.ts',
      types: './dist/index.d.ts',
      default: './dist/index.js',
    });
    expect(existsSync(join(root, path, 'src', 'index.ts'))).toBe(true);
  });

  it('has the build, typecheck, lint, test and depcruise scripts', () => {
    expect(Object.keys(pkg.scripts as object)).toEqual(
      expect.arrayContaining(['build', 'typecheck', 'lint', 'test', 'depcruise']),
    );
  });

  it('extends the base tsconfig and builds dist from src', () => {
    expect(json(`${path}/tsconfig.json`)).toMatchObject({ extends: '../../tsconfig.base.json' });
    expect(json(`${path}/tsconfig.build.json`)).toMatchObject({
      extends: '../../tsconfig.base.json',
      compilerOptions: { rootDir: 'src', outDir: 'dist' },
      include: ['src'],
    });
  });

  it('tests through the shared Vitest preset, so the network guard is installed', () => {
    const config = read(`${path}/vitest.config.ts`);
    expect(config).toMatch(
      /packages\/testkit\/src\/vitest-preset\.js'|'\.\/src\/vitest-preset\.js'/,
    );
    expect(config).toMatch(/defineArgusVitestConfig\(/);
  });
});

describe('compose.dev.yaml', () => {
  const compose = yaml('compose.dev.yaml');
  const services = compose.services as Record<string, Record<string, unknown>>;

  it('has a fixed project name and the two shared services', () => {
    expect(compose.name).toBe('argus-dev');
    // Services behind a profile (the M03 fakes) start only on request.
    const alwaysOn = Object.keys(services).filter((name) => services[name]?.profiles === undefined);
    expect(alwaysOn.sort()).toEqual(['postgres', 's3']);
    expect(services.postgres?.image).toBe(
      '${DOCKERHUB_MIRROR:-docker.io}/library/postgres:16-bookworm',
    );
    expect(services.postgres?.environment).toEqual({
      POSTGRES_USER: 'argus',
      POSTGRES_PASSWORD: 'argus',
      POSTGRES_DB: 'argus',
    });
    expect(services.s3?.image).toMatch(
      /^ghcr\.io\/versity\/versitygw:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/,
    );
    expect(services.s3?.environment).toMatchObject({
      ROOT_ACCESS_KEY: 'argus',
      ROOT_SECRET_KEY: 'argus-dev-secret',
    });
  });

  it('publishes on loopback only, uses named volumes and has health checks', () => {
    expect(services.postgres?.ports).toEqual(['127.0.0.1:5432:5432']);
    expect(services.s3?.ports).toEqual(['127.0.0.1:9000:7070']);
    const volumes = compose.volumes as Record<string, unknown>;
    for (const service of Object.values(services)) {
      for (const volume of (service.volumes ?? []) as string[]) {
        const source = volume.split(':')[0] ?? '';
        expect(source in volumes || isAbsolute(source), `${volume} must be a named volume`).toBe(
          true,
        );
      }
      expect(service.healthcheck).toBeDefined();
      expect(service.configs).toBeUndefined();
    }
  });
});

describe('CI definitions', () => {
  it('runs gate-guard, tier-a and build-images on GitHub, with the same jobs in the GitLab reference', () => {
    const github = yaml('.github/workflows/ci.yml');
    expect(Object.keys(github.jobs as object)).toEqual(['gate-guard', 'tier-a', 'build-images']);
    expect(Object.keys(github.on as object)).toEqual(['pull_request', 'push', 'workflow_dispatch']);
    expect((github.on as { push: { branches: string[] } }).push.branches).toEqual([
      'main',
      'master',
    ]);
    const text = read('.github/workflows/ci.yml');
    expect(text).toMatch(/pnpm gate-guard --range "\$base\.\.\$head" --per-commit/);
    expect(text).toMatch(/pnpm gate all --tier A/);
    expect(text).toMatch(/docker-bake\.hcl/);
    const gitlab = yaml('.gitlab-ci.yml');
    expect(Object.keys(gitlab)).toEqual(
      expect.arrayContaining(['gate-guard', 'tier-a', 'build-images', 'tier-b']),
    );
  });

  it('runs Tier B nightly with the credentials as secrets', () => {
    const text = read('.github/workflows/tier-b.yml');
    expect(text).toMatch(/cron:/);
    expect(text).toMatch(/TYPESAFE_API_KEY: \$\{\{ secrets\.TYPESAFE_API_KEY \}\}/);
    expect(text).toMatch(/ARGUS_LLM_API_KEY: \$\{\{ secrets\.ARGUS_LLM_API_KEY \}\}/);
    expect(text).toMatch(/pnpm gate all --tier B/);
  });

  it('routes every protected path to a code owner', () => {
    const owners = read('.github/CODEOWNERS');
    for (const path of [
      '/gates/*.yaml',
      '**/__golden__/**',
      '/thresholds/',
      '/prompts/',
      '/packages/navigator/src/questions.ts',
    ]) {
      expect(owners).toContain(path);
    }
  });
});
