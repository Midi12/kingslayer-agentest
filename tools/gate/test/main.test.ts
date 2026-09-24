import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { depcruiseMain, g0Main, gateMain } from '../src/main.js';

const root = resolve(import.meta.dirname, '../../..');
const context = { cwd: root, env: process.env };

function quietly<T>(action: () => Promise<T>): Promise<T> {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return action().finally(() => {
    out.mockRestore();
    err.mockRestore();
  });
}

describe('composition roots', () => {
  it('wires gate, g0 and depcruise', async () => {
    expect(await quietly(() => gateMain(['--help'], context))).toBe(0);
    expect(await quietly(() => g0Main(['--help'], context))).toBe(0);
    expect(await quietly(() => g0Main(['packages/does-not-exist'], context))).toBe(2);
    expect(await quietly(() => depcruiseMain(['--help'], context))).toBe(0);
  });

  it('runs dependency-cruiser in process against fixtures', async () => {
    const fixtures = join('tools', 'gate', 'test', 'fixtures', 'depcruise');
    expect(await quietly(() => depcruiseMain([join(fixtures, 'clean')], context))).toBe(0);
    expect(await quietly(() => depcruiseMain([join(fixtures, 'core-to-adapter')], context))).toBe(
      1,
    );
  });

  it('defaults to the process working directory and environment', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    try {
      expect(await quietly(() => gateMain(['--help']))).toBe(0);
      expect(await quietly(() => g0Main(['--help']))).toBe(0);
      expect(await quietly(() => depcruiseMain(['--help']))).toBe(0);
    } finally {
      cwd.mockRestore();
    }
  });
});
