/**
 * M00-G4: Tier A is hermetic. The guard is installed by the shared Vitest preset's setup
 * file, not by this test: a socket to example.com:443 fails with NETWORK_DENIED, and
 * loopback connections succeed.
 */
import dgram from 'node:dgram';
import dns from 'node:dns';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
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
