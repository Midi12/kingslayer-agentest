#!/usr/bin/env node
// Runs the gate tool from its TypeScript sources through tsx; no build is needed.
import { register } from 'tsx/esm/api';

register();
const { depcruiseMain } = await import('../src/main.ts');
process.exitCode = await depcruiseMain(process.argv.slice(2));
