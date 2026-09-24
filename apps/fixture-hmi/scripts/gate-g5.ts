#!/usr/bin/env -S tsx --conditions=@argus/source
/**
 * M02-G5 (Tier C): the container answers `/healthz` within 5 s of start and runs as a
 * non-root user. Builds `argus/fixture-hmi:gate` from `deploy/docker/fixture-hmi.Dockerfile`
 * and drives it directly with the Docker CLI (`pnpm gate` reports `not_run` already when
 * `docker` is missing or its daemon is unreachable, per `requires: [docker]`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { recordGateMetrics } from '@argus/testkit';

const IMAGE = 'argus/fixture-hmi:gate';
const CONTAINER = `argus-fixture-hmi-gate-${String(process.pid)}`;
const REPO_ROOT = new URL('../../../', import.meta.url).pathname;
const DOCKERHUB_MIRROR = process.env.DOCKERHUB_MIRROR ?? 'docker.io';

function run(
  argv: readonly string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): { code: number; stdout: string; stderr: string } {
  const [command, ...args] = argv;
  if (command === undefined) {
    return { code: 1, stdout: '', stderr: 'empty command' };
  }
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    env: options.env ?? process.env,
  });
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

async function main(): Promise<number> {
  const extraCa = process.env.NODE_EXTRA_CA_CERTS;
  const secretArgs = extraCa !== undefined && extraCa !== '' ? ['--secret', `id=extra-ca,src=${extraCa}`] : [];
  const build = run(
    [
      'docker',
      'build',
      '--network',
      'host',
      '--build-arg',
      `DOCKERHUB_MIRROR=${DOCKERHUB_MIRROR}`,
      ...secretArgs,
      '-f',
      'deploy/docker/fixture-hmi.Dockerfile',
      '-t',
      IMAGE,
      '.',
    ],
    { timeoutMs: 9 * 60 * 1000, env: { ...process.env, DOCKER_BUILDKIT: '1' } },
  );
  if (build.code !== 0) {
    console.error(build.stdout);
    console.error(build.stderr);
    recordGateMetrics({ buildExit: build.code, healthyWithinMs: -1, nonRoot: false, healthzOk: false });
    return 1;
  }

  const port = 34567;
  const container = spawn(
    'docker',
    ['run', '--rm', '--name', CONTAINER, '-p', `127.0.0.1:${String(port)}:4000`, IMAGE],
    { stdio: 'ignore' },
  );

  try {
    const start = Date.now();
    let healthzOk = false;
    let healthyWithinMs = -1;
    while (Date.now() - start < 5000 && container.exitCode === null) {
      try {
        const res = await fetch(`http://127.0.0.1:${String(port)}/healthz`);
        if (res.status === 200) {
          const body = (await res.json()) as { status?: string };
          if (body.status === 'ok') {
            healthzOk = true;
            healthyWithinMs = Date.now() - start;
            break;
          }
        }
      } catch {
        // not up yet
      }
      await delay(100);
    }

    const whoami = run(['docker', 'exec', CONTAINER, 'id', '-u']);
    const uid = whoami.stdout.trim();
    const nonRoot = whoami.code === 0 && uid !== '' && uid !== '0';

    recordGateMetrics({
      buildExit: build.code,
      healthzOk,
      healthyWithinMs,
      nonRoot,
      uid,
    });

    if (!healthzOk) {
      console.error(`fixture-hmi did not answer /healthz within 5s (exitCode=${String(container.exitCode)})`);
    }
    if (!nonRoot) {
      console.error(`container did not run as non-root: uid="${uid}"`);
    }
    return healthzOk && nonRoot ? 0 : 1;
  } finally {
    run(['docker', 'stop', '-t', '2', CONTAINER]);
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error);
    recordGateMetrics({ buildExit: 1, healthzOk: false, nonRoot: false, healthyWithinMs: -1 });
    process.exit(1);
  });
