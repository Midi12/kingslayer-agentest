/**
 * Vitest setup file installed by the shared preset: every Tier A test process runs
 * behind the network guard, and so do the Node child processes and worker threads it
 * starts (through the preload next to this file). `ARGUS_NETWORK_GUARD_REPORT` names a
 * file that receives one line per installation, which `pnpm g0` reads to prove the guard
 * was active.
 */
import {
  installNetworkGuard,
  networkGuardPreloadUrl,
  propagateNetworkGuard,
} from './network-guard.js';

installNetworkGuard({ reportFile: process.env.ARGUS_NETWORK_GUARD_REPORT });
propagateNetworkGuard(networkGuardPreloadUrl(import.meta.url));
