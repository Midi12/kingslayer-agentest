#!/usr/bin/env node
// Runs gate-guard from its TypeScript sources through tsx; no build is needed.
import { register } from 'tsx/esm/api';

register();
const { guardMain } = await import('../src/main.ts');
process.exitCode = await guardMain(process.argv.slice(2));
