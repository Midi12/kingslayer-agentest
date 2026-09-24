import { readFile } from 'node:fs/promises';
import type { GuardIo } from '../ports/index.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class NodeGuardIo implements GuardIo {
  readList(path: string): Promise<string> {
    return path === '-' ? readStdin() : readFile(path, 'utf8');
  }

  info(line: string): void {
    process.stdout.write(`${line}\n`);
  }

  error(line: string): void {
    process.stderr.write(`${line}\n`);
  }
}
