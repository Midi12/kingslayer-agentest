/**
 * M00-G4: Tier A is hermetic. The guard is installed by the shared Vitest preset's setup
 * file, not by this test: a socket to example.com:443 fails with NETWORK_DENIED, and
 * loopback connections succeed. Node child processes and worker threads started by a
 * test inherit the guard.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import dgram from 'node:dgram';
import dns, { lookup as namedLookup } from 'node:dns';
import { resolve4 as namedPromisesResolve4 } from 'node:dns/promises';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { Worker } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';
import { NETWORK_DENIED, isNetworkGuardInstalled, recordGateMetrics } from '../src/index.js';

const tally = { denied: 0, loopbackOk: 0 };

function expectDenied(action: () => unknown): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as { code?: unknown }).code).toBe(NETWORK_DENIED);
  tally.denied += 1;
}

async function expectRejectedDenied(action: () => Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as { code?: unknown }).code).toBe(NETWORK_DENIED);
  tally.denied += 1;
}

async function echoServer(listen: (server: net.Server) => void): Promise<net.Server> {
  const server = net.createServer((socket) => socket.pipe(socket));
  listen(server);
  await once(server, 'listening');
  return server;
}

async function roundTrip(options: net.NetConnectOpts): Promise<string> {
  const socket = net.connect(options);
  await once(socket, 'connect');
  socket.write('ping');
  const [data] = (await once(socket, 'data')) as [Buffer];
  socket.destroy();
  return data.toString('utf8');
}

function tcpPort(server: net.Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a TCP address');
  }
  return address.port;
}

/** Script that tries a connection and prints the error code, or CONNECTED. */
function probeScript(host: string, port: number): string {
  return (
    `const net = require('node:net');` +
    `try { const s = net.connect(${String(port)}, ${JSON.stringify(host)});` +
    ` s.on('connect', () => { console.log('CONNECTED'); s.destroy(); });` +
    ` s.on('error', (e) => { console.log('ERROR ' + e.code); }); }` +
    ` catch (e) { console.log(e.code); }`
  );
}

async function workerOutput(
  filename: string | URL,
  options: { eval?: boolean } = {},
): Promise<string> {
  const worker = new Worker(filename, { ...options, stdout: true });
  let output = '';
  worker.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  await once(worker, 'exit');
  return output.trim();
}

afterAll(() => {
  recordGateMetrics({ denied: tally.denied, loopbackOk: tally.loopbackOk });
});

describe('M00-G4 the Tier A network guard', () => {
  it('is installed by the shared Vitest setup file', () => {
    expect(isNetworkGuardInstalled()).toBe(true);
  });

  it('denies a TCP socket to example.com:443', () => {
    expectDenied(() => net.connect(443, 'example.com'));
    expectDenied(() => net.createConnection({ host: 'example.com', port: 443 }));
    expectDenied(() => new net.Socket().connect({ host: 'example.com', port: 443 }));
    expectDenied(() => new net.Socket().connect(443, '93.184.215.14'));
    expectDenied(() => net.connect({ host: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', port: 443 }));
  });

  it('denies TLS, HTTP and HTTPS clients', () => {
    expectDenied(() => tls.connect(443, 'example.com'));
    expectDenied(() => tls.connect({ host: 'example.com', port: 443 }));
    expectDenied(() => http.get('http://example.com/'));
    expectDenied(() => https.request({ hostname: 'example.com', port: 443, path: '/' }));
    expectDenied(() => https.get(new URL('https://example.com/')));
  });

  it('denies global fetch to a non-loopback host', async () => {
    await expectRejectedDenied(() => fetch('https://example.com/'));
    await expectRejectedDenied(() => fetch(new Request('http://example.com:80/x')));
  });

  it('denies name resolution of non-loopback names', async () => {
    expectDenied(() => {
      dns.lookup('example.com', () => undefined);
    });
    await expectRejectedDenied(() => dns.promises.lookup('example.com'));
    await expectRejectedDenied(() => dns.promises.resolve4('example.com'));
    expectDenied(() => {
      namedLookup('example.com', () => undefined);
    });
    await expectRejectedDenied(() => namedPromisesResolve4('example.com'));
  });

  it('denies UDP datagrams to a non-loopback address', () => {
    const socket = dgram.createSocket('udp4');
    try {
      expectDenied(() => {
        socket.send('x', 53, '8.8.8.8');
      });
    } finally {
      socket.close();
    }
  });

  it('denies the same in Node child processes, with inherited or explicit environments', () => {
    const script = probeScript('example.com', 443);
    const inherited = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    expect(inherited.stdout.trim()).toBe(NETWORK_DENIED);
    tally.denied += 1;
    const explicit = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    expect(explicit.trim()).toBe(NETWORK_DENIED);
    tally.denied += 1;
    const throughShell = spawnSync('bash', ['-c', 'exec "$0" -e "$1"', process.execPath, script], {
      encoding: 'utf8',
    });
    expect(throughShell.stdout.trim()).toBe(NETWORK_DENIED);
    tally.denied += 1;
  });

  it('denies the same in worker threads, from a file or eval code', async () => {
    const script = probeScript('example.com', 443);
    expect(await workerOutput(script, { eval: true })).toBe(NETWORK_DENIED);
    tally.denied += 1;
    const dir = mkdtempSync(join(tmpdir(), 'argus-g4-worker-'));
    const file = join(dir, 'probe.cjs');
    writeFileSync(file, script);
    try {
      expect(await workerOutput(file)).toBe(NETWORK_DENIED);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    tally.denied += 1;
  });

  it('lets a child process and a worker reach a loopback server', async () => {
    const server = await echoServer((s) => s.listen(0, '127.0.0.1'));
    try {
      const script = probeScript('127.0.0.1', tcpPort(server));
      const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
      expect(child.stdout.trim()).toBe('CONNECTED');
      tally.loopbackOk += 1;
      expect(await workerOutput(script, { eval: true })).toBe('CONNECTED');
      tally.loopbackOk += 1;
    } finally {
      server.close();
    }
  });

  it('allows a TCP connection to a loopback server on 127.0.0.1 and localhost', async () => {
    const server = await echoServer((s) => s.listen(0, '127.0.0.1'));
    try {
      const port = tcpPort(server);
      expect(await roundTrip({ host: '127.0.0.1', port })).toBe('ping');
      tally.loopbackOk += 1;
      expect(await roundTrip({ host: 'localhost', port, family: 4 })).toBe('ping');
      tally.loopbackOk += 1;
    } finally {
      server.close();
    }
  });

  it('allows fetch to a loopback HTTP server', async () => {
    const server = http.createServer((_request, response) => response.end('ok'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const response = await fetch(`http://127.0.0.1:${String(tcpPort(server))}/`);
      expect(await response.text()).toBe('ok');
      tally.loopbackOk += 1;
    } finally {
      server.close();
    }
  });

  it('allows Unix sockets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-g4-'));
    const path = join(dir, 'echo.sock');
    const server = await echoServer((s) => s.listen(path));
    try {
      expect(await roundTrip({ path })).toBe('ping');
      tally.loopbackOk += 1;
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
