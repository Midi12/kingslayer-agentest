/**
 * Where cassette entries live. The fake Jev server, the fetch wrapper and the proxy read
 * and write through this port: files in a directory per suite, or memory in unit tests.
 */
import type { CassetteEntry } from '../core/cassette/entry.js';

export interface CassetteStore {
  /** The entry recorded under `key`, or undefined. */
  read(key: string): Promise<CassetteEntry | undefined>;
  /** Records an entry, replacing any entry with the same key. */
  write(entry: CassetteEntry): Promise<void>;
  /** Keys of every recorded entry, sorted. */
  keys(): Promise<string[]>;
}
