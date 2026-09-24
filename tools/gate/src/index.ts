// Core: pure logic.
export { canonicalHash, canonicalize, CanonicalizationError } from './core/canonical-json.js';
export {
  evaluateExpression,
  lookupMetric,
  metricReferences,
  parseExpression,
} from './core/expression.js';
export type {
  Evaluation,
  EvaluationContext,
  Expression,
  ExpressionError,
} from './core/expression.js';
export { GateFileSchema, GateSchema, TIERS, validateGateFile } from './core/gate-file.js';
export type { GateDefinition, GateFile, Tier } from './core/gate-file.js';
export {
  EVIDENCE_VERSION,
  buildEvidence,
  exitCodeFor,
  passByTier,
  verifyEvidenceHash,
} from './core/evidence.js';
export type { Evidence, GateResult, GateStatus, NotRunEntry } from './core/evidence.js';
export { commandResult, notRunResult, parseMetrics } from './core/gate-outcome.js';
export { LineTail } from './core/log-tail.js';
export { MARKER_PATTERNS, isScannedFile, scanForMarkers } from './core/markers.js';
export type { MarkerHit } from './core/markers.js';
export { notRunReason, parseRequirement } from './core/requirements.js';
export type { Requirement } from './core/requirements.js';
export { err, ok } from './core/result.js';
export type { Result } from './core/result.js';

// Ports.
export type * from './ports/index.js';

// Application services.
export { LOG_TAIL_LINES, gateCli } from './app/run-gates.js';
export type { GateRunnerDeps } from './app/run-gates.js';
export { G0_COVERAGE_FLOOR, g0Cli, summarize as summarizeG0 } from './app/g0.js';
export type { G0Deps, G0Metrics, PackageReport } from './app/g0.js';
export { FIXTURE_EXCLUDE, REAL_TREE_ROOTS, depcruiseCli } from './app/depcruise.js';
export type { DepcruiseDeps } from './app/depcruise.js';

// Adapters, for composition roots.
export { NodeFileSystem } from './adapters/node-file-system.js';
export { NodeProcessRunner } from './adapters/node-process-runner.js';
export { findRepositoryRoot, loadDepcruiseExcludes } from './adapters/repository.js';
export {
  CommandToolVersions,
  ConsoleOutput,
  GitSourceControl,
  ShellRequirementProbe,
  SystemClock,
} from './adapters/system.js';
export { YamlDocumentLoader } from './adapters/yaml-document-loader.js';
