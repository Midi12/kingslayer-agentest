/**
 * Tier A network guard (ADR-0008).
 *
 * Once installed, any attempt of the current process to open a connection to a
 * non-loopback address throws an error whose `code` is `NETWORK_DENIED`.
 * Loopback (127.0.0.0/8, ::1, `localhost`) and Unix sockets stay allowed.
 *
 * Covered entry points: `net.Socket.prototype.connect` (the choke point every TCP and
 * TLS client goes through, including the undici client behind global `fetch`),
 * `net.connect`/`net.createConnection`, `tls.connect`, `http`/`https` `request` and `get`
 * (including CONNECT and absolute-URL proxy requests), global `fetch`, UDP sockets from
 * `dgram`, and the `dns` lookup and resolver functions. A caller-supplied `lookup` option
 * is wrapped so that a loopback name cannot resolve to a non-loopback address. The ESM
 * named exports of the built-in modules are synchronised after patching, so
 * `import { lookup } from 'node:dns'` is guarded as well as `dns.lookup`. Proxy variables
 * are removed from the environment so that no library relays traffic through a loopback
 * proxy.
 *
 * `propagateNetworkGuard` carries the guard into the processes and threads a test starts:
 * `NODE_OPTIONS` gains `--import=<preload>` (also added to an explicit `env` passed to the
 * `child_process` functions), and `worker_threads.Worker` loads the preload before the
 * worker's own code. Programs that are not Node (Chromium, Go, curl) are outside its
 * reach; only an OS-level lockdown covers them (ADR M00-network-guard).
 */
import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { appendFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import workerThreads from 'node:worker_threads';

export const NETWORK_DENIED = 'NETWORK_DENIED';

export class NetworkDeniedError extends Error {
  readonly code = NETWORK_DENIED;
  readonly target: string;
  readonly via: string;

  constructor(target: string, via: string) {
    super(
      `NETWORK_DENIED: ${via} to ${target} is blocked in Tier A tests; ` +
        'only loopback (127.0.0.0/8, ::1, localhost) and Unix sockets are allowed',
    );
    this.name = 'NetworkDeniedError';
    this.target = target;
    this.via = via;
  }
}

const loopbackAddresses = new net.BlockList();
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
loopbackAddresses.addAddress('::1', 'ipv6');

/** True when `host` is `localhost`, an address in 127.0.0.0/8, `::1` or an IPv4-mapped loopback. */
export function isLoopbackHost(host: string): boolean {
  let name = host.trim().toLowerCase();
  if (name.startsWith('[') && name.endsWith(']')) {
    name = name.slice(1, -1);
  }
  if (name.endsWith('.')) {
    name = name.slice(0, -1);
  }
  if (name === 'localhost') {
    return true;
  }
  if (net.isIPv4(name)) {
    return loopbackAddresses.check(name, 'ipv4');
  }
  if (net.isIPv6(name)) {
    return loopbackAddresses.check(name, 'ipv6');
  }
  return false;
}

/** Where a socket connection goes: a Unix socket path, or a host and port. */
export type ConnectTarget =
  { kind: 'path'; path: string } | { kind: 'host'; host: string; port: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPortLike(value: unknown): boolean {
  return typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value));
}

function portText(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
}

/**
 * Normalises the argument forms of `net.connect`, `socket.connect` and `tls.connect`:
 * `(options[, cb])`, `(path[, cb])`, `(port[, host][, cb])`, and the internal
 * pre-normalised `[options, cb]` array Node passes to `Socket.prototype.connect`.
 * Node's default host is `localhost`.
 */
export function connectTarget(args: readonly unknown[]): ConnectTarget {
  const first: unknown = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (isRecord(first)) {
    if (typeof first.path === 'string' && first.path !== '') {
      return { kind: 'path', path: first.path };
    }
    const host = typeof first.host === 'string' && first.host !== '' ? first.host : 'localhost';
    return { kind: 'host', host, port: portText(first.port) };
  }
  if (typeof first === 'string' && !isPortLike(first)) {
    return { kind: 'path', path: first };
  }
  const host = typeof args[1] === 'string' && args[1] !== '' ? args[1] : 'localhost';
  return { kind: 'host', host, port: portText(first) };
}

function describe(target: ConnectTarget): string {
  return target.kind === 'path' ? target.path : `${target.host}:${target.port}`;
}

/** Host names an `http.request`/`https.request` call would reach, including proxy targets. */
export function httpRequestHosts(args: readonly unknown[]): string[] {
  let url: URL | undefined;
  let options: Record<string, unknown> = {};
  const first = args[0];
  if (typeof first === 'string') {
    url = new URL(first);
    if (isRecord(args[1])) {
      options = args[1];
    }
  } else if (first instanceof URL) {
    url = first;
    if (isRecord(args[1])) {
      options = args[1];
    }
  } else if (isRecord(first)) {
    options = first;
  }
  if (typeof options.socketPath === 'string' && options.socketPath !== '') {
    return [];
  }
  const hosts: string[] = [];
  const hostname =
    typeof options.hostname === 'string' && options.hostname !== ''
      ? options.hostname
      : typeof options.host === 'string' && options.host !== ''
        ? options.host
        : (url?.hostname ?? 'localhost');
  hosts.push(hostname);
  const path = typeof options.path === 'string' ? options.path : '';
  const method = typeof options.method === 'string' ? options.method.toUpperCase() : 'GET';
  if (method === 'CONNECT' && path !== '') {
    hosts.push(connectAuthorityHost(path));
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    hosts.push(new URL(path).hostname);
  }
  return hosts;
}

function connectAuthorityHost(authority: string): string {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    return end > 0 ? authority.slice(1, end) : authority;
  }
  const colon = authority.lastIndexOf(':');
  return colon > 0 ? authority.slice(0, colon) : authority;
}

const networkProtocols = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** The URL a `fetch` call targets, or undefined when it cannot be determined. */
export function fetchUrl(input: unknown): URL | undefined {
  try {
    if (typeof input === 'string') {
      return new URL(input);
    }
    if (input instanceof URL) {
      return input;
    }
    if (isRecord(input) && typeof input.url === 'string') {
      return new URL(input.url);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** The destination address of a `dgram` `send` or `connect` call; UDP defaults to loopback. */
export function datagramAddress(args: readonly unknown[]): string {
  const address = args.slice(1).find((arg): arg is string => typeof arg === 'string');
  return address ?? 'localhost';
}

/** Environment variables through which HTTP clients pick up a proxy. */
export const PROXY_ENVIRONMENT_VARIABLES = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'NODE_USE_ENV_PROXY',
  'GLOBAL_AGENT_HTTP_PROXY',
  'GLOBAL_AGENT_HTTPS_PROXY',
  'npm_config_proxy',
  'npm_config_https_proxy',
  'YARN_HTTP_PROXY',
  'YARN_HTTPS_PROXY',
] as const;

/** Removes the proxy variables from `env` and returns the names that were set. */
export function stripProxyEnvironment(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const name of PROXY_ENVIRONMENT_VARIABLES) {
    if (env[name] !== undefined) {
      removed.push(name);
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- env keys come from a fixed list
      delete env[name];
    }
  }
  return removed;
}

const installedFlag = Symbol.for('argus.testkit.networkGuard');

interface GuardState {
  installedAt: string;
  denied: number;
}

type AnyFunction = (...args: unknown[]) => unknown;

function guardState(): GuardState | undefined {
  return (globalThis as Record<symbol, GuardState | undefined>)[installedFlag];
}

/** True once `installNetworkGuard` has patched this process. */
export function isNetworkGuardInstalled(): boolean {
  return guardState() !== undefined;
}

/** Number of connection attempts the guard has refused in this process. */
export function deniedAttempts(): number {
  return guardState()?.denied ?? 0;
}

function deny(target: string, via: string): NetworkDeniedError {
  const state = guardState();
  if (state) {
    state.denied += 1;
  }
  return new NetworkDeniedError(target, via);
}

function wrap(owner: object, key: string, check: (args: readonly unknown[]) => void): void {
  const record = owner as Record<string, unknown>;
  const original = record[key];
  if (typeof original !== 'function') {
    return;
  }
  const originalFunction = original as AnyFunction;
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    check(args);
    return Reflect.apply(originalFunction, this, args);
  };
  Object.defineProperty(wrapped, 'name', { value: originalFunction.name });
  record[key] = wrapped;
}

function wrapAsync(owner: object, key: string, check: (args: readonly unknown[]) => void): void {
  const record = owner as Record<string, unknown>;
  const original = record[key];
  if (typeof original !== 'function') {
    return;
  }
  const originalFunction = original as AnyFunction;
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    try {
      check(args);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return Reflect.apply(originalFunction, this, args);
  };
  Object.defineProperty(wrapped, 'name', { value: originalFunction.name });
  record[key] = wrapped;
}

function checkSocketConnect(via: string): (args: readonly unknown[]) => void {
  return (args) => {
    const target = connectTarget(args);
    if (target.kind === 'host' && !isLoopbackHost(target.host)) {
      throw deny(describe(target), via);
    }
  };
}

/** Addresses a `lookup` callback reported: a single address or the `all: true` list. */
export function lookupAddresses(address: unknown): string[] {
  if (typeof address === 'string') {
    return [address];
  }
  if (Array.isArray(address)) {
    return address.map((entry: unknown) => {
      if (typeof entry === 'string') {
        return entry;
      }
      return isRecord(entry) && typeof entry.address === 'string' ? entry.address : '';
    });
  }
  return [];
}

/**
 * Wraps a caller-supplied `lookup` function (the `lookup` connect option) so that every
 * address it resolves to is checked: a loopback name that resolves to a non-loopback
 * address fails the connection with `NETWORK_DENIED` instead of connecting.
 */
export function guardLookupFunction(lookup: AnyFunction, via: string): AnyFunction {
  const guarded = function (this: unknown, ...args: unknown[]): unknown {
    const callbackIndex = args.length - 1;
    const callback = args[callbackIndex];
    if (typeof callback !== 'function') {
      return Reflect.apply(lookup, this, args);
    }
    const hostname = typeof args[0] === 'string' ? args[0] : '(unknown)';
    const checked = (error: unknown, address: unknown, ...rest: unknown[]): void => {
      if (error === null || error === undefined) {
        const refused = lookupAddresses(address).find((entry) => !isLoopbackHost(entry));
        if (refused !== undefined) {
          Reflect.apply(callback as AnyFunction, undefined, [
            deny(`${hostname} (resolved to ${refused === '' ? '(unknown)' : refused})`, via),
          ]);
          return;
        }
      }
      Reflect.apply(callback as AnyFunction, undefined, [error, address, ...rest]);
    };
    const nextArgs = [...args];
    nextArgs[callbackIndex] = checked;
    return Reflect.apply(lookup, this, nextArgs);
  };
  Object.defineProperty(guarded, 'name', { value: lookup.name });
  return guarded;
}

/**
 * Returns the connect arguments with a custom `lookup` option replaced by a guarded one.
 * The caller's options object is copied, not changed; Node's internal pre-normalised
 * array keeps its identity (it carries a private marker) and gets the copy in place.
 */
export function guardLookupOption(args: readonly unknown[], via: string): unknown[] {
  const normalized = Array.isArray(args[0]) ? (args[0] as unknown[]) : undefined;
  const options = normalized === undefined ? args[0] : normalized[0];
  if (!isRecord(options) || typeof options.lookup !== 'function') {
    return [...args];
  }
  const copy = { ...options, lookup: guardLookupFunction(options.lookup as AnyFunction, via) };
  if (normalized !== undefined) {
    normalized[0] = copy;
    return [...args];
  }
  return [copy, ...args.slice(1)];
}

function wrapSocketConnect(): void {
  const prototype = net.Socket.prototype as unknown as Record<string, unknown>;
  const original = prototype.connect;
  if (typeof original !== 'function') {
    return;
  }
  const originalFunction = original as AnyFunction;
  const check = checkSocketConnect('net.Socket.connect');
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    check(args);
    return Reflect.apply(originalFunction, this, guardLookupOption(args, 'net.Socket.connect'));
  };
  Object.defineProperty(wrapped, 'name', { value: originalFunction.name });
  prototype.connect = wrapped;
}

function checkTlsConnect(args: readonly unknown[]): void {
  const options = args.find(isRecord);
  if (options !== undefined && options.socket !== undefined) {
    return;
  }
  checkSocketConnect('tls.connect')(args);
}

function checkHttpRequest(via: string): (args: readonly unknown[]) => void {
  return (args) => {
    for (const host of httpRequestHosts(args)) {
      if (!isLoopbackHost(host)) {
        throw deny(host, via);
      }
    }
  };
}

/**
 * `dns.lookup` of an IP literal answers locally (sockets bind to 0.0.0.0 through it), so
 * only names that need resolution, other than localhost, are refused. The connection to
 * an address is checked when it is opened.
 */
function checkLookup(via: string): (args: readonly unknown[]) => void {
  return (args) => {
    const host = typeof args[0] === 'string' ? args[0] : '';
    if (net.isIP(host) === 0 && !isLoopbackHost(host)) {
      throw deny(host, via);
    }
  };
}

/** A reverse lookup queries DNS, so it is refused for every non-loopback address. */
function checkReverseLookup(via: string): (args: readonly unknown[]) => void {
  return (args) => {
    const host = typeof args[0] === 'string' ? args[0] : '';
    if (!isLoopbackHost(host)) {
      throw deny(host, via);
    }
  };
}

function denyAll(via: string): (args: readonly unknown[]) => void {
  return (args) => {
    throw deny(typeof args[0] === 'string' ? args[0] : '(unknown)', via);
  };
}

const resolverMethods = [
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTlsa',
  'resolveTxt',
  'reverse',
] as const;

export interface NetworkGuardOptions {
  /** File that receives one line per installation, so a harness can prove the guard ran. */
  reportFile?: string | undefined;
}

/**
 * Patches the current process so that non-loopback connections throw `NETWORK_DENIED`.
 * Idempotent: a second call only appends to the report file.
 */
export function installNetworkGuard(options: NetworkGuardOptions = {}): void {
  if (!isNetworkGuardInstalled()) {
    patchProcess();
  }
  if (options.reportFile !== undefined && options.reportFile !== '') {
    appendFileSync(options.reportFile, `${String(process.pid)}\n`);
  }
}

function patchProcess(): void {
  const state: GuardState = { installedAt: new Date().toISOString(), denied: 0 };
  (globalThis as Record<symbol, GuardState>)[installedFlag] = state;

  stripProxyEnvironment();

  wrapSocketConnect();
  wrap(net, 'connect', checkSocketConnect('net.connect'));
  wrap(net, 'createConnection', checkSocketConnect('net.createConnection'));
  wrap(tls, 'connect', checkTlsConnect);

  wrap(http, 'request', checkHttpRequest('http.request'));
  wrap(http, 'get', checkHttpRequest('http.get'));
  wrap(https, 'request', checkHttpRequest('https.request'));
  wrap(https, 'get', checkHttpRequest('https.get'));

  wrap(dgram.Socket.prototype, 'send', (args) => {
    const address = datagramAddress(args);
    if (!isLoopbackHost(address)) {
      throw deny(address, 'dgram.send');
    }
  });
  wrap(dgram.Socket.prototype, 'connect', (args) => {
    const address = datagramAddress(args);
    if (!isLoopbackHost(address)) {
      throw deny(address, 'dgram.connect');
    }
  });

  wrap(dns, 'lookup', checkLookup('dns.lookup'));
  wrap(dns, 'lookupService', checkReverseLookup('dns.lookupService'));
  wrapAsync(dns.promises, 'lookup', checkLookup('dns.promises.lookup'));
  wrapAsync(dns.promises, 'lookupService', checkReverseLookup('dns.promises.lookupService'));
  for (const method of resolverMethods) {
    wrap(dns, method, denyAll(`dns.${method}`));
    wrap(dns.Resolver.prototype, method, denyAll(`dns.Resolver.${method}`));
    wrapAsync(dns.promises, method, denyAll(`dns.promises.${method}`));
    wrapAsync(dns.promises.Resolver.prototype, method, denyAll(`dns.promises.Resolver.${method}`));
  }

  const originalFetch = globalThis.fetch;
  const guardedFetch = function fetch(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): ReturnType<typeof globalThis.fetch> {
    const url = fetchUrl(input);
    if (url !== undefined && networkProtocols.has(url.protocol) && !isLoopbackHost(url.hostname)) {
      return Promise.reject(deny(url.host, 'fetch'));
    }
    return originalFetch(input, init);
  };
  globalThis.fetch = guardedFetch;

  // `import { lookup } from 'node:dns'` binds the ESM named exports, which Node built
  // before this patch (this module imports the built-ins itself). Without this call they
  // would keep pointing at the original, unguarded functions.
  syncBuiltinESMExports();
}

const propagatedFlag = Symbol.for('argus.testkit.networkGuard.propagated');

/** The `NODE_OPTIONS` flag that preloads the guard, for a preload module URL. */
export function guardImportFlag(preloadUrl: string): string {
  return `--import=${preloadUrl}`;
}

/** `NODE_OPTIONS` with the guard's `--import` flag added once. */
export function withGuardNodeOptions(nodeOptions: string | undefined, preloadUrl: string): string {
  const flag = guardImportFlag(preloadUrl);
  const current = nodeOptions?.trim() ?? '';
  if (current.split(/\s+/).includes(flag)) {
    return current;
  }
  return current === '' ? flag : `${current} ${flag}`;
}

/**
 * The arguments of a `child_process` call with an explicit `env` option given the guard's
 * `NODE_OPTIONS`. Calls without an options object, or without `env`, inherit
 * `process.env` and need no change. The caller's objects are copied, not changed.
 */
export function guardChildProcessArguments(
  args: readonly unknown[],
  preloadUrl: string,
): unknown[] {
  const index = args.findIndex(
    (arg, position) => position > 0 && isRecord(arg) && !Array.isArray(arg),
  );
  const options = index < 0 ? undefined : (args[index] as Record<string, unknown>);
  if (options === undefined || !isRecord(options.env)) {
    return [...args];
  }
  const env = options.env as Record<string, string | undefined>;
  const next = [...args];
  next[index] = {
    ...options,
    env: { ...env, NODE_OPTIONS: withGuardNodeOptions(env.NODE_OPTIONS, preloadUrl) },
  };
  return next;
}

/**
 * The constructor arguments of a `Worker` that loads the preload first: a file worker
 * gets `--import=<preload>` in its `execArgv` (Node runs `--import` in workers, while
 * `NODE_OPTIONS` read at startup does not reach a worker with its own `execArgv`); an
 * `eval` worker, which ignores `--import`, gets a first statement that loads the preload.
 */
export function guardWorkerArguments(
  filename: unknown,
  options: unknown,
  preloadUrl: string,
  parentExecArgv: readonly string[] = process.execArgv,
): [unknown, Record<string, unknown>] {
  const given: Record<string, unknown> = isRecord(options) ? options : {};
  if (given.eval === true && typeof filename === 'string') {
    const load =
      `process.getBuiltinModule('node:module').createRequire(${JSON.stringify(preloadUrl)})` +
      `(${JSON.stringify(fileURLToPath(preloadUrl))});\n`;
    return [load + filename, { ...given }];
  }
  const execArgv = Array.isArray(given.execArgv)
    ? (given.execArgv as unknown[]).filter((arg): arg is string => typeof arg === 'string')
    : [...parentExecArgv];
  const flag = guardImportFlag(preloadUrl);
  return [
    filename,
    { ...given, execArgv: execArgv.includes(flag) ? execArgv : [...execArgv, flag] },
  ];
}

const childProcessFunctions = [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
] as const;

function wrapChildProcessFunction(
  name: (typeof childProcessFunctions)[number],
  preloadUrl: string,
): void {
  const record = childProcess as unknown as Record<string, unknown>;
  const original = record[name];
  if (typeof original !== 'function') {
    return;
  }
  const originalFunction = original as AnyFunction;
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    return Reflect.apply(originalFunction, this, guardChildProcessArguments(args, preloadUrl));
  };
  Object.defineProperty(wrapped, 'name', { value: originalFunction.name });
  // `util.promisify(exec)` and `util.promisify(execFile)` use this custom implementation.
  const custom = (originalFunction as unknown as Record<symbol, unknown>)[promisify.custom];
  if (typeof custom === 'function') {
    const customFunction = custom as AnyFunction;
    Object.defineProperty(wrapped, promisify.custom, {
      value: function (this: unknown, ...args: unknown[]): unknown {
        return Reflect.apply(customFunction, this, guardChildProcessArguments(args, preloadUrl));
      },
    });
  }
  record[name] = wrapped;
}

function wrapWorker(preloadUrl: string): void {
  const record = workerThreads as unknown as Record<string, unknown>;
  const Original = workerThreads.Worker;
  class GuardedWorker extends Original {
    constructor(filename: string | URL, options?: workerThreads.WorkerOptions) {
      const [guardedFilename, guardedOptions] = guardWorkerArguments(filename, options, preloadUrl);
      super(guardedFilename as string | URL, guardedOptions);
    }
  }
  Object.defineProperty(GuardedWorker, 'name', { value: 'Worker' });
  record.Worker = GuardedWorker;
}

/** The preload beside the given module URL: `.ts` in source form, `.js` in the built `dist`. */
export function networkGuardPreloadUrl(moduleUrl: string): string {
  const extension = new URL(moduleUrl).pathname.endsWith('.ts') ? 'ts' : 'js';
  return new URL(`./network-guard.preload.${extension}`, moduleUrl).href;
}

/** Why this Node cannot load the preload module in a child process or worker, if it cannot. */
export function preloadProblem(preloadUrl: string): string | undefined {
  if (!preloadUrl.startsWith('file:')) {
    return `the network guard preload must be a file URL, got ${preloadUrl}`;
  }
  const path = fileURLToPath(preloadUrl);
  if (!/\.[cm]?ts$/.test(path)) {
    return undefined;
  }
  if (path.split(/[\\/]/).includes('node_modules')) {
    return (
      `the network guard preload ${path} is TypeScript under node_modules, which Node does ` +
      'not load; import the Vitest preset by relative path (CLAUDE.md) or use the built dist'
    );
  }
  const features = process.features as { typescript?: unknown };
  if (features.typescript === undefined || features.typescript === false) {
    return `Node ${process.version} cannot load the TypeScript preload ${path}; use Node 22.18 or later`;
  }
  return undefined;
}

/**
 * Makes the processes and worker threads that this process starts install the guard too,
 * by preloading `preloadUrl` (a module that calls `installNetworkGuard` and this function).
 * Idempotent. Throws when this Node cannot load the preload, since a silent gap would make
 * Tier A evidence non-hermetic.
 */
export function propagateNetworkGuard(
  preloadUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const problem = preloadProblem(preloadUrl);
  if (problem !== undefined) {
    throw new Error(problem);
  }
  env.NODE_OPTIONS = withGuardNodeOptions(env.NODE_OPTIONS, preloadUrl);
  const globals = globalThis as Record<symbol, unknown>;
  if (globals[propagatedFlag] === true) {
    return;
  }
  globals[propagatedFlag] = true;
  for (const name of childProcessFunctions) {
    wrapChildProcessFunction(name, preloadUrl);
  }
  wrapWorker(preloadUrl);
  syncBuiltinESMExports();
}
