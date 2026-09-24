/**
 * M01-G4: `v1` stays additive, the part that needs no git repository. The schemas
 * generated from the registry are compared with the committed snapshot
 * `schemas/baseline/`; fixture pairs prove that every kind of breaking change is
 * detected (removed schema or property, narrowed type or enum, new required property);
 * the committed schema files must be fresh.
 *
 * This file is part of the package's default suite, so it also runs in a clean
 * `git archive` export (M00-G1). The comparisons that read git (the latest `v*` tag and
 * every committed version of the snapshot, gate change M01-1) live in
 * `gate-g4.git.ts`, which `test:gate-g4` runs after this file and which fails outright
 * outside a git work tree (gate change M01-4).
 */
import { recordGateMetrics } from '../../testkit/src/gate-metrics.js';
import { afterAll, describe, expect, it } from 'vitest';
import { diffSchemaSets, type BreakingChange } from '../src/index.js';
import { BASELINE_DIR, staleFiles } from '../scripts/export-schemas.js';
import { currentSchemas } from './support/additive.js';
import { readSchemaDir, schemaDiffCases } from './support/goldens.js';

/** The kinds the spec names: removed field, narrowed type, no new required field; plus removed schemas. */
const REQUIRED_KINDS = [
  'removed-property',
  'narrowed-type',
  'narrowed-enum',
  'new-required',
  'removed-schema',
];

const snapshot = readSchemaDir(BASELINE_DIR);
const current = currentSchemas();
let snapshotBreaking: BreakingChange[] = [];
const cases = schemaDiffCases();
let detected = 0;
let additiveClean = true;
const kindsProven = new Set<string>();
let stale: string[] = [];

describe('M01-G4 additive-only schemas', () => {
  it('finds no breaking change against schemas/baseline', () => {
    expect(snapshot.size).toBeGreaterThan(0);
    snapshotBreaking = diffSchemaSets(snapshot, current);
    expect(snapshotBreaking).toEqual([]);
  });

  it('publishes fresh schema files', () => {
    stale = staleFiles();
    expect(stale).toEqual([]);
  });

  it.each(cases.map((fixture) => [fixture.name, fixture] as const))(
    'fixture pair %s',
    (_name, fixture) => {
      const changes = diffSchemaSets(fixture.before, fixture.after);
      const kinds = [...new Set(changes.map((change) => change.kind))].sort();
      const expected = [...fixture.expectedKinds].sort();
      if (expected.length === 0) {
        if (changes.length > 0) additiveClean = false;
      } else if (JSON.stringify(kinds) === JSON.stringify(expected)) {
        detected++;
        expected.forEach((kind) => kindsProven.add(kind));
      }
      expect(kinds).toEqual(expected);
    },
  );

  it('proves every required kind of breaking change with a fixture pair', () => {
    for (const kind of REQUIRED_KINDS) {
      expect(cases.some((fixture) => fixture.expectedKinds.includes(kind))).toBe(true);
    }
  });
});

afterAll(() => {
  const breakingCases = cases.filter((fixture) => fixture.expectedKinds.length > 0).length;
  recordGateMetrics({
    snapshotSchemasCompared: snapshot.size,
    snapshotBreakingChanges: snapshotBreaking.length,
    snapshotBreakingList: snapshotBreaking
      .slice(0, 20)
      .map((change) => `${change.file}${change.path} ${change.kind}: ${change.detail}`),
    fixtureCases: breakingCases,
    fixtureCasesDetected: detected,
    additiveCasesClean: additiveClean,
    requiredKindsMissing: REQUIRED_KINDS.filter((kind) => !kindsProven.has(kind)).length,
    committedSchemasFresh: stale.length === 0,
  });
});
