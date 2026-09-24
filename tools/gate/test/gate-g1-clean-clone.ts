/**
 * M00-G1: clean-clone bootstrap. A clean `git archive HEAD` of the repository goes into a
 * fresh argus/toolchain container, where `pnpm install --frozen-lockfile`, `pnpm build`
 * and `pnpm test` (behind the Tier A network guard of the Vitest preset) must exit 0 in
 * under 10 minutes.
 *
 * Two containers share a fresh volume. The first, as root, unpacks the archive and runs
 * the install, which needs the registry. The second runs build and test as the user
 * that runs this gate (`--user $(id -u):$(id -g)`). Both use the host network, because
 * Tier A tests reach the shared services on 127.0.0.1; with the host network the second
 * container's sockets belong to that user, so the CI egress rule for the tier-a user
 * (ADR M00-ci) applies to build and test as it does to the gates run on the runner.
 *
 * Run by `pnpm --filter @argus/gate-tool test:gate-g1`; needs Docker. The image is built
 * first (cached layers make this quick); its build time is not part of the 10 minutes.
 *
 * Environment:
 *   DOCKERHUB_MIRROR        registry mirror for the base images (default docker.io)
 *   NODE_EXTRA_CA_CERTS     a CA bundle for networks that re-terminate TLS; passed to the
 *                           image build as a secret and mounted read-only into the container
 *   ARGUS_TOOLCHAIN_IMAGE   image tag (default argus/toolchain:dev)
 *   ARGUS_G1_TEST_USER      uid:gid for build and test (default: this process's ids)
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

const STEP_FUNCTIONS = String.raw`
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
`;

/** First container, as root: unpack, check freshness, install, hand the tree to the test user. */
const installScript = String.raw`
set -u
mkdir -p /work/repo && cd /work/repo
tar -x -f -
fresh=true
for path in node_modules .turbo packages/testkit/node_modules tools/gate/dist; do
  if [ -e "$path" ]; then fresh=false; fi
done
echo "G1_FRESH $fresh"
if [ -f pnpm-lock.yaml ]; then echo "G1_LOCKFILE true"; else echo "G1_LOCKFILE false"; exit 1; fi
${STEP_FUNCTIONS}
step install pnpm install --frozen-lockfile || exit 1
chown -R "$G1_TEST_USER" /work
`;

/** Second container, as the test user: build and test the installed tree. */
const buildTestScript = String.raw`
set -u
cd /work/repo
echo "G1_USER $(id -u):$(id -g)"
${STEP_FUNCTIONS}
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

function testUser(): string {
  const override = process.env.ARGUS_G1_TEST_USER;
  if (override !== undefined && /^\d+:\d+$/.test(override)) {
    return override;
  }
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  return `${String(uid)}:${String(gid)}`;
}

interface ContainerRun {
  exit: number;
  ms: number;
  lines: string[];
}

/** Runs one container with the host network and the shared volume; stdin is piped from `input`. */
async function runContainer(
  volume: string,
  extraArgs: readonly string[],
  script: string,
  timeoutMs: number,
  input?: () => NodeJS.ReadableStream,
): Promise<ContainerRun> {
  const name = `argus-g1-${randomBytes(4).toString('hex')}`;
  const args = [
    'run',
    '--rm',
    ...(input === undefined ? [] : ['-i']),
    '--name',
    name,
    '--network',
    'host',
    '-v',
    `${volume}:/work`,
    '-e',
    'CI=true',
    '-e',
    `PLAYWRIGHT_BROWSERS_PATH=${BROWSERS}`,
    ...(existsSync(BROWSERS) ? ['-v', `${BROWSERS}:${BROWSERS}:ro`] : []),
    ...(hasExtraCa
      ? ['-v', `${extraCa}:${CONTAINER_CA}:ro`, '-e', `NODE_EXTRA_CA_CERTS=${CONTAINER_CA}`]
      : []),
    ...extraArgs,
    image,
    'bash',
    '-c',
    script,
  ];
  const lines: string[] = [];
  const started = performance.now();
  const container = spawn('docker', args, {
    cwd: root,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'],
  });
  const source = input?.();
  if (source !== undefined && container.stdin !== null) {
    source.pipe(container.stdin);
  }
  let pending = '';
  container.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
    const parts = (pending + chunk.toString('utf8')).split('\n');
    pending = parts.pop() ?? '';
    lines.push(...parts);
  });
  const timer = setTimeout(
    () => {
      console.error(
        `G1: container exceeded ${String(Math.round(timeoutMs / 1000))} s, removing it`,
      );
      spawnSync('docker', ['rm', '-f', name], { stdio: 'inherit' });
    },
    Math.max(timeoutMs, 1),
  );
  const exit = await new Promise<number>((done) =>
    container.on('close', (code) => {
      done(code ?? 1);
    }),
  );
  clearTimeout(timer);
  if (pending !== '') {
    lines.push(pending);
  }
  return { exit, ms: Math.round(performance.now() - started), lines };
}

function parseSteps(lines: readonly string[], steps: Map<string, StepResult>): void {
  for (const line of lines) {
    const step = /^G1_STEP (\w+) (\d+) (\d+)$/.exec(line);
    if (step !== null) {
      steps.set(step[1] ?? '', { exit: Number(step[2]), ms: Number(step[3]) });
    }
  }
}

async function runClone(): Promise<{
  exit: number;
  ms: number;
  installContainerMs: number;
  buildTestContainerMs: number;
  steps: Map<string, StepResult>;
  fresh: boolean;
  lockfile: boolean;
  user: string;
  userSeen: string | null;
}> {
  const volume = `argus-g1-${randomBytes(4).toString('hex')}`;
  const user = testUser();
  const steps = new Map<string, StepResult>();
  const created = spawnSync('docker', ['volume', 'create', volume], { stdio: 'ignore' });
  if (created.status !== 0) {
    throw new Error(`G1: docker volume create ${volume} failed`);
  }
  try {
    const install = await runContainer(
      volume,
      ['-e', `G1_TEST_USER=${user}`],
      installScript,
      HARD_TIMEOUT_MS,
      () => {
        const archive = spawn('git', ['archive', '--format=tar', 'HEAD'], {
          cwd: root,
          stdio: ['ignore', 'pipe', 'inherit'],
        });
        return archive.stdout;
      },
    );
    parseSteps(install.lines, steps);
    const fresh = install.lines.includes('G1_FRESH true');
    const lockfile = install.lines.includes('G1_LOCKFILE true');
    let buildTest: ContainerRun = { exit: -1, ms: 0, lines: [] };
    if (install.exit === 0) {
      buildTest = await runContainer(
        volume,
        ['--user', user, '-e', 'HOME=/tmp'],
        buildTestScript,
        HARD_TIMEOUT_MS - install.ms,
      );
      parseSteps(buildTest.lines, steps);
    }
    const seen = buildTest.lines.find((line) => line.startsWith('G1_USER '));
    return {
      exit: install.exit === 0 ? buildTest.exit : install.exit,
      ms: install.ms + buildTest.ms,
      installContainerMs: install.ms,
      buildTestContainerMs: buildTest.ms,
      steps,
      fresh,
      lockfile,
      user,
      userSeen: seen === undefined ? null : seen.slice('G1_USER '.length),
    };
  } finally {
    spawnSync('docker', ['volume', 'rm', '-f', volume], { stdio: 'ignore' });
  }
}

async function main(): Promise<number> {
  const commit = headCommit();
  const imageBuildExit = buildImage();
  if (imageBuildExit !== 0) {
    recordGateMetrics({ commit, image, imageBuildExit });
    console.error('G1: the toolchain image did not build');
    return 1;
  }
  const run = await runClone();
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
    installContainerMs: run.installContainerMs,
    buildTestContainerMs: run.buildTestContainerMs,
    buildTestUser: run.user,
    buildTestUserSeen: run.userSeen,
    limitMs: LIMIT_MS,
  };
  recordGateMetrics(metrics);
  console.log(`G1: ${JSON.stringify(metrics)}`);
  const passed =
    run.exit === 0 &&
    metrics.installExit === 0 &&
    metrics.buildExit === 0 &&
    metrics.testExit === 0 &&
    run.userSeen === run.user &&
    run.ms < LIMIT_MS;
  return passed ? 0 : 1;
}

process.exitCode = await main();
