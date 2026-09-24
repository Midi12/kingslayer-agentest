import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { TypeSafeClient, choice, noul } from '@typesafe-ai/sdk';
import { DEFAULT_FAKE_JEV_API_KEY, DEFAULT_FAKE_LLM_API_KEY, startFakeJev } from '@argus/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadConfig,
  runCli,
  startFakes,
  type FakesConfig,
  type FakesLogger,
} from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function dir(): string {
  const path = mkdtempSync(join(tmpdir(), 'argus-fakes-'));
  dirs.push(path);
  return path;
}

function config(argv: string[], env: Record<string, string>): FakesConfig {
  const result = loadConfig(argv, {
    FAKE_JEV_PORT: '0',
    FAKE_LLM_PORT: '0',
    FAKE_PROXY_PORT: '0',
    ...env,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.config;
}

const logs: { level: string; object: Record<string, unknown>; message: string }[] = [];
const logger: FakesLogger = {
  info: (object, message) => logs.push({ level: 'info', object, message }),
  debug: (object, message) => logs.push({ level: 'debug', object, message }),
};

function urlOf(servers: readonly { service: string; url: string }[], service: string): string {
  const found = servers.find((server) => server.service === service);
  if (found === undefined) throw new Error(`${service} not started`);
  return found.url;
}

describe('startFakes', () => {
  it('starts fake-jev and fake-llm for `all`, each with /healthz, and logs requests without bodies', async () => {
    const root = dir();
    writeFileSync(
      join(root, 'llm.json'),
      JSON.stringify({ response: { text: 'scripted answer' } }),
    );
    const started = await startFakes(
      config([], { FAKE_LLM_SCRIPT: join(root, 'llm.json'), ARGUS_VERSION: '9.9.9' }),
      logger,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    try {
      expect(started.fakes.servers.map((server) => server.service)).toEqual([
        'fake-jev',
        'fake-llm',
      ]);
      const jevUrl = urlOf(started.fakes.servers, 'fake-jev');
      const llmUrl = urlOf(started.fakes.servers, 'fake-llm');
      expect(await (await fetch(`${jevUrl}/healthz`)).json()).toMatchObject({
        status: 'ok',
        service: 'fake-jev',
        version: '9.9.9',
      });
      expect(await (await fetch(`${llmUrl}/healthz`)).json()).toMatchObject({
        status: 'ok',
        service: 'fake-llm',
      });

      // Without a script file every Jev question gets the uniform answer.
      const sdk = new TypeSafeClient({
        apiKey: DEFAULT_FAKE_JEV_API_KEY,
        baseURL: jevUrl,
        logLevel: 'off',
      });
      const result = await sdk.systemOne({
        state: 'secret page text',
        questions: { pick: choice('Pick', { a: null, b: null }), ok: noul('Is it ok?') },
      });
      expect(result.answers.pick.probabilities).toEqual({ a: 0.5, b: 0.5 });
      expect(result.answers.ok.noul).toBe(0.5);

      const message = await new Anthropic({
        apiKey: DEFAULT_FAKE_LLM_API_KEY,
        baseURL: llmUrl,
        maxRetries: 0,
      }).messages.create({
        model: 'claude-opus-5',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'secret page text' }],
      });
      expect(message.content).toEqual([{ type: 'text', text: 'scripted answer' }]);
      expect(
        logs.filter((log) => log.message === 'request').map((log) => log.object.service),
      ).toEqual(['fake-jev', 'fake-llm']);
      expect(JSON.stringify(logs)).not.toContain('secret page text');
    } finally {
      await started.fakes.close();
    }
  });

  it('serves the oracle from a target file, and cassettes from a directory', async () => {
    const root = dir();
    writeFileSync(join(root, 'targets.json'), JSON.stringify({ 'Start C12': 'c17' }));
    const oracle = await startFakes(
      config(['fake-jev'], {
        FAKE_JEV_MODE: 'oracle',
        FAKE_JEV_ORACLE_TARGETS: join(root, 'targets.json'),
      }),
      logger,
    );
    expect(oracle.ok).toBe(true);
    if (!oracle.ok) return;
    try {
      const sdk = new TypeSafeClient({
        apiKey: DEFAULT_FAKE_JEV_API_KEY,
        baseURL: urlOf(oracle.fakes.servers, 'fake-jev'),
        logLevel: 'off',
      });
      const result = await sdk.systemOne({
        state: { step: { target: 'Start C12' } },
        questions: { target: choice('Which?', { c16: null, c17: null }) },
      });
      expect(result.answers.target.choice).toBe('c17');
    } finally {
      await oracle.fakes.close();
    }

    const cassette = await startFakes(
      config(['fake-jev'], { FAKE_JEV_MODE: 'cassette', FAKE_JEV_CASSETTE_DIR: root }),
      logger,
    );
    expect(cassette.ok).toBe(true);
    if (!cassette.ok) return;
    try {
      const response = await fetch(`${urlOf(cassette.fakes.servers, 'fake-jev')}/v1/systemone`, {
        method: 'POST',
        headers: { authorization: `Bearer ${DEFAULT_FAKE_JEV_API_KEY}` },
        body: JSON.stringify({ state: null, questions: { q: { type: 'noul' } } }),
      });
      expect(response.status).toBe(404);
    } finally {
      await cassette.fakes.close();
    }
  });

  it('runs the cassette proxy in front of an upstream', async () => {
    const upstream = await startFakeJev({
      mode: { kind: 'scripted', script: { answers: { q: true } } },
    });
    const root = dir();
    try {
      const started = await startFakes(
        config(['cassette-proxy'], {
          FAKE_PROXY_UPSTREAM: upstream.url,
          FAKE_PROXY_CASSETTE_DIR: root,
          FAKE_PROXY_MODE: 'auto',
        }),
        logger,
      );
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      try {
        const proxyUrl = urlOf(started.fakes.servers, 'cassette-proxy');
        expect((await fetch(`${proxyUrl}/healthz`)).status).toBe(200);
        const sdk = new TypeSafeClient({
          apiKey: DEFAULT_FAKE_JEV_API_KEY,
          baseURL: proxyUrl,
          logLevel: 'off',
        });
        const first = await sdk.systemOne({ state: 's', questions: { q: noul('Q?') } });
        const second = await sdk.systemOne({ state: 's', questions: { q: noul('Q?') } });
        expect(second).toEqual(first);
        expect(upstream.requests).toHaveLength(1);
      } finally {
        await started.fakes.close();
      }
    } finally {
      await upstream.close();
    }
  });

  it('reports unreadable, malformed and invalid files by key', async () => {
    const root = dir();
    writeFileSync(join(root, 'bad.json'), '{ not json');
    writeFileSync(join(root, 'wrong.json'), JSON.stringify({ answers: { q: { choice: 3 } } }));
    writeFileSync(join(root, 'targets.json'), JSON.stringify({ a: 1 }));
    writeFileSync(join(root, 'llm.json'), JSON.stringify({ fault: 'explode' }));
    const cases: [Record<string, string>, string, RegExp][] = [
      [
        { FAKE_JEV_SCRIPT: join(root, 'missing.json') },
        'FAKE_JEV_SCRIPT',
        /cannot read the file \(ENOENT\)/,
      ],
      [{ FAKE_JEV_SCRIPT: join(root, 'bad.json') }, 'FAKE_JEV_SCRIPT', /not valid JSON/],
      [{ FAKE_JEV_SCRIPT: join(root, 'wrong.json') }, 'FAKE_JEV_SCRIPT', /Jev script/],
      [
        { FAKE_JEV_MODE: 'oracle', FAKE_JEV_ORACLE_TARGETS: join(root, 'targets.json') },
        'FAKE_JEV_ORACLE_TARGETS',
        /oracle targets/,
      ],
      [
        { FAKE_JEV_MODE: 'oracle', FAKE_JEV_ORACLE_TARGETS: join(root, 'bad.json') },
        'FAKE_JEV_ORACLE_TARGETS',
        /not valid JSON/,
      ],
      [{ FAKE_LLM_SCRIPT: join(root, 'llm.json') }, 'FAKE_LLM_SCRIPT', /LLM script/],
      [{ FAKE_LLM_SCRIPT: join(root, 'bad.json') }, 'FAKE_LLM_SCRIPT', /not valid JSON/],
    ];
    for (const [env, key, message] of cases) {
      const started = await startFakes(config([], env), logger);
      expect(started.ok).toBe(false);
      if (started.ok) {
        await started.fakes.close();
        continue;
      }
      expect(started.problems[0]?.key).toBe(key);
      expect(started.problems[0]?.message).toMatch(message);
    }
  });

  it('closes what it started when a later server cannot listen', async () => {
    const blocker = await startFakeJev();
    try {
      const port = new URL(blocker.url).port;
      await expect(startFakes(config([], { FAKE_LLM_PORT: port }), logger)).rejects.toThrow(
        /EADDRINUSE/,
      );
    } finally {
      await blocker.close();
    }
  });
});

describe('runCli', () => {
  it('exits 78 naming the keys on invalid configuration', async () => {
    let stderr = '';
    const result = await runCli(['fake-jev'], {
      env: { FAKE_JEV_PORT: 'x' },
      stderr: (text) => (stderr += text),
    });
    expect(result.exitCode).toBe(78);
    expect(stderr).toBe(
      'invalid configuration: FAKE_JEV_PORT must be a port number from 0 to 65535\n',
    );
  });

  it('exits 78 when a file is invalid, and starts with JSON logs otherwise', async () => {
    let stderr = '';
    const bad = await runCli(['fake-llm'], {
      env: { FAKE_LLM_PORT: '0', FAKE_LLM_SCRIPT: '/nonexistent/llm.json' },
      stderr: (text) => (stderr += text),
      logDestination: { write: () => undefined },
    });
    expect(bad.exitCode).toBe(78);
    expect(stderr).toMatch(/FAKE_LLM_SCRIPT/);

    const lines: string[] = [];
    const good = await runCli(['fake-llm'], {
      env: { FAKE_LLM_PORT: '0', FAKE_LLM_FAULT: 'server-error' },
      stderr: () => undefined,
      logDestination: { write: (line) => lines.push(line) },
    });
    expect(good.exitCode).toBe(0);
    if (good.fakes === undefined) return;
    try {
      const url = urlOf(good.fakes.servers, 'fake-llm');
      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${DEFAULT_FAKE_LLM_API_KEY}` },
        body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(response.status).toBe(500);
      const startLine = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
      expect(startLine).toMatchObject({
        level: 30,
        app: 'argus-fakes',
        service: 'fake-llm',
        fault: 'server-error',
        msg: 'fake-llm listening',
      });
    } finally {
      await good.fakes.close();
    }
  });
});
