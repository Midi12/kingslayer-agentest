import { save } from '../adapters/store.js';

export function decide(value: string): string {
  return save(value);
}
