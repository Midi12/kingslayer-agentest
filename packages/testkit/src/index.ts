export {
  NETWORK_DENIED,
  NetworkDeniedError,
  PROXY_ENVIRONMENT_VARIABLES,
  connectTarget,
  datagramAddress,
  deniedAttempts,
  fetchUrl,
  guardLookupFunction,
  guardLookupOption,
  httpRequestHosts,
  installNetworkGuard,
  isLoopbackHost,
  isNetworkGuardInstalled,
  lookupAddresses,
  stripProxyEnvironment,
} from './network-guard.js';
export type { ConnectTarget, NetworkGuardOptions } from './network-guard.js';
export { recordGateMetrics } from './gate-metrics.js';
export type { MetricValue, Metrics } from './gate-metrics.js';
