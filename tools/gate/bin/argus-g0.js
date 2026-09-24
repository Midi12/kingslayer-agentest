#!/usr/bin/env node
// Runs the gate tool from its TypeScript sources through tsx; no build is needed.
import { register } from 'tsx/esm/api';

register();
const { g0Main } = await import('../src/main.ts');
process.exitCode = await g0Main(process.argv.slice(2));
