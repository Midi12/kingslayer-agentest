/**
 * Composition root of the gate tool: wires the Node adapters into the three commands.
 * The bin launchers in ../bin call these functions.
 */
import {
  CommandToolVersions,
  ConsoleOutput,
  GitSourceControl,
  NodeFileSystem,
  NodeProcessRunner,
  ShellRequirementProbe,
  SystemClock,
  YamlDocumentLoader,
  depcruiseCli,
  findRepositoryRoot,
  g0Cli,
  gateCli,
  loadDepcruiseExcludes,
} from './index.js';

export interface MainContext {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

function defaultContext(): MainContext {
  return { cwd: process.cwd(), env: process.env };
}

export function gateMain(
  argv: readonly string[],
  context: MainContext = defaultContext(),
): Promise<number> {
  const root = findRepositoryRoot(context.cwd);
  const processes = new NodeProcessRunner();
  return gateCli(argv, {
    fs: new NodeFileSystem(),
    documents: new YamlDocumentLoader(),
    processes,
    probe: new ShellRequirementProbe(processes, context.env, root),
    clock: new SystemClock(),
    sourceControl: new GitSourceControl(processes, context.env),
    toolVersions: new CommandToolVersions(processes, context.env, root),
    output: new ConsoleOutput(),
    env: context.env,
    root,
    cwd: context.cwd,
  });
}

export function g0Main(
  argv: readonly string[],
  context: MainContext = defaultContext(),
): Promise<number> {
  return g0Cli(argv, {
    fs: new NodeFileSystem(),
    processes: new NodeProcessRunner(),
    output: new ConsoleOutput(),
    env: context.env,
    root: findRepositoryRoot(context.cwd),
    cwd: context.cwd,
  });
}

export function depcruiseMain(
  argv: readonly string[],
  context: MainContext = defaultContext(),
): Promise<number> {
  const root = findRepositoryRoot(context.cwd);
  return depcruiseCli(argv, {
    fs: new NodeFileSystem(),
    processes: new NodeProcessRunner(),
    output: new ConsoleOutput(),
    env: context.env,
    root,
    configExcludes: loadDepcruiseExcludes(root),
  });
}
