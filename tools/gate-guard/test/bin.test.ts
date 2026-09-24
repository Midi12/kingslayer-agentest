import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = resolve(import.meta.dirname, '..');
const registerSource = pathToFileURL(resolve(packageDir, 'bin', 'register-source.js')).href;

describe('bin launcher runtime', () => {
  it('resolves workspace packages to their sources through the @argus/source condition', () => {
    const script = [
      `const { registerSourceRuntime } = await import(${JSON.stringify(registerSource)});`,
      'registerSourceRuntime();',
      "const testkit = await import('@argus/testkit');",
      "console.log(import.meta.resolve('@argus/testkit') + ' ' + typeof testkit.isLoopbackHost);",
    ].join('\n');
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: packageDir,
      encoding: 'utf8',
    });
    expect(output.trim()).toMatch(/\/testkit\/src\/index\.ts function$/);
  });
});
