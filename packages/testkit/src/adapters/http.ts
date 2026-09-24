/**
 * The small HTTP layer shared by the fake servers and the cassette proxy: loopback
 * listening on port 0 by default, request bodies as bytes, JSON responses, and a close()
 * that also ends kept-alive and deliberately hanging connections.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

/** What every fake server returns in tests: its base URL, a close function and its request log. */
export interface FakeServer<R> {
  readonly url: string;
  close(): Promise<void>;
  readonly requests: readonly R[];
}

export interface ListenOptions {
  /** 0 (the default) picks a free port. */
  readonly port?: number;
  /** 127.0.0.1 by default; 0.0.0.0 inside a container. */
  readonly host?: string;
}

export interface IncomingCall {
  readonly method: string;
  /** Path with its query string. */
  readonly path: string;
  readonly pathname: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  /** Aborts when the client goes away before the response is complete. */
  readonly signal: AbortSignal;
}

export type Handler = (call: IncomingCall, response: ServerResponse) => Promise<void>;

export interface Listening {
  readonly url: string;
  readonly port: number;
  readonly server: Server;
  close(): Promise<void>;
}

function flattenHeaders(message: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(message.headers)) {
    if (value !== undefined) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return headers;
}

async function readBody(message: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of message) {
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(text)),
    ...headers,
  });
  response.end(text);
}

export function sendBytes(
  response: ServerResponse,
  status: number,
  body: Uint8Array | undefined,
  headers: Readonly<Record<string, string>>,
): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }
  response.writeHead(status, { ...headers, 'content-length': String(body?.length ?? 0) });
  response.end(body === undefined ? undefined : Buffer.from(body));
}

/** Resolves after `ms`, or early when `signal` aborts. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Resolves when `signal` aborts: the client gave up or the server is closing. */
export function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

/** Starts an HTTP server; a handler that throws answers 500 with the message. */
export async function listen(handler: Handler, options: ListenOptions = {}): Promise<Listening> {
  const sockets = new Set<Socket>();
  const controllers = new Set<AbortController>();
  const server = createServer((message, response) => {
    const controller = new AbortController();
    controllers.add(controller);
    response.on('close', () => {
      controllers.delete(controller);
      if (!response.writableFinished) {
        controller.abort();
      }
    });
    void (async () => {
      try {
        const body = await readBody(message);
        const url = new URL(message.url ?? '/', 'http://fake.invalid');
        await handler(
          {
            method: (message.method ?? 'GET').toUpperCase(),
            path: `${url.pathname}${url.search}`,
            pathname: url.pathname,
            headers: flattenHeaders(message),
            body,
            signal: controller.signal,
          },
          response,
        );
      } catch (error) {
        sendJson(response, 500, {
          error: { type: 'fake_server_error', message: (error as Error).message },
        });
      }
    })();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const reachable = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const printable = reachable.includes(':') ? `[${reachable}]` : reachable;
  let closing: Promise<void> | undefined;
  return {
    url: `http://${printable}:${port}`,
    port,
    server,
    close: () => {
      closing ??= new Promise<void>((resolve) => {
        for (const controller of controllers) {
          controller.abort();
        }
        server.close(() => {
          resolve();
        });
        for (const socket of sockets) {
          socket.destroy();
        }
      });
      return closing;
    },
  };
}
