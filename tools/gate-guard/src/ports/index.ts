export interface CommitInfo {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly subject: string;
}

export interface Repository {
  /** Paths changed between the merge base of base and head, and head. */
  diffFiles(base: string, head: string): Promise<string[]>;
  /** Commits of a `base..head` range, oldest first. */
  commits(range: string): Promise<CommitInfo[]>;
  /** Paths a commit changes relative to its first parent (all paths for a root commit). */
  commitFiles(sha: string): Promise<string[]>;
}

export class RepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export interface GuardIo {
  /** Reads a file list, or standard input for `-`. */
  readList(path: string): Promise<string>;
  info(line: string): void;
  error(line: string): void;
}
