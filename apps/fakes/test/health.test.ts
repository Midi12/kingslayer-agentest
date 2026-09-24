import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeLlm } from '@argus/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STATUS_FILE, checkHealth, statusFile, writeStatus } from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function file(): string {
  const dir = mkdtempSync(join(tmpdir(), 'argus-health-'));
  dirs.push(dir);
  return join(dir, 'status.json');
}

describe('container health check', () => {
  it('reads the status file location from FAKE_STATUS_FILE', () => {
    expect(statusFile({})).toBe(DEFAULT_STATUS_FILE);
    expect(statusFile({ FAKE_STATUS_FILE: ' ' })).toBe(DEFAULT_STATUS_FILE);
    expect(statusFile({ FAKE_STATUS_FILE: '/run/x.json' })).toBe('/run/x.json');
  });

  it('is healthy when every started server answers /healthz', async () => {
    const llm = await startFakeLlm();
    const path = file();
    try {
      await writeStatus(path, [{ service: 'fake-llm', url: llm.url }]);
      expect(await checkHealth(path)).toEqual({ exitCode: 0, message: 'healthy: fake-llm' });
    } finally {
      await llm.close();
    }
    expect((await checkHealth(path)).exitCode).toBe(1);
  });

  it('is unhealthy without a status file, with an empty list, or on an error answer', async () => {
    const path = file();
    expect(await checkHealth(path)).toMatchObject({
      exitCode: 1,
      message: expect.stringMatching(/no status file/) as unknown,
    });
    writeFileSync(path, JSON.stringify({ servers: [] }));
    expect(await checkHealth(path)).toMatchObject({
      exitCode: 1,
      message: 'the status file lists no server',
    });
    await writeStatus(path, [{ service: 'fake-jev', url: 'http://127.0.0.1:9' }]);
    expect(await checkHealth(path, () => Promise.resolve({ ok: false }))).toEqual({
      exitCode: 1,
      message: 'fake-jev /healthz answered an error',
    });
  });
});
