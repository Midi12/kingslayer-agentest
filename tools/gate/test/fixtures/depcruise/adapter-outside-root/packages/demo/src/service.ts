import { save } from './adapters/store.js';

export function run(value: string): string {
  return save(value);
}
