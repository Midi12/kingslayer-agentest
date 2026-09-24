import { describe, expect, it, vi } from 'vitest';
import { installShutdownHandlers, main, readConfig } from '../src/main.js';

describe('readConfig', () => {
  it('applies defaults when the environment is empty', () => {
    expect(readConfig({})).toEqual({
      port: 4000,
      host: '0.0.0.0',
      seed: 1,
      operatorPassword: 'op-secret-2026',
    });
  });

  it('reads every variable, falling back on a malformed number', () => {
    expect(
      readConfig({
        FIXTURE_PORT: '5050',
        FIXTURE_HOST: '127.0.0.1',
        FIXTURE_SEED: '42',
        FIXTURE_OPERATOR_PASSWORD: 'other',
      }),
    ).toEqual({ port: 5050, host: '127.0.0.1', seed: 42, operatorPassword: 'other' });
    expect(readConfig({ FIXTURE_PORT: 'not-a-number' }).port).toBe(4000);
  });
});

describe('main', () => {
  it('starts a real server on the configured port and seed', async () => {
    const handle = await main({ FIXTURE_PORT: '0', FIXTURE_HOST: '127.0.0.1', FIXTURE_SEED: '9' });
    try {
      const res = await fetch(`${handle.url}/healthz`);
      expect(res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });
});

describe('installShutdownHandlers', () => {
  it('closes the server and calls exit(0) on SIGTERM', async () => {
    const handle = await main({ FIXTURE_PORT: '0', FIXTURE_HOST: '127.0.0.1' });
    const exit = vi.fn();
    installShutdownHandlers(handle, exit);
    process.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });
    const after = await fetch(`${handle.url}/healthz`).catch((error: unknown) => error);
    expect(after).toBeInstanceOf(Error);
  });
});
