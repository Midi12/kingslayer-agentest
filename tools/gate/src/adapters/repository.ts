import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

/** The workspace root: the nearest directory above `start` holding pnpm-workspace.yaml. */
export function findRepositoryRoot(start: string): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`no pnpm-workspace.yaml above ${start}`);
    }
    current = parent;
  }
}

/** The `options.exclude.path` patterns of the repository's dependency-cruiser config. */
export function loadDepcruiseExcludes(root: string): string[] {
  const require = createRequire(join(root, 'package.json'));
  const config = require(join(root, '.dependency-cruiser.cjs')) as {
    options?: { exclude?: { path?: string | string[] } };
  };
  const path = config.options?.exclude?.path;
  if (path === undefined) {
    return [];
  }
  return Array.isArray(path) ? path : [path];
}
