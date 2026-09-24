/**
 * Preload for the child processes and worker threads of a guarded test process
 * (`NODE_OPTIONS=--import=<this file>`, set by `propagateNetworkGuard`). Node loads it
 * natively, so it imports its dependency with the `.ts` extension in source form (the
 * build rewrites it to `.js`) and uses only erasable TypeScript syntax.
 */
import { installNetworkGuard, propagateNetworkGuard } from './network-guard.ts';

installNetworkGuard();
propagateNetworkGuard(import.meta.url);
