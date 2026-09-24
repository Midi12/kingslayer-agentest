/** Runs child processes in their own process group, with a timeout and an output tail. */
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { LineTail } from '../core/log-tail.js';
import type { ProcessRequest, ProcessResult, ProcessRunner } from '../ports/index.js';

const KILL_GRACE_MS = 5_000;

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // The group has already exited.
  }
}

export class NodeProcessRunner implements ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult> {
    const [program, ...args] = request.argv;
    const tail = new LineTail(request.tailLines ?? 200);
    const started = performance.now();
    const elapsed = (): number => Math.round(performance.now() - started);
    return new Promise((resolve) => {
      if (program === undefined) {
        resolve({
          exitCode: null,
          signal: null,
          timedOut: false,
          durationMs: 0,
          tail: [],
          totalLines: 0,
          spawnError: 'empty command',
        });
        return;
      }
      const child = spawn(program, args, {
        cwd: request.cwd,
        env: request.env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let timedOut = false;
      let killTimer: NodeJS.Timeout | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        signalGroup(child.pid, 'SIGTERM');
        killTimer = setTimeout(() => {
          signalGroup(child.pid, 'SIGKILL');
        }, KILL_GRACE_MS);
      }, request.timeoutMs);
      const onData =
        (stream: string) =>
        (chunk: Buffer): void => {
          for (const line of tail.push(chunk.toString('utf8'), stream)) {
            request.onLine?.(line);
          }
        };
      child.stdout.on('data', onData('stdout'));
      child.stderr.on('data', onData('stderr'));
      let spawnError: string | undefined;
      child.on('error', (error) => {
        spawnError = error.message;
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (killTimer !== undefined) {
          clearTimeout(killTimer);
        }
        signalGroup(child.pid, 'SIGKILL');
        for (const line of tail.end()) {
          request.onLine?.(line);
        }
        resolve({
          exitCode: code,
          signal,
          timedOut,
          durationMs: elapsed(),
          tail: tail.lines(),
          totalLines: tail.totalLines(),
          ...(spawnError === undefined ? {} : { spawnError }),
        });
      });
    });
  }
}
