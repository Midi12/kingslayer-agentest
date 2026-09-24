import { save } from '../../../demo/src/adapters/store.js';

export function mirror(value: string): string {
  return save(value);
}
