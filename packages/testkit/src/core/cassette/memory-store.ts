/** A cassette store in memory, for unit tests and for proxies that should not touch disk. */
import type { CassetteStore } from '../../ports/cassette.js';
import type { CassetteEntry } from './entry.js';

export class MemoryCassetteStore implements CassetteStore {
  readonly #entries = new Map<string, CassetteEntry>();

  constructor(entries: readonly CassetteEntry[] = []) {
    for (const entry of entries) {
      this.#entries.set(entry.key, entry);
    }
  }

  read(key: string): Promise<CassetteEntry | undefined> {
    return Promise.resolve(this.#entries.get(key));
  }

  write(entry: CassetteEntry): Promise<void> {
    this.#entries.set(entry.key, entry);
    return Promise.resolve();
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.#entries.keys()].sort());
  }
}
