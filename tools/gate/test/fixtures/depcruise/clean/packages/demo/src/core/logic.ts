import { Type } from '@sinclair/typebox';
import type { Clock } from '../ports/clock.js';

export const Schema = Type.Number();

export function stamp(clock: Clock): number {
  return clock.now();
}
