/**
 * Evidence files (implementation spec, "Gate runner and evidence"): one per module and
 * run, with the per-gate outcome, the tier summary and a hash over the RFC 8785
 * canonical JSON of the whole document without its `evidenceHash` member.
 */
import { canonicalHash } from './canonical-json.js';
import type { Tier } from './gate-file.js';

export const EVIDENCE_VERSION = 1;

export type GateStatus = 'pass' | 'fail' | 'not_run';

export interface GateResult {
  readonly id: string;
  readonly tier: Tier;
  readonly title: string;
  readonly command: string;
  readonly requires: readonly string[];
  readonly passExpression: string;
  readonly status: GateStatus;
  /** Why the gate failed or did not run; absent on a pass. */
  readonly reason?: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly metrics: unknown;
  readonly missingMetrics: readonly string[];
  readonly expressionErrors: readonly string[];
  readonly pass: boolean;
  /** Log with the last lines of output, relative to the repository root when inside it. */
  readonly log: string | null;
}

export interface NotRunEntry {
  readonly id: string;
  readonly reason: string;
}

export interface Evidence {
  readonly evidenceVersion: number;
  readonly module: string;
  readonly title: string;
  readonly commit: string;
  readonly worktreeClean: boolean | null;
  /** The tier filter of the run, or "all". */
  readonly tier: Tier | 'all';
  readonly strict: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly gates: readonly GateResult[];
  /** True only when every selected gate passed. */
  readonly pass: boolean;
  /** Per tier present in the run: true only when every gate of that tier passed. */
  readonly passByTier: Readonly<Partial<Record<Tier, boolean>>>;
  readonly notRun: readonly NotRunEntry[];
  readonly toolVersions: Readonly<Record<string, string>>;
  /**
   * True when git ignores the log files named by `gates[].log`: they stay on the machine
   * that ran the gates and are not part of the committed evidence. Null when unknown.
   */
  readonly logsGitIgnored: boolean | null;
  readonly evidenceHash: string;
}

export type EvidenceInput = Omit<
  Evidence,
  'pass' | 'passByTier' | 'notRun' | 'evidenceHash' | 'evidenceVersion'
>;

export function passByTier(gates: readonly GateResult[]): Partial<Record<Tier, boolean>> {
  const summary: Partial<Record<Tier, boolean>> = {};
  for (const gate of [...gates].sort((a, b) => a.tier.localeCompare(b.tier))) {
    summary[gate.tier] = (summary[gate.tier] ?? true) && gate.status === 'pass';
  }
  return summary;
}

/** Assembles the evidence document and its hash. */
export function buildEvidence(input: EvidenceInput): Evidence {
  const body: Omit<Evidence, 'evidenceHash'> = {
    evidenceVersion: EVIDENCE_VERSION,
    module: input.module,
    title: input.title,
    commit: input.commit,
    worktreeClean: input.worktreeClean,
    tier: input.tier,
    strict: input.strict,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    gates: input.gates,
    pass: input.gates.length > 0 && input.gates.every((gate) => gate.status === 'pass'),
    passByTier: passByTier(input.gates),
    notRun: input.gates
      .filter((gate) => gate.status === 'not_run')
      .map((gate) => ({ id: gate.id, reason: gate.reason ?? 'not run' })),
    toolVersions: input.toolVersions,
    logsGitIgnored: input.logsGitIgnored,
  };
  return { ...body, evidenceHash: canonicalHash(body) };
}

export interface EvidenceCheck {
  readonly valid: boolean;
  readonly expected: string;
  readonly recorded: string | null;
}

/** Recomputes the hash of an evidence document read back from disk. */
export function verifyEvidenceHash(document: unknown): EvidenceCheck {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return { valid: false, expected: '', recorded: null };
  }
  const { evidenceHash, ...body } = document as Record<string, unknown>;
  const expected = canonicalHash(body);
  const recorded = typeof evidenceHash === 'string' ? evidenceHash : null;
  return { valid: recorded === expected, expected, recorded };
}

/** 1 when any gate failed, or with `strict` when any did not run; 0 otherwise. */
export function exitCodeFor(gates: readonly GateResult[], strict: boolean): 0 | 1 {
  const failed = gates.some((gate) => gate.status === 'fail');
  const notRun = gates.some((gate) => gate.status === 'not_run');
  return failed || (strict && notRun) ? 1 : 0;
}
