#!/usr/bin/env node
// Runs the gate tool from its TypeScript sources through tsx; no build is needed.
import { register } from 'tsx/esm/api';

register();
const { gateMain } = await import('../src/main.ts');
process.exitCode = await gateMain(process.argv.slice(2));
