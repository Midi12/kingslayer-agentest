/**
 * M03-G6 (Tier C): the argus/fakes image serves both fakes. The image builds from
 * deploy/docker/fakes.Dockerfile; fake-jev and fake-llm containers run as uid 10001 with a
 * read-only root file system, a tmpfs /tmp, no capabilities and no-new-privileges; each
 * answers /healthz within 5 s of start, Docker's own health check turns healthy, the
 * official SDKs get answers, and compose.dev.yaml declares both services under "fakes".
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { TypeSafeClient, choice } from '@typesafe-ai/sdk';
import {
  DEFAULT_FAKE_JEV_API_KEY,
  DEFAULT_FAKE_LLM_API_KEY,
  recordGateMetrics,
} from '@argus/testkit';
import { afterAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const image = `argus/fakes:m03-g6-${String(process.pid)}`;
const mirror = process.env.DOCKERHUB_MIRROR ?? 'docker.io';
const extraCa = process.env.NODE_EXTRA_CA_CERTS;

const metrics = {
  imageBuilt: false,
  services: 0,
  healthyWithinMs: Number.MAX_SAFE_INTEGER,
  uid: -1,
  readOnlyRootFs: false,
  dockerHealthy: false,
  jevAnswered: false,
  llmAnswered: false,
  composeValid: false,
};
const containers: string[] = [];

afterAll(() => {
  for (const id of containers) docker(['rm', '-f', id]);
  docker(['image', 'rm', '-f', image]);
  recordGateMetrics({ ...metrics });
});

function docker(
  args: readonly string[],
  timeoutMs = 120_000,
): { status: number; stdout: string; stderr: string } {
  const run = spawnSync('docker', args, { cwd: root, encoding: 'utf8', timeout: timeoutMs });
  return { status: run.status ?? 1, stdout: run.stdout, stderr: run.stderr };
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function waitForHealthz(url: string, startedAt: number, limitMs: number): Promise<number> {
  for (;;) {
    try {
      const response = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return Date.now() - startedAt;
    } catch {
      // not listening yet
    }
    if (Date.now() - startedAt > limitMs)
      throw new Error(`${url}/healthz did not answer within ${String(limitMs)} ms`);
    await sleep(50);
  }
}

async function waitForDockerHealth(id: string, limitMs: number): Promise<boolean> {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    const status = docker(['inspect', '-f', '{{.State.Health.Status}}', id]).stdout.trim();
    if (status === 'healthy') return true;
    if (status === 'unhealthy') return false;
    await sleep(500);
  }
  return false;
}

/** Starts a hardened container of the image and returns its id and URL on loopback. */
async function start(
  command: string,
  port: number,
): Promise<{ id: string; url: string; readyMs: number }> {
  const startedAt = Date.now();
  const run = docker([
    'run',
    '-d',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '-p',
    `127.0.0.1::${String(port)}`,
    image,
    command,
  ]);
  expect(run.status, run.stderr).toBe(0);
  const id = run.stdout.trim();
  containers.push(id);
  const mapped =
    docker(['port', id, String(port)])
      .stdout.split('\n')[0]
      ?.trim() ?? '';
  const url = `http://${mapped}`;
  const readyMs = await waitForHealthz(url, startedAt, 5_000);
  return { id, url, readyMs };
}

describe('M03-G6 argus/fakes image', () => {
  it('builds from deploy/docker/fakes.Dockerfile', () => {
    const build = docker(
      [
        'build',
        '--network',
        'host',
        '--build-arg',
        `DOCKERHUB_MIRROR=${mirror}`,
        ...(extraCa !== undefined && existsSync(extraCa)
          ? ['--secret', `id=extra-ca,src=${extraCa}`]
          : []),
        '-f',
        'deploy/docker/fakes.Dockerfile',
        '-t',
        image,
        '.',
      ],
      1_200_000,
    );
    expect(build.status, build.stderr.slice(-2000)).toBe(0);
    metrics.imageBuilt = true;
  });

  it('runs fake-jev and fake-llm hardened, healthy within 5 s, answering the official SDKs', async () => {
    const jev = await start('fake-jev', 4100);
    const llm = await start('fake-llm', 4200);
    metrics.services = 2;
    metrics.healthyWithinMs = Math.max(jev.readyMs, llm.readyMs);

    const uids = [jev.id, llm.id].map((id) =>
      Number(
        docker(['exec', id, 'node', '-e', 'process.stdout.write(String(process.getuid()))']).stdout,
      ),
    );
    metrics.uid = uids.every((uid) => uid === uids[0]) ? (uids[0] ?? -1) : -1;
    metrics.readOnlyRootFs = [jev.id, llm.id].every(
      (id) =>
        docker(['inspect', '-f', '{{.HostConfig.ReadonlyRootfs}}', id]).stdout.trim() === 'true',
    );
    const write = docker([
      'exec',
      jev.id,
      'node',
      '-e',
      "require('fs').writeFileSync('/app/probe','x')",
    ]);
    expect(write.status).not.toBe(0);

    const sdk = new TypeSafeClient({
      apiKey: DEFAULT_FAKE_JEV_API_KEY,
      baseURL: jev.url,
      logLevel: 'off',
    });
    const answer = await sdk.systemOne({
      model: 'jev-1.13.0',
      state: 'Conveyor overview',
      questions: { target: choice('Which button?', { c16: 'Start C11', c17: 'Start C12' }) },
    });
    metrics.jevAnswered =
      answer.model === 'jev-1.13.0' && answer.answers.target.probabilities.c17 === 0.5;

    const scripted = await fetch(`${llm.url}/_fake/script`, {
      method: 'PUT',
      body: JSON.stringify({ response: { text: 'fake answer from the container' } }),
    });
    expect(scripted.status).toBe(200);
    const message = await new Anthropic({
      apiKey: DEFAULT_FAKE_LLM_API_KEY,
      baseURL: llm.url,
      maxRetries: 0,
    }).messages.create({
      model: 'claude-opus-5',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hello' }],
    });
    metrics.llmAnswered =
      message.content[0]?.type === 'text' &&
      message.content[0].text === 'fake answer from the container';

    const healthy = await Promise.all([
      waitForDockerHealth(jev.id, 60_000),
      waitForDockerHealth(llm.id, 60_000),
    ]);
    metrics.dockerHealthy = healthy.every(Boolean);

    expect(metrics.uid).toBe(10001);
    expect(metrics.readOnlyRootFs).toBe(true);
    expect(metrics.healthyWithinMs).toBeLessThanOrEqual(5_000);
    expect(metrics.jevAnswered).toBe(true);
    expect(metrics.llmAnswered).toBe(true);
    expect(metrics.dockerHealthy).toBe(true);
  });

  it('is declared in compose.dev.yaml under the profile "fakes"', () => {
    const all = docker([
      'compose',
      '-f',
      'compose.dev.yaml',
      '--profile',
      'fakes',
      'config',
      '--services',
    ]);
    const shared = docker(['compose', '-f', 'compose.dev.yaml', 'config', '--services']);
    const withProfile = all.stdout.split('\n').filter(Boolean).sort();
    const withoutProfile = shared.stdout.split('\n').filter(Boolean).sort();
    metrics.composeValid =
      all.status === 0 &&
      shared.status === 0 &&
      ['fake-jev', 'fake-llm'].every(
        (service) => withProfile.includes(service) && !withoutProfile.includes(service),
      );
    expect(metrics.composeValid).toBe(true);
  });
});
