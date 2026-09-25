/**
 * M07-G1: the decision menu is exactly the matrix. Exhaustive over break reason, strict
 * flag and critical-step flag: `allowedDecisions` equals the transcribed table cell by
 * cell, and the extension rows of ADR M07-decision-matrix likewise.
 */
import { readFileSync } from 'node:fs';
import { ANALYST_DECISIONS, BREAK_REASONS, type AnalystDecisionType } from '@argus/contracts';
import { recordGateMetrics } from '@argus/testkit';
import { describe, expect, it } from 'vitest';
import {
  MATRIX_EXTENSION_REASONS,
  MATRIX_TABLE_REASONS,
  allowedDecisions,
  isEscalable,
} from '../src/index.js';

type Cell = 'yes' | 'no' | 'unless strict';

interface Golden {
  columns: string[];
  table: Record<string, Cell[]>;
  extensions: { rows: Record<string, Cell[]>; notEscalated: string[] };
}

const golden = JSON.parse(
  readFileSync(new URL('./__golden__/decision-matrix.json', import.meta.url), 'utf8'),
) as Golden;

function expected(
  row: readonly Cell[] | undefined,
  strict: boolean,
  critical: boolean,
): AnalystDecisionType[] {
  if (row === undefined) return [];
  const [retry, patch, resolve, markPassed, markFailed, abortEnv] = row;
  const offered: Record<AnalystDecisionType, boolean> = {
    RETRY_STEP: retry === 'yes',
    PATCH: patch === 'yes',
    RESOLVE_TARGET: resolve === 'yes',
    MARK_PASSED: markPassed === 'yes' || (markPassed === 'unless strict' && !strict),
    MARK_FAILED_CONTINUE: markFailed === 'yes' && !critical,
    MARK_FAILED_ABORT: markFailed === 'yes',
    ABORT_ENV: abortEnv === 'yes',
  };
  return ANALYST_DECISIONS.filter((decision) => offered[decision]);
}

describe('M07-G1 decision matrix', () => {
  it('equals the table cell by cell for every reason, strict flag and critical flag', () => {
    expect(golden.columns).toHaveLength(6);
    expect(Object.keys(golden.table).sort()).toEqual([...MATRIX_TABLE_REASONS].sort());
    expect(Object.keys(golden.extensions.rows).sort()).toEqual(
      [...MATRIX_EXTENSION_REASONS].sort(),
    );
    const covered = new Set([
      ...Object.keys(golden.table),
      ...Object.keys(golden.extensions.rows),
      ...golden.extensions.notEscalated,
    ]);
    expect([...covered].sort()).toEqual([...BREAK_REASONS].sort());

    let specCells = 0;
    let specMismatches = 0;
    let cells = 0;
    let mismatches = 0;
    let criticalContinueOffered = 0;
    let strictMarkPassedOffered = 0;
    let menus = 0;
    const mismatchList: string[] = [];
    for (const reason of BREAK_REASONS) {
      const inTable = reason in golden.table;
      const row = golden.table[reason] ?? golden.extensions.rows[reason];
      for (const strict of [false, true]) {
        for (const critical of [false, true]) {
          menus++;
          const actual = allowedDecisions(reason, { strict }, { critical });
          const want = expected(row, strict, critical);
          expect(isEscalable(reason)).toBe(row !== undefined);
          if (critical && actual.includes('MARK_FAILED_CONTINUE')) criticalContinueOffered++;
          if (strict && actual.includes('MARK_PASSED')) strictMarkPassedOffered++;
          for (const decision of ANALYST_DECISIONS) {
            cells++;
            if (inTable) specCells++;
            if (actual.includes(decision) !== want.includes(decision)) {
              mismatches++;
              if (inTable) specMismatches++;
              mismatchList.push(
                `${reason} strict=${String(strict)} critical=${String(critical)} ${decision}`,
              );
            }
          }
          // Canonical order, no duplicates.
          expect(actual).toEqual(ANALYST_DECISIONS.filter((decision) => actual.includes(decision)));
        }
      }
    }
    recordGateMetrics({
      reasons: BREAK_REASONS.length,
      specReasons: MATRIX_TABLE_REASONS.length,
      menus,
      cells,
      specCells,
      cellMismatches: mismatches,
      specCellMismatches: specMismatches,
      criticalContinueOffered,
      strictMarkPassedOffered,
    });
    expect(mismatchList).toEqual([]);
    expect(specCells).toBe(13 * 4 * 7);
    expect(criticalContinueOffered).toBe(0);
    expect(strictMarkPassedOffered).toBe(0);
  });

  it('offers MARK_PASSED only on uncertainty breaks and RESOLVE_TARGET only on ambiguous grounding', () => {
    for (const reason of BREAK_REASONS) {
      const menu = allowedDecisions(reason, { strict: false }, { critical: false });
      if (menu.includes('MARK_PASSED')) {
        expect([
          'EXPECTATION_UNCERTAIN',
          'UNEXPECTED_ERROR_UI',
          'BLOCKING_MODAL',
          'OFF_PATH',
          'NO_EFFECT',
        ]).toContain(reason);
      }
      if (menu.includes('RESOLVE_TARGET')) {
        expect(reason).toBe('GROUNDING_AMBIGUOUS');
      }
    }
  });
});
