/**
 * Container health check (HEALTHCHECK runs `node dist/health.js`): main.ts writes the
 * URLs of the servers it started to a status file on /tmp, and the check asks each one's
 * `/healthz`. It uses Node's fetch, so the image needs no curl.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { RunningServer } from './run.js';

export const DEFAULT_STATUS_FILE = '/tmp/argus-fakes.json';

export function statusFile(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.FAKE_STATUS_FILE?.trim();
  return value === undefined || value === '' ? DEFAULT_STATUS_FILE : value;
}

export async function writeStatus(file: string, servers: readonly RunningServer[]): Promise<void> {
  await writeFile(file, `${JSON.stringify({ servers })}\n`);
}

export type FetchStatus = (url: string) => Promise<{ readonly ok: boolean }>;

const fetchStatus: FetchStatus = (url) => fetch(url, { signal: AbortSignal.timeout(2_000) });

/** 0 when every started server answers /healthz with 2xx, 1 otherwise (with the reason). */
export async function checkHealth(
  file: string,
  get: FetchStatus = fetchStatus,
): Promise<{ readonly exitCode: 0 | 1; readonly message: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return { exitCode: 1, message: `no status file at ${file}: the fakes have not started` };
  }
  const listed = (parsed as { servers?: unknown } | null)?.servers;
  const servers: RunningServer[] = Array.isArray(listed)
    ? listed.filter(
        (item: unknown): item is RunningServer =>
          typeof (item as RunningServer | null)?.url === 'string' &&
          typeof (item as RunningServer | null)?.service === 'string',
      )
    : [];
  if (servers.length === 0) {
    return { exitCode: 1, message: 'the status file lists no server' };
  }
  for (const server of servers) {
    try {
      const response = await get(`${server.url}/healthz`);
      if (!response.ok) {
        return { exitCode: 1, message: `${server.service} /healthz answered an error` };
      }
    } catch {
      return { exitCode: 1, message: `${server.service} /healthz did not answer` };
    }
  }
  return { exitCode: 0, message: `healthy: ${servers.map((server) => server.service).join(', ')}` };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkHealth(statusFile(process.env));
  process.stdout.write(`${result.message}\n`);
  process.exit(result.exitCode);
}
