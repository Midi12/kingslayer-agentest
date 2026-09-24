#!/usr/bin/env node
/**
 * Composition root of the argus/fakes image: `node dist/main.js [fake-jev|fake-llm|
 * cassette-proxy|all]`. Exits 78 on invalid configuration; SIGTERM and SIGINT close the
 * servers and exit 0.
 */
import { runCli } from './cli.js';
import { statusFile, writeStatus } from './health.js';

const result = await runCli(process.argv.slice(2), {
  env: process.env,
  stderr: (text) => process.stderr.write(text),
});
if (result.fakes === undefined) {
  process.exit(result.exitCode);
}
const running = result.fakes;
try {
  await writeStatus(statusFile(process.env), running.servers);
} catch (error) {
  process.stderr.write(
    `cannot write the health status file (${(error as NodeJS.ErrnoException).code ?? 'error'}); the container health check will fail\n`,
  );
}
let stopping = false;
const stop = (): void => {
  if (stopping) {
    return;
  }
  stopping = true;
  void running.close().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
