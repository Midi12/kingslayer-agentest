export {
  NETWORK_DENIED,
  NetworkDeniedError,
  PROXY_ENVIRONMENT_VARIABLES,
  connectTarget,
  datagramAddress,
  deniedAttempts,
  fetchUrl,
  guardChildProcessArguments,
  guardImportFlag,
  guardLookupFunction,
  guardLookupOption,
  guardWorkerArguments,
  httpRequestHosts,
  installNetworkGuard,
  isLoopbackHost,
  isNetworkGuardInstalled,
  lookupAddresses,
  networkGuardPreloadUrl,
  preloadProblem,
  propagateNetworkGuard,
  stripProxyEnvironment,
  withGuardNodeOptions,
} from './network-guard.js';
export type { ConnectTarget, NetworkGuardOptions } from './network-guard.js';
export { recordGateMetrics } from './gate-metrics.js';
export type { MetricValue, Metrics } from './gate-metrics.js';
