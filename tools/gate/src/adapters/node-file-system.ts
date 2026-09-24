import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FileSystem } from '../ports/index.js';

function isNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT';
}

export class NodeFileSystem implements FileSystem {
  readText(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  async readTextIfExists(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, 'utf8');
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async isDirectory(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  }

  async list(path: string): Promise<string[]> {
    return (await readdir(path)).sort();
  }

  async walk(path: string, skipDirectories: readonly string[]): Promise<string[]> {
    const files: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!skipDirectories.includes(entry.name)) {
            await visit(full);
          }
        } else if (entry.isFile()) {
          files.push(full);
        }
      }
    };
    await visit(path);
    return files;
  }

  async mkdirp(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  makeTempDir(prefix: string): Promise<string> {
    return mkdtemp(join(tmpdir(), prefix));
  }

  async remove(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }
}
