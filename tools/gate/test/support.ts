/** Test doubles for the gate tool's ports. */
import type {
  Clock,
  Output,
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
  RequirementProbe,
  SourceControl,
  ToolVersions,
} from '../src/index.js';

export class MemoryOutput implements Output {
  readonly lines: string[] = [];
  info(line: string): void {
    this.lines.push(line);
  }
  error(line: string): void {
    this.lines.push(`ERR ${line}`);
  }
  text(): string {
    return this.lines.join('\n');
  }
}

export class FixedClock implements Clock {
  private tick = 0;
  now(): Date {
    this.tick += 1;
    return new Date(Date.UTC(2026, 9, 2, 9, 14, this.tick));
  }
}

export class FakeProbe implements RequirementProbe {
  constructor(
    private readonly env: Record<string, string> = {},
    private readonly tools: Record<string, string | undefined> = {},
  ) {}
  hasEnv(name: string): boolean {
    return (this.env[name] ?? '') !== '';
  }
  toolProblem(name: string): Promise<string | undefined> {
    return Promise.resolve(name in this.tools ? this.tools[name] : 'not on PATH');
  }
}

export class FakeSourceControl implements SourceControl {
  constructor(
    private readonly commit: string | null = 'abc1234',
    private readonly clean: boolean | null = true,
    private readonly ignored: boolean | null = true,
  ) {}
  shortCommit(): Promise<string | null> {
    return Promise.resolve(this.commit);
  }
  isClean(): Promise<boolean | null> {
    return Promise.resolve(this.clean);
  }
  isIgnored(): Promise<boolean | null> {
    return Promise.resolve(this.ignored);
  }
}

export class FakeToolVersions implements ToolVersions {
  collect(): Promise<Record<string, string>> {
    return Promise.resolve({ node: '22.0.0', pnpm: '10.33.0' });
  }
}

export type Script = (
  request: ProcessRequest,
) => Promise<Partial<ProcessResult>> | Partial<ProcessResult>;

/** A process runner whose behaviour is a function of the request. */
export class ScriptedProcessRunner implements ProcessRunner {
  readonly requests: ProcessRequest[] = [];
  constructor(private readonly script: Script) {}
  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    const partial = await this.script(request);
    const tail = partial.tail ?? [];
    for (const line of tail) {
      request.onLine?.(line);
    }
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      durationMs: 5,
      totalLines: tail.length,
      ...partial,
      tail,
    };
  }
}
