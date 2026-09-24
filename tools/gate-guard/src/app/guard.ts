import { type Classification, classifyChange } from '../core/classify.js';
import { GUARD_USAGE, parseFileList, parseGuardArgs } from '../core/cli-args.js';
import { isConventionalSubject } from '../core/conventional.js';
import { type GuardIo, type Repository, RepositoryError } from '../ports/index.js';

export interface GuardDeps {
  readonly io: GuardIo;
  /** Opens the repository at a directory (default: the current directory). */
  readonly openRepository: (directory: string | undefined) => Repository;
}

function report(label: string, classification: Classification, io: GuardIo): boolean {
  const counts = `protected ${String(classification.protected.length)}, implementation ${String(classification.implementation.length)}, tests ${String(classification.tests.length)}, neutral ${String(classification.neutral.length)}`;
  if (!classification.violation) {
    io.info(`OK         ${label} (${counts})`);
    return true;
  }
  io.error(`VIOLATION  ${label}: protected paths changed together with implementation paths`);
  for (const path of classification.protected) {
    io.error(`  protected       ${path}`);
  }
  for (const path of classification.implementation) {
    io.error(`  implementation  ${path}`);
  }
  if (!classification.testsNeutral) {
    for (const path of classification.tests) {
      io.error(`  test            ${path}`);
    }
    if (classification.tests.length > 0) {
      io.error(
        '  tests change with protected paths only in test(<MOD>): or chore(<MOD>): gate-change commits',
      );
    }
  }
  return false;
}

async function checkRange(
  repository: Repository,
  range: string,
  perCommit: boolean,
  conventional: boolean,
  io: GuardIo,
): Promise<boolean> {
  const commits = await repository.commits(range);
  if (commits.length === 0) {
    io.info(`OK         ${range}: no commits`);
    return true;
  }
  let passed = true;
  const all: string[] = [];
  for (const commit of commits) {
    const label = `${commit.sha.slice(0, 7)} ${commit.subject}`;
    const merge = commit.parents.length > 1;
    if (conventional && !merge && !isConventionalSubject(commit.subject)) {
      io.error(`VIOLATION  ${label}: subject is not a conventional commit, e.g. feat(M06): ...`);
      passed = false;
    }
    if (merge) {
      io.info(`SKIP       ${label} (merge commit; its commits are checked one by one)`);
      continue;
    }
    const files = await repository.commitFiles(commit.sha);
    if (perCommit) {
      passed = report(label, classifyChange(files, { subject: commit.subject }), io) && passed;
    } else {
      all.push(...files);
    }
  }
  if (!perCommit) {
    passed = report(`range ${range}`, classifyChange(all), io) && passed;
  }
  return passed;
}

/** Runs gate-guard and returns the exit code: 0 clean, 1 violation, 2 usage or git error. */
export async function guardCli(argv: readonly string[], deps: GuardDeps): Promise<number> {
  const { io } = deps;
  const parsed = parseGuardArgs(argv);
  if (!parsed.ok) {
    io.error(`gate-guard: ${parsed.error}`);
    io.error(GUARD_USAGE);
    return 2;
  }
  const command = parsed.value;
  try {
    switch (command.kind) {
      case 'help':
        io.info(GUARD_USAGE);
        return 0;
      case 'files': {
        const files = parseFileList(await io.readList(command.list));
        const label =
          command.subject === undefined
            ? `files ${command.list}`
            : `files ${command.list} (${command.subject})`;
        return report(label, classifyChange(files, { subject: command.subject }), io) ? 0 : 1;
      }
      case 'diff': {
        const files = await deps.openRepository(command.repo).diffFiles(command.base, command.head);
        return report(`diff ${command.base}...${command.head}`, classifyChange(files), io) ? 0 : 1;
      }
      case 'range':
        return (await checkRange(
          deps.openRepository(command.repo),
          command.range,
          command.perCommit,
          command.conventional,
          io,
        ))
          ? 0
          : 1;
    }
  } catch (error) {
    if (error instanceof RepositoryError) {
      io.error(`gate-guard: ${error.message}`);
      return 2;
    }
    if ((error as { code?: unknown } | null)?.code === 'ENOENT') {
      io.error(`gate-guard: ${(error as Error).message}`);
      return 2;
    }
    throw error;
  }
}
