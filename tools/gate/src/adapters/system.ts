/** Clock, source control, requirement probe, tool versions and console output for Node. */
import type {
  Clock,
  Output,
  ProcessRunner,
  RequirementProbe,
  SourceControl,
  ToolVersions,
} from '../ports/index.js';

const PROBE_TIMEOUT_MS = 30_000;

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class ConsoleOutput implements Output {
  info(line: string): void {
    process.stdout.write(`${line}\n`);
  }

  error(line: string): void {
    process.stderr.write(`${line}\n`);
  }
}

async function capture(
  processes: ProcessRunner,
  argv: string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const result = await processes.run({
    argv,
    cwd,
    env,
    timeoutMs: PROBE_TIMEOUT_MS,
    tailLines: 50,
  });
  return result.exitCode === 0 ? result.tail.join('\n').trim() : null;
}

export class GitSourceControl implements SourceControl {
  constructor(
    private readonly processes: ProcessRunner,
    private readonly env: Readonly<Record<string, string | undefined>>,
  ) {}

  shortCommit(root: string): Promise<string | null> {
    return capture(this.processes, ['git', 'rev-parse', '--short', 'HEAD'], root, this.env);
  }

  async isClean(root: string): Promise<boolean | null> {
    const status = await capture(this.processes, ['git', 'status', '--porcelain'], root, this.env);
    return status === null ? null : status === '';
  }
}

export class ShellRequirementProbe implements RequirementProbe {
  constructor(
    private readonly processes: ProcessRunner,
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly cwd: string,
  ) {}

  hasEnv(name: string): boolean {
    const value = this.env[name];
    return value !== undefined && value !== '';
  }

  async toolProblem(name: string): Promise<string | undefined> {
    const found = await capture(
      this.processes,
      ['bash', '-c', 'command -v "$1"', 'probe', name],
      this.cwd,
      this.env,
    );
    if (found === null) {
      return 'not on PATH';
    }
    if (name === 'docker') {
      const info = await capture(
        this.processes,
        ['docker', 'info', '--format', '{{.ServerVersion}}'],
        this.cwd,
        this.env,
      );
      if (info === null) {
        return 'docker daemon unreachable';
      }
    }
    return undefined;
  }
}

export class CommandToolVersions implements ToolVersions {
  constructor(
    private readonly processes: ProcessRunner,
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly cwd: string,
  ) {}

  async collect(): Promise<Record<string, string>> {
    const versions: Record<string, string> = { node: process.versions.node };
    const pnpm = await capture(this.processes, ['pnpm', '--version'], this.cwd, this.env);
    if (pnpm !== null) {
      versions.pnpm = pnpm.split('\n').at(-1) ?? pnpm;
    }
    const docker = await capture(
      this.processes,
      ['docker', 'version', '--format', '{{.Server.Version}}'],
      this.cwd,
      this.env,
    );
    if (docker !== null && docker !== '') {
      versions.docker = docker;
    }
    return versions;
  }
}
