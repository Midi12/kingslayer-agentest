import { describe, expect, it } from 'vitest';
import { EX_CONFIG, formatProblems, loadConfig } from '../src/index.js';

describe('loadConfig', () => {
  it('defaults to all servers on the plan ports, loopback, scripted Jev', () => {
    const result = loadConfig([], {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      command: 'all',
      host: '127.0.0.1',
      version: 'dev',
      logLevel: 'info',
      jev: { port: 4100, apiKeys: undefined, mode: { kind: 'scripted', scriptFile: undefined } },
      llm: { port: 4200, apiKeys: undefined, scriptFile: undefined, fault: undefined },
      proxy: { port: 4300, mode: 'strict' },
    });
    expect(EX_CONFIG).toBe(78);
  });

  it('reads every key', () => {
    const result = loadConfig(['fake-jev'], {
      FAKE_HOST: '0.0.0.0',
      FAKE_JEV_PORT: '0',
      FAKE_JEV_MODE: 'oracle',
      FAKE_JEV_ORACLE_TARGETS: '/data/targets.json',
      FAKE_JEV_ORACLE_SEED: '42',
      FAKE_JEV_ORACLE_NOISE: '0.25',
      FAKE_JEV_API_KEY: 'a, b ,,c',
      FAKE_LLM_FAULT: 'refusal',
      ARGUS_VERSION: '1.2.3',
      LOG_LEVEL: 'debug',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.host).toBe('0.0.0.0');
    expect(result.config.jev).toEqual({
      port: 0,
      apiKeys: ['a', 'b', 'c'],
      mode: { kind: 'oracle', targetsFile: '/data/targets.json', seed: 42, noise: 0.25 },
    });
    expect(result.config.llm.fault).toBe('refusal');
    expect(result.config.version).toBe('1.2.3');
  });

  it('needs a cassette directory in cassette mode and the proxy settings for cassette-proxy', () => {
    expect(
      loadConfig(['fake-jev'], { FAKE_JEV_MODE: 'cassette', FAKE_JEV_CASSETTE_DIR: '/c' }),
    ).toMatchObject({
      ok: true,
      config: { jev: { mode: { kind: 'cassette', cassetteDir: '/c' } } },
    });
    const missing = loadConfig(['fake-jev'], { FAKE_JEV_MODE: 'cassette' });
    expect(missing).toEqual({
      ok: false,
      problems: [{ key: 'FAKE_JEV_CASSETTE_DIR', message: 'required in cassette mode' }],
    });
    const proxy = loadConfig(['cassette-proxy'], {});
    expect(proxy.ok ? [] : proxy.problems.map((p) => p.key)).toEqual([
      'FAKE_PROXY_UPSTREAM',
      'FAKE_PROXY_CASSETTE_DIR',
    ]);
    expect(
      loadConfig(['cassette-proxy'], {
        FAKE_PROXY_UPSTREAM: 'https://api.typesafe.ai',
        FAKE_PROXY_CASSETTE_DIR: '/c',
        FAKE_PROXY_MODE: 'record',
      }),
    ).toMatchObject({
      ok: true,
      config: { proxy: { upstream: 'https://api.typesafe.ai', cassetteDir: '/c', mode: 'record' } },
    });
    // A server that does not run does not need its keys.
    expect(loadConfig(['fake-llm'], { FAKE_JEV_MODE: 'oracle' }).ok).toBe(true);
  });

  it('names every invalid key and never prints a value', () => {
    const result = loadConfig(['serve'], {
      FAKE_JEV_PORT: '70000',
      FAKE_LLM_PORT: 'http',
      FAKE_JEV_MODE: 'replay',
      FAKE_JEV_ORACLE_NOISE: '2',
      FAKE_LLM_FAULT: 'explode',
      FAKE_PROXY_UPSTREAM: 'ftp://secret-host',
      FAKE_PROXY_MODE: 'sometimes',
      LOG_LEVEL: 'loud',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.key).sort()).toEqual(
      [
        'FAKE_JEV_MODE',
        'FAKE_JEV_PORT',
        'FAKE_LLM_FAULT',
        'FAKE_LLM_PORT',
        'FAKE_PROXY_MODE',
        'FAKE_PROXY_UPSTREAM',
        'LOG_LEVEL',
        'command',
      ].sort(),
    );
    const text = formatProblems(result.problems);
    expect(text).toMatch(/^invalid configuration: command must be one of/m);
    expect(text).not.toContain('secret-host');
    expect(text).not.toContain('explode');
  });

  it('rejects an oracle noise outside [0, 1]', () => {
    const result = loadConfig(['fake-jev'], {
      FAKE_JEV_MODE: 'oracle',
      FAKE_JEV_ORACLE_TARGETS: '/t.json',
      FAKE_JEV_ORACLE_NOISE: '1.5',
      FAKE_JEV_ORACLE_SEED: 'x',
    });
    expect(result.ok ? [] : result.problems.map((problem) => problem.key)).toEqual([
      'FAKE_JEV_ORACLE_SEED',
      'FAKE_JEV_ORACLE_NOISE',
    ]);
  });
});
