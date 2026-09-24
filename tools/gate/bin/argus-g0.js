#!/usr/bin/env node
// Runs the gate tool from its TypeScript sources; no build is needed.
import { registerSourceRuntime } from './register-source.js';

registerSourceRuntime();
const { g0Main } = await import('../src/main.ts');
process.exitCode = await g0Main(process.argv.slice(2));
