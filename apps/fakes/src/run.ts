/**
 * Starts the servers a configuration asks for. Script and target files are read and
 * validated before any server starts, so a bad file fails the start with its key name.
 */
import { readFile } from 'node:fs/promises';
import {
  FileCassetteStore,
  oracleFromTargets,
  parseJevScript,
  parseLlmScript,
  parseTargetMap,
  startCassetteProxy,
  startFakeJev,
  startFakeLlm,
  type FakeJevMode,
  type JevRequestRecord,
  type LlmRequestRecord,
  type LlmScript,
} from '@argus/testkit';
import type { ConfigProblem, FakesConfig } from './config.js';

export interface FakesLogger {
  info(object: Record<string, unknown>, message: string): void;
  debug(object: Record<string, unknown>, message: string): void;
}

export interface RunningServer {
  readonly service: 'fake-jev' | 'fake-llm' | 'cassette-proxy';
  readonly url: string;
}

export interface RunningFakes {
  readonly servers: readonly RunningServer[];
  close(): Promise<void>;
}

export type StartResult =
  | { readonly ok: true; readonly fakes: RunningFakes }
  | { readonly ok: false; readonly problems: readonly ConfigProblem[] };

export type ReadText = (path: string) => Promise<string>;

const defaultRead: ReadText = (path) => readFile(path, 'utf8');

async function readJson(
  read: ReadText,
  key: string,
  path: string,
): Promise<{ ok: true; value: unknown } | { ok: false; problem: ConfigProblem }> {
  let text: string;
  try {
    text = await read(path);
  } catch (error) {
    return {
      ok: false,
      problem: {
        key,
        message: `cannot read the file (${(error as NodeJS.ErrnoException).code ?? 'error'})`,
      },
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, problem: { key, message: 'the file is not valid JSON' } };
  }
}

/** Default Jev script without a file: every question gets the uniform answer. */
const DEFAULT_JEV_SCRIPT = { fallback: 'uniform' as const };

async function jevMode(
  config: FakesConfig,
  read: ReadText,
): Promise<{ ok: true; mode: FakeJevMode } | { ok: false; problem: ConfigProblem }> {
  const mode = config.jev.mode;
  switch (mode.kind) {
    case 'cassette':
      return {
        ok: true,
        mode: { kind: 'cassette', store: new FileCassetteStore(mode.cassetteDir) },
      };
    case 'oracle': {
      const file = await readJson(read, 'FAKE_JEV_ORACLE_TARGETS', mode.targetsFile);
      if (!file.ok) {
        return file;
      }
      const targets = parseTargetMap(file.value);
      return targets.ok
        ? {
            ok: true,
            mode: {
              kind: 'oracle',
              truth: oracleFromTargets(targets.value),
              seed: mode.seed,
              noise: mode.noise,
            },
          }
        : { ok: false, problem: { key: 'FAKE_JEV_ORACLE_TARGETS', message: targets.error } };
    }
    case 'scripted': {
      if (mode.scriptFile === undefined) {
        return { ok: true, mode: { kind: 'scripted', script: DEFAULT_JEV_SCRIPT } };
      }
      const file = await readJson(read, 'FAKE_JEV_SCRIPT', mode.scriptFile);
      if (!file.ok) {
        return file;
      }
      const script = parseJevScript(file.value);
      return script.ok
        ? { ok: true, mode: { kind: 'scripted', script: script.value } }
        : { ok: false, problem: { key: 'FAKE_JEV_SCRIPT', message: script.error } };
    }
  }
}

async function llmScript(
  config: FakesConfig,
  read: ReadText,
): Promise<{ ok: true; script: LlmScript } | { ok: false; problem: ConfigProblem }> {
  let script: LlmScript = {};
  if (config.llm.scriptFile !== undefined) {
    const file = await readJson(read, 'FAKE_LLM_SCRIPT', config.llm.scriptFile);
    if (!file.ok) {
      return file;
    }
    const parsed = parseLlmScript(file.value);
    if (!parsed.ok) {
      return { ok: false, problem: { key: 'FAKE_LLM_SCRIPT', message: parsed.error } };
    }
    script = parsed.value;
  }
  return {
    ok: true,
    script: config.llm.fault === undefined ? script : { ...script, fault: config.llm.fault },
  };
}

function logJev(logger: FakesLogger) {
  return (record: JevRequestRecord): void => {
    logger.debug(
      {
        service: 'fake-jev',
        requestId: record.requestId,
        method: record.method,
        path: record.path,
        status: record.status,
        outcome: record.outcome,
      },
      'request',
    );
  };
}

function logLlm(logger: FakesLogger) {
  return (record: LlmRequestRecord): void => {
    logger.debug(
      {
        service: 'fake-llm',
        seq: record.seq,
        method: record.method,
        path: record.path,
        status: record.status,
        outcome: record.outcome,
        fault: record.fault ?? null,
      },
      'request',
    );
  };
}

/** Starts the configured fakes; on a start error the servers already started are closed. */
export async function startFakes(
  config: FakesConfig,
  logger: FakesLogger,
  read: ReadText = defaultRead,
): Promise<StartResult> {
  const wantsJev = config.command === 'fake-jev' || config.command === 'all';
  const wantsLlm = config.command === 'fake-llm' || config.command === 'all';
  const problems: ConfigProblem[] = [];
  const mode = wantsJev ? await jevMode(config, read) : undefined;
  if (mode !== undefined && !mode.ok) {
    problems.push(mode.problem);
  }
  const script = wantsLlm ? await llmScript(config, read) : undefined;
  if (script !== undefined && !script.ok) {
    problems.push(script.problem);
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  const servers: (RunningServer & { close(): Promise<void> })[] = [];
  const closeAll = async (): Promise<void> => {
    await Promise.all(servers.map((server) => server.close()));
  };
  try {
    if (mode?.ok === true) {
      const jev = await startFakeJev({
        host: config.host,
        port: config.jev.port,
        mode: mode.mode,
        version: config.version,
        onRequest: logJev(logger),
        ...(config.jev.apiKeys === undefined ? {} : { apiKeys: config.jev.apiKeys }),
      });
      servers.push({ service: 'fake-jev', url: jev.url, close: () => jev.close() });
      logger.info(
        { service: 'fake-jev', url: jev.url, mode: mode.mode.kind },
        'fake-jev listening',
      );
    }
    if (script?.ok === true) {
      const llm = await startFakeLlm({
        host: config.host,
        port: config.llm.port,
        script: script.script,
        version: config.version,
        onRequest: logLlm(logger),
        ...(config.llm.apiKeys === undefined ? {} : { apiKeys: config.llm.apiKeys }),
      });
      servers.push({ service: 'fake-llm', url: llm.url, close: () => llm.close() });
      logger.info(
        { service: 'fake-llm', url: llm.url, fault: config.llm.fault ?? null },
        'fake-llm listening',
      );
    }
    if (
      config.command === 'cassette-proxy' &&
      config.proxy.upstream !== undefined &&
      config.proxy.cassetteDir !== undefined
    ) {
      const proxy = await startCassetteProxy({
        host: config.host,
        port: config.proxy.port,
        upstream: config.proxy.upstream,
        store: config.proxy.cassetteDir,
        mode: config.proxy.mode,
      });
      servers.push({ service: 'cassette-proxy', url: proxy.url, close: () => proxy.close() });
      logger.info(
        { service: 'cassette-proxy', url: proxy.url, mode: config.proxy.mode },
        'cassette-proxy listening',
      );
    }
  } catch (error) {
    await closeAll();
    throw error;
  }
  return {
    ok: true,
    fakes: {
      servers: servers.map(({ service, url }) => ({ service, url })),
      close: closeAll,
    },
  };
}
