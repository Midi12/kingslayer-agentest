#!/usr/bin/env node
// Runs gate-guard from its TypeScript sources; no build is needed.
import { registerSourceRuntime } from './register-source.js';

registerSourceRuntime();
const { guardMain } = await import('../src/main.ts');
process.exitCode = await guardMain(process.argv.slice(2));
