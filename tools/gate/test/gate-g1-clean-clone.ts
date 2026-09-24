/**
 * M00-G1: clean-clone bootstrap. A clean `git archive HEAD` of the repository goes into a
 * fresh argus/toolchain container, where `pnpm install --frozen-lockfile`, `pnpm build`
 * and `pnpm test` (behind the Tier A network guard of the Vitest preset) must exit 0 in
 * under 10 minutes.
 *
 * Run by `pnpm --filter @argus/gate-tool test:gate-g1`; needs Docker. The image is built
 * first (cached layers make this quick); its build time is not part of the 10 minutes.
 *
 * Environment:
 *   DOCKERHUB_MIRROR        registry mirror for the base images (default docker.io)
 *   NODE_EXTRA_CA_CERTS     a CA bundle for networks that re-terminate TLS; passed to the
 *                           image build as a secret and mounted read-only into the container
 *   ARGUS_TOOLCHAIN_IMAGE   image tag (default argus/toolchain:dev)
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { recordGateMetrics } from '@argus/testkit';

const LIMIT_MS = 600_000;
const HARD_TIMEOUT_MS = 900_000;
const BROWSERS = '/opt/pw-browsers';
const CONTAINER_CA = '/etc/argus/extra-ca.pem';

const root = resolve(import.meta.dirname, '../../..');
const image = process.env.ARGUS_TOOLCHAIN_IMAGE ?? 'argus/toolchain:dev';
const mirror =
  process.env.DOCKERHUB_MIRROR !== undefined && process.env.DOCKERHUB_MIRROR !== ''
    ? process.env.DOCKERHUB_MIRROR
    : 'docker.io';
const extraCa = process.env.NODE_EXTRA_CA_CERTS;
const hasExtraCa = extraCa !== undefined && extraCa !== '' && existsSync(extraCa);

/** Runs inside the container; prints one G1_STEP line per step and stops at the first failure. */
const containerScript = String.raw`
set -u
mkdir -p /work/repo && cd /work/repo
tar -x -f -
fresh=true
for path in node_modules .turbo packages/testkit/node_modules tools/gate/dist; do
  if [ -e "$path" ]; then fresh=false; fi
done
echo "G1_FRESH $fresh"
if [ -f pnpm-lock.yaml ]; then echo "G1_LOCKFILE true"; else echo "G1_LOCKFILE false"; exit 1; fi
now() { date +%s%3N; }
step() {
  name=$1; shift
  echo "G1_BEGIN $name: $*"
  start=$(now)
  "$@"
  code=$?
  echo "G1_STEP $name $code $(( $(now) - start ))"
  return $code
}
step install pnpm install --frozen-lockfile &&
step build pnpm build &&
step test pnpm test
`;

interface StepResult {
  exit: number;
  ms: number;
}

function buildImage(): number {
  const args = [
    'build',
    '--network',
    'host',
    '--build-arg',
    `DOCKERHUB_MIRROR=${mirror}`,
    ...(hasExtraCa ? ['--secret', `id=extra-ca,src=${extraCa}`] : []),
    '-f',
    'deploy/docker/toolchain.Dockerfile',
    '-t',
    image,
    'deploy/docker',
  ];
  console.log(`G1: docker ${args.join(' ')}`);
  const build = spawnSync('docker', args, { cwd: root, stdio: 'inherit' });
  return build.status ?? 1;
}

function headCommit(): string {
  const rev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return rev.status === 0 ? rev.stdout.trim() : 'unknown';
}

async function runContainer(): Promise<{
  exit: number;
  ms: number;
  steps: Map<string, StepResult>;
  fresh: boolean;
  lockfile: boolean;
}> {
  const name = `argus-g1-${randomBytes(4).toString('hex')}`;
  const args = [
    'run',
    '--rm',
    '-i',
    '--name',
    name,
    '--network',
    'host',
    '-e',
    'CI=true',
    '-e',
    `PLAYWRIGHT_BROWSERS_PATH=${BROWSERS}`,
    ...(existsSync(BROWSERS) ? ['-v', `${BROWSERS}:${BROWSERS}:ro`] : []),
    ...(hasExtraCa
      ? ['-v', `${extraCa}:${CONTAINER_CA}:ro`, '-e', `NODE_EXTRA_CA_CERTS=${CONTAINER_CA}`]
      : []),
    image,
    'bash',
    '-c',
    containerScript,
  ];
  const steps = new Map<string, StepResult>();
  let fresh = false;
  let lockfile = false;
  const started = performance.now();
  const container = spawn('docker', args, { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
  const archive = spawn('git', ['archive', '--format=tar', 'HEAD'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  archive.stdout.pipe(container.stdin);
  let pending = '';
  container.stdout.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
    const lines = (pending + chunk.toString('utf8')).split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const step = /^G1_STEP (\w+) (\d+) (\d+)$/.exec(line);
      if (step !== null) {
        steps.set(step[1] ?? '', { exit: Number(step[2]), ms: Number(step[3]) });
      }
      if (line === 'G1_FRESH true') {
        fresh = true;
      }
      if (line === 'G1_LOCKFILE true') {
        lockfile = true;
      }
    }
  });
  const timer = setTimeout(() => {
    console.error(`G1: container exceeded ${String(HARD_TIMEOUT_MS / 1000)} s, removing it`);
    spawnSync('docker', ['rm', '-f', name], { stdio: 'inherit' });
  }, HARD_TIMEOUT_MS);
  const [exit] = await Promise.all([
    new Promise<number>((done) =>
      container.on('close', (code) => {
        done(code ?? 1);
      }),
    ),
    new Promise<void>((done) =>
      archive.on('close', () => {
        done();
      }),
    ),
  ]);
  clearTimeout(timer);
  return { exit, ms: Math.round(performance.now() - started), steps, fresh, lockfile };
}

async function main(): Promise<number> {
  const commit = headCommit();
  const imageBuildExit = buildImage();
  if (imageBuildExit !== 0) {
    recordGateMetrics({ commit, image, imageBuildExit });
    console.error('G1: the toolchain image did not build');
    return 1;
  }
  const run = await runContainer();
  const step = (name: string): StepResult => run.steps.get(name) ?? { exit: -1, ms: 0 };
  const metrics = {
    commit,
    image,
    imageBuildExit,
    fresh: run.fresh,
    frozenLockfile: run.lockfile,
    installExit: step('install').exit,
    installMs: step('install').ms,
    buildExit: step('build').exit,
    buildMs: step('build').ms,
    testExit: step('test').exit,
    testMs: step('test').ms,
    containerExit: run.exit,
    containerMs: run.ms,
    limitMs: LIMIT_MS,
  };
  recordGateMetrics(metrics);
  console.log(`G1: ${JSON.stringify(metrics)}`);
  const passed =
    run.exit === 0 &&
    metrics.installExit === 0 &&
    metrics.buildExit === 0 &&
    metrics.testExit === 0 &&
    run.ms < LIMIT_MS;
  return passed ? 0 : 1;
}

process.exitCode = await main();
