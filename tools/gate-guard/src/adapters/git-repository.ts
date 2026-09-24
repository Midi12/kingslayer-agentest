import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type CommitInfo, type Repository, RepositoryError } from '../ports/index.js';

const run = promisify(execFile);

function splitNul(output: string): string[] {
  return output.split('\0').filter((part) => part !== '');
}

export class GitRepository implements Repository {
  constructor(private readonly directory: string) {}

  private async git(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await run('git', ['-C', this.directory, ...args], {
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
      });
      return stdout;
    } catch (error) {
      const stderr = (error as { stderr?: unknown }).stderr;
      const detail =
        typeof stderr === 'string' && stderr.trim() !== '' ? stderr.trim() : String(error);
      throw new RepositoryError(`git ${args.join(' ')} failed: ${detail}`);
    }
  }

  async diffFiles(base: string, head: string): Promise<string[]> {
    return splitNul(
      await this.git(['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--']),
    );
  }

  async commits(range: string): Promise<CommitInfo[]> {
    const output = await this.git(['log', '--reverse', '--format=%H %P%x00%s%x00', range, '--']);
    const fields = output.split('\0');
    const commits: CommitInfo[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const [sha = '', ...parents] = (fields[index] ?? '')
        .trim()
        .split(' ')
        .filter((part) => part !== '');
      commits.push({ sha, parents, subject: fields[index + 1] ?? '' });
    }
    return commits;
  }

  async commitFiles(sha: string): Promise<string[]> {
    return splitNul(
      await this.git([
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '--no-renames',
        '-r',
        '-z',
        '--root',
        sha,
      ]),
    );
  }
}
