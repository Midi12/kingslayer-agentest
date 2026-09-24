import { statSync } from 'node:fs';
import type { Clock } from '../ports/clock.js';

export class SystemClock implements Clock {
  now(): number {
    return statSync('.').mtimeMs;
  }
}
