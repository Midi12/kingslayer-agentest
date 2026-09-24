/**
 * Observation helpers. `bbox`, `attrs` and `fingerprint` stay in the runner
 * (Architecture and contracts, "Observation").
 */
import type {
  Candidate,
  NavigatorCandidate,
  NavigatorObservation,
  Observation,
} from './schemas/observation.js';

/** A candidate without its runner-only fields. */
export function stripCandidate(candidate: Candidate): NavigatorCandidate {
  const { bbox: _bbox, attrs: _attrs, fingerprint: _fingerprint, ...rest } = candidate;
  return rest;
}

/** A copy of `observation` whose candidates carry no bbox, attrs or fingerprint. */
export function stripForNavigator(observation: Observation): NavigatorObservation {
  return { ...observation, candidates: observation.candidates.map(stripCandidate) };
}
