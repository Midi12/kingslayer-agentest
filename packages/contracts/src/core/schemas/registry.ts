/**
 * The registry of every top-level schema by name. Each entry is published as
 * `schemas/argus/v1/<file>.schema.json` with `$id` `<SCHEMA_ID_BASE><file>.schema.json`.
 */
import type { Static, TSchema } from '@sinclair/typebox';
import { SCHEMA_ID_BASE } from '../enums.js';
import {
  AnalystDecision,
  BreakPacket,
  ReportBody,
  ReportInput,
  RunReport,
  TriageRequest,
  VisionAssertRequest,
  VisionAssertResult,
  VisualGroundRequest,
  VisualGroundResult,
} from './analyst.js';
import {
  ArtifactsRequest,
  ArtifactsResponse,
  BrainAssertVisualResponse,
  BrainCompileResponse,
  BrainGroundResponse,
  BrainGroundVisualResponse,
  BrainReportResponse,
  BrainTriageResponse,
  BrainVerifyResponse,
  CompleteRequest,
  CompleteResponse,
  EventsBatchResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  LeaseRequest,
  LeaseResponse,
  Problem,
  RunnerRegisterRequest,
  RunnerRegisterResponse,
} from './api.js';
import {
  BrainUsage,
  Clarification,
  CompileRequest,
  CompileResult,
  LintFinding,
} from './compile.js';
import { RunEvent, RunEventBatch, UsageEvent, type RunEvent as RunEventType } from './events.js';
import { GroundRequest, GroundResult, VerifyRequest, VerifyResult } from './navigator.js';
import { Candidate, NavigatorObservation, Observation } from './observation.js';
import { Action, Expectation, Fragment, Policy, Step, Target, TestScript } from './script.js';

export const SCHEMAS = {
  TestScript,
  Fragment,
  Step,
  Action,
  Target,
  Expectation,
  Policy,
  Observation,
  Candidate,
  NavigatorObservation,
  GroundRequest,
  GroundResult,
  VerifyRequest,
  VerifyResult,
  BreakPacket,
  AnalystDecision,
  TriageRequest,
  VisualGroundRequest,
  VisualGroundResult,
  VisionAssertRequest,
  VisionAssertResult,
  ReportInput,
  ReportBody,
  RunReport,
  RunEvent,
  RunEventBatch,
  UsageEvent,
  CompileRequest,
  CompileResult,
  LintFinding,
  Clarification,
  BrainUsage,
  RunnerRegisterRequest,
  RunnerRegisterResponse,
  LeaseRequest,
  LeaseResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  EventsBatchResponse,
  ArtifactsRequest,
  ArtifactsResponse,
  CompleteRequest,
  CompleteResponse,
  BrainCompileResponse,
  BrainGroundResponse,
  BrainVerifyResponse,
  BrainTriageResponse,
  BrainGroundVisualResponse,
  BrainAssertVisualResponse,
  BrainReportResponse,
  Problem,
} as const satisfies Record<string, TSchema>;

export type SchemaName = keyof typeof SCHEMAS;
/** The static type of a registered schema (run events use the hand-written union). */
export type SchemaType<N extends SchemaName> = N extends 'RunEvent'
  ? RunEventType
  : N extends 'RunEventBatch'
    ? RunEventType[]
    : Static<(typeof SCHEMAS)[N]>;

export const SCHEMA_NAMES = Object.keys(SCHEMAS) as SchemaName[];

export function isSchemaName(name: string): name is SchemaName {
  return Object.prototype.hasOwnProperty.call(SCHEMAS, name);
}

/** `TestScript` -> `test-script`. */
export function schemaFileStem(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

export function schemaFileName(name: SchemaName): string {
  return `${schemaFileStem(name)}.schema.json`;
}

export function schemaId(name: SchemaName): string {
  return `${SCHEMA_ID_BASE}${schemaFileName(name)}`;
}

/** Brain API routes with their request and response schemas. */
export const BRAIN_ENDPOINTS = {
  compile: {
    path: '/brain/v1/compile',
    request: 'CompileRequest',
    response: 'BrainCompileResponse',
  },
  ground: { path: '/brain/v1/ground', request: 'GroundRequest', response: 'BrainGroundResponse' },
  verify: { path: '/brain/v1/verify', request: 'VerifyRequest', response: 'BrainVerifyResponse' },
  triage: { path: '/brain/v1/triage', request: 'TriageRequest', response: 'BrainTriageResponse' },
  'ground-visual': {
    path: '/brain/v1/ground-visual',
    request: 'VisualGroundRequest',
    response: 'BrainGroundVisualResponse',
  },
  'assert-visual': {
    path: '/brain/v1/assert-visual',
    request: 'VisionAssertRequest',
    response: 'BrainAssertVisualResponse',
  },
  report: { path: '/brain/v1/report', request: 'ReportInput', response: 'BrainReportResponse' },
} as const satisfies Record<string, { path: string; request: SchemaName; response: SchemaName }>;

/**
 * Runner protocol routes. `{id}` is the run id. `events` takes NDJSON lines, each a
 * `RunEvent`; parsed, the lines form a `RunEventBatch`. `lease` answers 204 when idle.
 */
export const RUNNER_ENDPOINTS = {
  register: {
    path: '/runner/v1/register',
    request: 'RunnerRegisterRequest',
    response: 'RunnerRegisterResponse',
  },
  lease: { path: '/runner/v1/lease', request: 'LeaseRequest', response: 'LeaseResponse' },
  heartbeat: {
    path: '/runner/v1/runs/{id}/heartbeat',
    request: 'HeartbeatRequest',
    response: 'HeartbeatResponse',
  },
  events: {
    path: '/runner/v1/runs/{id}/events',
    request: 'RunEventBatch',
    response: 'EventsBatchResponse',
  },
  artifacts: {
    path: '/runner/v1/runs/{id}/artifacts',
    request: 'ArtifactsRequest',
    response: 'ArtifactsResponse',
  },
  complete: {
    path: '/runner/v1/runs/{id}/complete',
    request: 'CompleteRequest',
    response: 'CompleteResponse',
  },
} as const satisfies Record<string, { path: string; request: SchemaName; response: SchemaName }>;
