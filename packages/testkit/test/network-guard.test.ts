import { exec as execCallback } from 'node:child_process';
import dgram from 'node:dgram';
import dns, { lookup as namedLookup, resolve4 as namedResolve4 } from 'node:dns';
import {
  lookup as namedPromisesLookup,
  resolve4 as namedPromisesResolve4,
} from 'node:dns/promises';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  NETWORK_DENIED,
  NetworkDeniedError,
  PROXY_ENVIRONMENT_VARIABLES,
  connectTarget,
  datagramAddress,
  deniedAttempts,
  fetchUrl,
  guardChildProcessArguments,
  guardImportFlag,
  guardLookupFunction,
  guardLookupOption,
  guardWorkerArguments,
  httpRequestHosts,
  installNetworkGuard,
  isLoopbackHost,
  isNetworkGuardInstalled,
  lookupAddresses,
  networkGuardPreloadUrl,
  preloadProblem,
  propagateNetworkGuard,
  stripProxyEnvironment,
  withGuardNodeOptions,
} from '../src/index.js';

function codeOf(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return undefined;
}

describe('isLoopbackHost', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'localhost.',
    '127.0.0.1',
    '127.255.10.2',
    '::1',
    '[::1]',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
  ])('accepts %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    'example.com',
    'localhost.example.com',
    '10.0.0.1',
    '128.0.0.1',
    '0.0.0.0',
    '::',
    '::2',
    '::ffff:10.0.0.1',
    '',
  ])('rejects %s', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('connectTarget', () => {
  it('reads options objects', () => {
    expect(connectTarget([{ host: 'example.com', port: 443 }])).toEqual({
      kind: 'host',
      host: 'example.com',
      port: '443',
    });
    expect(connectTarget([{ port: 80 }])).toEqual({ kind: 'host', host: 'localhost', port: '80' });
    expect(connectTarget([{ path: '/tmp/x.sock' }])).toEqual({ kind: 'path', path: '/tmp/x.sock' });
  });

  it('reads the pre-normalised array form', () => {
    expect(connectTarget([[{ host: '10.1.1.1', port: 1 }, null]])).toEqual({
      kind: 'host',
      host: '10.1.1.1',
      port: '1',
    });
  });

  it('reads port, host and path arguments', () => {
    expect(connectTarget([443, 'example.com'])).toEqual({
      kind: 'host',
      host: 'example.com',
      port: '443',
    });
    expect(connectTarget(['8080'])).toEqual({ kind: 'host', host: 'localhost', port: '8080' });
    expect(connectTarget([8080, () => undefined])).toEqual({
      kind: 'host',
      host: 'localhost',
      port: '8080',
    });
    expect(connectTarget(['/run/app.sock'])).toEqual({ kind: 'path', path: '/run/app.sock' });
    expect(connectTarget([{ host: 'h', port: { bad: true } }])).toEqual({
      kind: 'host',
      host: 'h',
      port: '',
    });
  });
});

describe('httpRequestHosts', () => {
  it('reads URL strings and URL objects, with options overriding the host', () => {
    expect(httpRequestHosts(['http://example.com/a'])).toEqual(['example.com']);
    expect(httpRequestHosts([new URL('https://127.0.0.1:8443/')])).toEqual(['127.0.0.1']);
    expect(httpRequestHosts(['http://example.com/', { hostname: 'localhost' }])).toEqual([
      'localhost',
    ]);
    expect(httpRequestHosts([new URL('http://a.test/'), { host: 'b.test' }])).toEqual(['b.test']);
  });

  it('reads option objects and defaults to localhost', () => {
    expect(httpRequestHosts([{ host: 'example.com', path: '/' }])).toEqual(['example.com']);
    expect(httpRequestHosts([{ path: '/' }])).toEqual(['localhost']);
    expect(httpRequestHosts([() => undefined])).toEqual(['localhost']);
    expect(httpRequestHosts([{ socketPath: '/var/run/docker.sock', path: '/info' }])).toEqual([]);
  });

  it('includes the targets of proxy requests', () => {
    expect(
      httpRequestHosts([
        { host: '127.0.0.1', port: 3128, method: 'connect', path: 'example.com:443' },
      ]),
    ).toEqual(['127.0.0.1', 'example.com']);
    expect(
      httpRequestHosts([{ host: '127.0.0.1', method: 'CONNECT', path: '[2001:db8::1]:443' }]),
    ).toEqual(['127.0.0.1', '2001:db8::1']);
    expect(
      httpRequestHosts([{ host: '127.0.0.1', method: 'CONNECT', path: 'example.com' }]),
    ).toEqual(['127.0.0.1', 'example.com']);
    expect(httpRequestHosts([{ host: '127.0.0.1', method: 'CONNECT', path: '[broken' }])).toEqual([
      '127.0.0.1',
      '[broken',
    ]);
    expect(httpRequestHosts([{ host: '127.0.0.1', path: 'http://example.com/x' }])).toEqual([
      '127.0.0.1',
      'example.com',
    ]);
  });
});

describe('fetchUrl and datagramAddress', () => {
  it('extracts fetch targets', () => {
    expect(fetchUrl('https://example.com/x')?.hostname).toBe('example.com');
    expect(fetchUrl(new URL('http://127.0.0.1/'))?.hostname).toBe('127.0.0.1');
    expect(fetchUrl(new Request('http://example.org/'))?.hostname).toBe('example.org');
    expect(fetchUrl('/relative')).toBeUndefined();
    expect(fetchUrl(42)).toBeUndefined();
  });

  it('extracts datagram destinations', () => {
    expect(datagramAddress(['x', 53, '8.8.8.8'])).toBe('8.8.8.8');
    expect(datagramAddress(['x', 0, 1, 53, '10.0.0.1', () => undefined])).toBe('10.0.0.1');
    expect(datagramAddress(['x', 53])).toBe('localhost');
  });
});

describe('stripProxyEnvironment', () => {
  it('removes every proxy variable and reports which were set', () => {
    const env: NodeJS.ProcessEnv = {
      HTTPS_PROXY: 'http://127.0.0.1:3128',
      https_proxy: 'x',
      PATH: '/bin',
    };
    expect(stripProxyEnvironment(env)).toEqual(['HTTPS_PROXY', 'https_proxy']);
    expect(env).toEqual({ PATH: '/bin' });
    expect(PROXY_ENVIRONMENT_VARIABLES).toContain('NODE_USE_ENV_PROXY');
  });

  it('left the test process without proxy variables', () => {
    for (const name of PROXY_ENVIRONMENT_VARIABLES) {
      expect(process.env[name]).toBeUndefined();
    }
  });
});

describe('installNetworkGuard', () => {
  it('is idempotent and appends to the report file on each call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-guard-'));
    const report = join(dir, 'report.txt');
    try {
      expect(isNetworkGuardInstalled()).toBe(true);
      installNetworkGuard({ reportFile: report });
      installNetworkGuard({ reportFile: report });
      installNetworkGuard();
      expect(readFileSync(report, 'utf8')).toBe(`${String(process.pid)}\n${String(process.pid)}\n`);
      expect(codeOf(() => net.connect(443, 'example.com'))).toBe(NETWORK_DENIED);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts denied attempts', () => {
    const before = deniedAttempts();
    expect(codeOf(() => net.connect(80, '192.0.2.1'))).toBe(NETWORK_DENIED);
    expect(deniedAttempts()).toBe(before + 1);
  });

  it('describes the refused target', () => {
    const error = new NetworkDeniedError('example.com:443', 'net.connect');
    expect(error).toMatchObject({
      code: NETWORK_DENIED,
      target: 'example.com:443',
      via: 'net.connect',
    });
    expect(error.message).toContain('example.com:443');
  });

  it('denies reverse lookups, resolver instances and UDP connect to non-loopback addresses', async () => {
    expect(
      codeOf(() => {
        dns.lookupService('8.8.8.8', 53, () => undefined);
      }),
    ).toBe(NETWORK_DENIED);
    expect(
      codeOf(() => {
        new dns.Resolver().resolve4('example.com', () => undefined);
      }),
    ).toBe(NETWORK_DENIED);
    expect(
      codeOf(() => {
        dns.reverse('8.8.8.8', () => undefined);
      }),
    ).toBe(NETWORK_DENIED);
    await expect(new dns.promises.Resolver().resolveTxt('example.com')).rejects.toMatchObject({
      code: NETWORK_DENIED,
    });
    const socket = dgram.createSocket('udp4');
    try {
      expect(
        codeOf(() => {
          socket.connect(53, '8.8.8.8');
        }),
      ).toBe(NETWORK_DENIED);
    } finally {
      socket.close();
    }
  });

  it('allows loopback name resolution, IP literal lookups and UDP to loopback', async () => {
    const { address } = await dns.promises.lookup('localhost', { family: 4 });
    expect(isLoopbackHost(address)).toBe(true);
    expect((await dns.promises.lookup('192.0.2.7')).address).toBe('192.0.2.7');
    await expect(dns.promises.lookupService('192.0.2.7', 80)).rejects.toMatchObject({
      code: NETWORK_DENIED,
    });
    const receiver = dgram.createSocket('udp4');
    receiver.bind(0, '127.0.0.1');
    await once(receiver, 'listening');
    const sender = dgram.createSocket('udp4');
    try {
      const received = once(receiver, 'message');
      sender.send('hello', receiver.address().port, '127.0.0.1');
      const [message] = (await received) as [Buffer];
      expect(message.toString()).toBe('hello');
    } finally {
      sender.close();
      receiver.close();
    }
  });

  it('lets tls.connect upgrade an existing loopback socket', async () => {
    const server = net.createServer((socket) => socket.destroy());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as net.AddressInfo;
    const raw = net.connect(address.port, '127.0.0.1');
    await once(raw, 'connect');
    try {
      const secure = tls.connect({ socket: raw, rejectUnauthorized: false });
      secure.on('error', () => undefined);
      expect(secure).toBeInstanceOf(tls.TLSSocket);
      secure.destroy();
    } finally {
      raw.destroy();
      server.close();
    }
  });

  it('guards the ESM named exports of node:dns and node:dns/promises', async () => {
    expect(
      codeOf(() => {
        namedLookup('example.com', () => undefined);
      }),
    ).toBe(NETWORK_DENIED);
    expect(
      codeOf(() => {
        namedResolve4('example.com', () => undefined);
      }),
    ).toBe(NETWORK_DENIED);
    await expect(namedPromisesLookup('example.com')).rejects.toMatchObject({
      code: NETWORK_DENIED,
    });
    await expect(namedPromisesResolve4('example.com')).rejects.toMatchObject({
      code: NETWORK_DENIED,
    });
  });
});

type LookupCallback = (error: Error | null, address?: unknown, family?: number) => void;

/** A `lookup` option that answers every name with `address`, honouring `all: true`. */
function fixedLookup(address: string): net.LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address, family: net.isIPv6(address) ? 6 : 4 }]);
    } else {
      callback(null, address, net.isIPv6(address) ? 6 : 4);
    }
  };
}

async function connectOutcome(socket: net.Socket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('connect', () => {
      resolve('connected');
      socket.destroy();
    });
    socket.once('error', (error: Error & { code?: unknown }) => {
      resolve(error.code);
    });
  });
}

describe('custom lookup options', () => {
  it('lists the addresses a lookup callback reports', () => {
    expect(lookupAddresses('127.0.0.1')).toEqual(['127.0.0.1']);
    expect(lookupAddresses([{ address: '::1', family: 6 }, '10.0.0.1', { family: 4 }])).toEqual([
      '::1',
      '10.0.0.1',
      '',
    ]);
    expect(lookupAddresses(undefined)).toEqual([]);
  });

  it('refuses a loopback name that a custom lookup maps to a non-loopback address', async () => {
    const socket = net.connect({ host: 'localhost', port: 9, lookup: fixedLookup('172.17.0.1') });
    expect(await connectOutcome(socket)).toBe(NETWORK_DENIED);
    const multi = net.connect({
      host: 'localhost',
      port: 9,
      autoSelectFamily: false,
      lookup: fixedLookup('10.1.2.3'),
    });
    expect(await connectOutcome(multi)).toBe(NETWORK_DENIED);
  });

  it('refuses the same through an HTTP request with a lookup option', async () => {
    const request = http.get({
      host: 'localhost',
      port: 9,
      path: '/',
      lookup: fixedLookup('192.0.2.10'),
    });
    const code = await new Promise((resolve) => {
      request.once('error', (error: Error & { code?: unknown }) => {
        resolve(error.code);
      });
    });
    expect(code).toBe(NETWORK_DENIED);
  });

  it('keeps a custom lookup that answers with loopback working', async () => {
    const server = net.createServer((socket) => socket.end());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const { port } = server.address() as net.AddressInfo;
      const socket = net.connect({ host: 'localhost', port, lookup: fixedLookup('127.0.0.1') });
      expect(await connectOutcome(socket)).toBe('connected');
    } finally {
      server.close();
    }
  });

  it('passes errors and non-callback calls through and keeps the caller options unchanged', () => {
    const failing = guardLookupFunction((...args: unknown[]) => {
      (args[args.length - 1] as LookupCallback)(new Error('ENOTFOUND'));
    }, 'test');
    let received: unknown;
    failing('localhost', {}, (error: unknown) => {
      received = error;
    });
    expect(received).toBeInstanceOf(Error);
    expect(guardLookupFunction(() => 'sync', 'test')('localhost')).toBe('sync');

    const lookup = fixedLookup('127.0.0.1');
    const options = { host: 'localhost', port: 1, lookup };
    const [copy] = guardLookupOption([options], 'test') as [typeof options];
    expect(copy).not.toBe(options);
    expect(copy.lookup).not.toBe(lookup);
    expect(options.lookup).toBe(lookup);

    const normalized: unknown[] = [{ host: 'localhost', port: 1, lookup }, null];
    const [same] = guardLookupOption([normalized], 'test');
    expect(same).toBe(normalized);
    expect((normalized[0] as typeof options).lookup).not.toBe(lookup);

    const plain = [{ host: 'localhost', port: 1 }];
    expect(guardLookupOption(plain, 'test')).toEqual(plain);
  });
});

describe('guard propagation to child processes and worker threads', () => {
  const preload = 'file:///repo/packages/testkit/src/network-guard.preload.ts';
  const flag = `--import=${preload}`;

  it('derives the preload beside a source or built module', () => {
    expect(networkGuardPreloadUrl('file:///r/src/network-guard.setup.ts')).toBe(
      'file:///r/src/network-guard.preload.ts',
    );
    expect(networkGuardPreloadUrl('file:///r/dist/network-guard.setup.js')).toBe(
      'file:///r/dist/network-guard.preload.js',
    );
    expect(guardImportFlag(preload)).toBe(flag);
  });

  it('adds the import flag to NODE_OPTIONS once', () => {
    expect(withGuardNodeOptions(undefined, preload)).toBe(flag);
    expect(withGuardNodeOptions('  ', preload)).toBe(flag);
    expect(withGuardNodeOptions('--max-old-space-size=512', preload)).toBe(
      `--max-old-space-size=512 ${flag}`,
    );
    expect(withGuardNodeOptions(`--enable-source-maps ${flag}`, preload)).toBe(
      `--enable-source-maps ${flag}`,
    );
  });

  it('adds NODE_OPTIONS to an explicit child environment and copies the options', () => {
    const options = { cwd: '/x', env: { PATH: '/bin', NODE_OPTIONS: '--trace-warnings' } };
    const args = guardChildProcessArguments(['node', ['-v'], options], preload);
    expect(args[2]).toEqual({
      cwd: '/x',
      env: { PATH: '/bin', NODE_OPTIONS: `--trace-warnings ${flag}` },
    });
    expect(options.env.NODE_OPTIONS).toBe('--trace-warnings');
    const execArgs = guardChildProcessArguments(['node -v', { env: {} }, () => undefined], preload);
    expect(execArgs[1]).toEqual({ env: { NODE_OPTIONS: flag } });
    expect(guardChildProcessArguments(['node', ['-v'], { cwd: '/x' }], preload)).toEqual([
      'node',
      ['-v'],
      { cwd: '/x' },
    ]);
    expect(guardChildProcessArguments(['node'], preload)).toEqual(['node']);
  });

  it('makes a file worker import the preload and an eval worker load it first', () => {
    const [file, fileOptions] = guardWorkerArguments('/w.js', undefined, preload, ['--inspect=0']);
    expect(file).toBe('/w.js');
    expect(fileOptions.execArgv).toEqual(['--inspect=0', flag]);
    const [, given] = guardWorkerArguments('/w.js', { execArgv: ['--x', 1], name: 'w' }, preload);
    expect(given).toEqual({ execArgv: ['--x', flag], name: 'w' });
    const [, again] = guardWorkerArguments('/w.js', { execArgv: [flag] }, preload);
    expect(again.execArgv).toEqual([flag]);
    const [code, evalOptions] = guardWorkerArguments('console.log(1)', { eval: true }, preload);
    expect(code).toBe(
      `process.getBuiltinModule('node:module').createRequire(${JSON.stringify(preload)})` +
        `(${JSON.stringify(fileURLToPath(preload))});\nconsole.log(1)`,
    );
    expect(evalOptions).toEqual({ eval: true });
  });

  it('refuses preloads a child process could not load', () => {
    expect(preloadProblem('https://example.com/preload.js')).toMatch(/file URL/);
    expect(preloadProblem('file:///r/node_modules/@argus/testkit/src/p.ts')).toMatch(
      /node_modules/,
    );
    expect(preloadProblem('file:///r/node_modules/@argus/testkit/dist/p.js')).toBeUndefined();
    expect(preloadProblem(preload)).toBeUndefined();
    expect(() => {
      propagateNetworkGuard('file:///r/node_modules/x/p.ts', {});
    }).toThrow(/node_modules/);
  });

  it('is active in this test process, idempotently', () => {
    const own = networkGuardPreloadUrl(
      pathToFileURL(join(import.meta.dirname, '../src/network-guard.setup.ts')).href,
    );
    expect(process.env.NODE_OPTIONS?.split(' ')).toContain(guardImportFlag(own));
    const env: NodeJS.ProcessEnv = { NODE_OPTIONS: '--trace-warnings' };
    propagateNetworkGuard(own, env);
    propagateNetworkGuard(own, env);
    expect(env.NODE_OPTIONS).toBe(`--trace-warnings ${guardImportFlag(own)}`);
  });

  it('keeps util.promisify(exec) working and guarded with an explicit environment', async () => {
    const exec = promisify(execCallback);
    const script =
      "try { require('node:net').connect(443, 'example.com') } catch (e) { console.log(e.code) }";
    const { stdout, stderr } = await exec(`"${process.execPath}" -e "${script}"`, {
      env: { PATH: process.env.PATH },
    });
    expect(stdout.trim()).toBe(NETWORK_DENIED);
    expect(stderr).toBe('');
  });
});
