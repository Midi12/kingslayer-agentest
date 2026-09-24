/**
 * Contract: Observation (Architecture and contracts, "Contract: Observation and Navigator").
 *
 * `bbox`, `attrs` and `fingerprint` of a candidate stay in the runner. They carry the
 * `x-runner-only` annotation, and `stripForNavigator()` removes them; the navigator-facing
 * shapes (`NavigatorCandidate`, `NavigatorObservation`) do not allow them at all.
 */
import { Type, type Static } from '@sinclair/typebox';
import { CANDIDATE_SOURCES, PALETTE } from '../enums.js';
import {
  ArtifactRef,
  CandidateId,
  IsoTimestamp,
  NonNegativeInteger,
  Sha256,
  closedObject,
  literalUnion,
} from './common.js';

/** Annotation marking a property that never leaves the runner. */
export const RUNNER_ONLY_KEYWORD = 'x-runner-only';

/** Candidate properties that stay in the runner. */
export const RUNNER_ONLY_CANDIDATE_FIELDS = ['bbox', 'attrs', 'fingerprint'] as const;

const shortText = (maxLength: number) => Type.String({ maxLength });

export const CandidateState = closedObject({
  enabled: Type.Optional(Type.Boolean()),
  visible: Type.Optional(Type.Boolean()),
  checked: Type.Optional(Type.Boolean()),
  selected: Type.Optional(Type.Boolean()),
  expanded: Type.Optional(Type.Boolean()),
  focused: Type.Optional(Type.Boolean()),
  readonly: Type.Optional(Type.Boolean()),
  value: Type.Optional(shortText(1000)),
});

export const CandidateContext = closedObject({
  row: Type.Optional(shortText(1000)),
  heading: Type.Optional(shortText(300)),
  legend: Type.Optional(shortText(300)),
  region: Type.Optional(shortText(300)),
  labels: Type.Optional(Type.Array(shortText(300), { maxItems: 16 })),
});

const navigatorCandidateProperties = {
  cid: CandidateId,
  role: shortText(64),
  name: shortText(500),
  tag: shortText(64),
  state: CandidateState,
  context: CandidateContext,
  color: Type.Optional(literalUnion(PALETTE)),
  source: literalUnion(CANDIDATE_SOURCES),
};

export const NavigatorCandidate = closedObject(navigatorCandidateProperties, {
  description: 'A candidate as it may leave the runner: no bbox, attrs or fingerprint',
});
export type NavigatorCandidate = Static<typeof NavigatorCandidate>;

export const BoundingBox = Type.Array(Type.Number(), {
  minItems: 4,
  maxItems: 4,
  description: '[x, y, width, height] in CSS pixels',
  [RUNNER_ONLY_KEYWORD]: true,
});

export const Candidate = closedObject({
  cid: CandidateId,
  role: shortText(64),
  name: shortText(500),
  tag: shortText(64),
  state: CandidateState,
  context: CandidateContext,
  attrs: Type.Record(
    Type.String({ pattern: '^[A-Za-z_:][A-Za-z0-9_:.-]{0,127}$' }),
    shortText(2000),
    {
      additionalProperties: false,
      [RUNNER_ONLY_KEYWORD]: true,
    },
  ),
  bbox: BoundingBox,
  color: Type.Optional(literalUnion(PALETTE)),
  source: literalUnion(CANDIDATE_SOURCES),
  fingerprint: Type.String({ minLength: 1, maxLength: 128, [RUNNER_ONLY_KEYWORD]: true }),
});
export type Candidate = Static<typeof Candidate>;

export const ConsoleEntry = closedObject({
  level: literalUnion(['error', 'warning', 'info', 'debug'] as const),
  text: shortText(4000),
  ts: Type.Optional(IsoTimestamp),
});
export type ConsoleEntry = Static<typeof ConsoleEntry>;

export const NetworkEntry = closedObject({
  method: Type.String({ minLength: 1, maxLength: 16 }),
  url: Type.String({ minLength: 1, maxLength: 2048 }),
  status: Type.Integer({ minimum: 0, maximum: 999, description: '0 when the request failed' }),
  failure: Type.Optional(shortText(500)),
  ts: Type.Optional(IsoTimestamp),
});
export type NetworkEntry = Static<typeof NetworkEntry>;

export const PageSummary = closedObject({
  headings: Type.Array(shortText(300), { maxItems: 64 }),
  dialogs: Type.Array(shortText(1000), { maxItems: 16 }),
  alerts: Type.Array(shortText(1000), { maxItems: 32 }),
  loading: closedObject({ inflightRequests: NonNegativeInteger, spinners: NonNegativeInteger }),
  textDigest: shortText(20_000),
});
export type PageSummary = Static<typeof PageSummary>;

export const ObservationFrames = closedObject({
  before: Type.Optional(ArtifactRef),
  after: Type.Optional(ArtifactRef),
  ringHead: NonNegativeInteger,
});

const observationHead = {
  obsId: Type.String({ pattern: '^obs_[A-Za-z0-9_-]{1,64}$' }),
  ts: IsoTimestamp,
  url: Type.String({ maxLength: 2048 }),
  title: shortText(500),
  page: PageSummary,
};
const observationTail = {
  console: Type.Array(ConsoleEntry, { maxItems: 200 }),
  network: Type.Array(NetworkEntry, { maxItems: 500 }),
  frames: ObservationFrames,
  digestHash: Sha256,
};

export const Observation = closedObject({
  ...observationHead,
  candidates: Type.Array(Candidate, { maxItems: 5000 }),
  ...observationTail,
});
export type Observation = Static<typeof Observation>;

export const NavigatorObservation = closedObject(
  {
    ...observationHead,
    candidates: Type.Array(NavigatorCandidate, { maxItems: 5000 }),
    ...observationTail,
  },
  { description: 'An observation after stripForNavigator(): nothing runner-only remains' },
);
export type NavigatorObservation = Static<typeof NavigatorObservation>;

/** The part of an observation a break packet carries. */
export const ObservationSummary = closedObject({
  obsId: Type.Optional(observationHead.obsId),
  digestHash: Sha256,
  url: Type.Optional(observationHead.url),
  title: Type.Optional(observationHead.title),
  page: Type.Optional(PageSummary),
});
export type ObservationSummary = Static<typeof ObservationSummary>;
