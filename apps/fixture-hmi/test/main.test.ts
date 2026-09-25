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

  it('reads every variable', () => {
    expect(
      readConfig({
        FIXTURE_PORT: '5050',
        FIXTURE_HOST: '127.0.0.1',
        FIXTURE_SEED: '42',
        FIXTURE_OPERATOR_PASSWORD: 'other',
      }),
    ).toEqual({ port: 5050, host: '127.0.0.1', seed: 42, operatorPassword: 'other' });
  });

  it('fails fast on a malformed number instead of silently falling back (round-2 review)', () => {
    expect(() => readConfig({ FIXTURE_PORT: 'not-a-number' })).toThrow(/FIXTURE_PORT/);
    expect(() => readConfig({ FIXTURE_SEED: 'nope' })).toThrow(/FIXTURE_SEED/);
  });

  it('fails fast on a value with a valid numeric prefix but trailing garbage, not `parseInt`\'s lenient prefix parse (round-3 review)', () => {
    // `Number.parseInt('12abc', 10)` is `12`, not `NaN`, so a naive `parseInt`-based
    // check let this kind of malformed value through as if it were clean.
    expect(() => readConfig({ FIXTURE_SEED: '12abc' })).toThrow(/FIXTURE_SEED/);
    expect(() => readConfig({ FIXTURE_PORT: '80abc' })).toThrow(/FIXTURE_PORT/);
  });

  it('accepts a leading/trailing-whitespace-padded integer and a signed one', () => {
    expect(readConfig({ FIXTURE_SEED: ' 42 ' }).seed).toBe(42);
    expect(readConfig({ FIXTURE_SEED: '+7' }).seed).toBe(7);
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

  it('never prints through plain console.log/console.error, only pino JSON (round-3 review)', async () => {
    // CLAUDE.md section 3: "pino JSON logs"; console.log/console.error interleave plain
    // text with Fastify's own pino JSON lines on the same stream.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const handle = await main({ FIXTURE_PORT: '0', FIXTURE_HOST: '127.0.0.1' });
      await handle.close();
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
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
