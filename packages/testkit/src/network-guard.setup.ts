/**
 * Vitest setup file installed by the shared preset: every Tier A test process runs
 * behind the network guard. `ARGUS_NETWORK_GUARD_REPORT` names a file that receives one
 * line per installation, which `pnpm g0` reads to prove the guard was active.
 */
import { installNetworkGuard } from './network-guard.js';

installNetworkGuard({ reportFile: process.env.ARGUS_NETWORK_GUARD_REPORT });
