/** Ports of the gate tool. Adapters in ../adapters implement them for Node. */

export interface ProcessRequest {
  /** Program and arguments; no shell is involved unless argv[0] is a shell. */
  readonly argv: readonly string[];
  readonly cwd: string;
  /** The complete environment of the child process. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
  /** Lines kept in `tail`. */
  readonly tailLines?: number;
  /** Called with each complete line of combined stdout and stderr. */
  readonly onLine?: (line: string) => void;
}

export interface ProcessResult {
  /** Exit code, or null when the process was killed by a signal or never started. */
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** The last lines of combined output. */
  readonly tail: readonly string[];
  readonly totalLines: number;
  /** Set when the program could not be started at all. */
  readonly spawnError?: string;
}

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>;
}

export interface FileSystem {
  readText(path: string): Promise<string>;
  /** Contents, or null when the file does not exist. */
  readTextIfExists(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  /** Entry names of a directory, sorted. */
  list(path: string): Promise<string[]>;
  /** Every file below a directory, as absolute paths, skipping the named directories. */
  walk(path: string, skipDirectories: readonly string[]): Promise<string[]>;
  mkdirp(path: string): Promise<void>;
  makeTempDir(prefix: string): Promise<string>;
  remove(path: string): Promise<void>;
}

/** Reads a YAML document. */
export interface DocumentLoader {
  loadYaml(path: string): Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;
}

export interface RequirementProbe {
  /** True when the environment variable is set to a non-empty value. */
  hasEnv(name: string): boolean;
  /** Undefined when the tool is usable, otherwise why not. */
  toolProblem(name: string): Promise<string | undefined>;
}

export interface Clock {
  now(): Date;
}

export interface SourceControl {
  /** Short hash of HEAD, or null outside a repository. */
  shortCommit(root: string): Promise<string | null>;
  /** Whether the working tree has no changes, or null outside a repository. */
  isClean(root: string): Promise<boolean | null>;
  /** Whether git ignores `path` (so it is never committed), or null outside a repository. */
  isIgnored(root: string, path: string): Promise<boolean | null>;
}

export interface ToolVersions {
  collect(): Promise<Record<string, string>>;
}

export interface Output {
  info(line: string): void;
  error(line: string): void;
}
