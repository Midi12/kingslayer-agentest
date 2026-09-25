/**
 * Deterministic summarisation of the run ledger for the report (ADR M07-budgets). Each
 * ledger record is one event, shown whole as `{ seq, ts, type, stepId?, data }` on its
 * own line, or dropped whole; every maximal run of dropped events becomes one line
 * `{ "omitted": { fromSeq, toSeq, count, types } }`. Events are dropped by priority
 * class, lowest first, oldest first within a class; class 0 is never dropped.
 */
import type { ReportInput, RunEvent } from '@argus/contracts';

export type EventPriority = 0 | 1 | 2 | 3;

/** 0: the run's outline and its escalations and failures; 3: routine telemetry. */
export function eventPriority(event: RunEvent): EventPriority {
  switch (event.type) {
    case 'run.started':
    case 'run.finished':
    case 'escalation.requested':
    case 'escalation.decided':
      return 0;
    case 'step.finished':
      return event.data.outcome === 'passed' ? 1 : 0;
    case 'step.started':
    case 'handler.fired':
      return 1;
    case 'decision.made':
      return event.data.decision === 'BREAK' ? 1 : 2;
    case 'action.performed':
      return event.data.error === null ? 2 : 1;
    case 'check.evaluated':
      return event.data.outcome === 'pass' ? 2 : 1;
    case 'navigator.ground':
      return 2;
    case 'navigator.verify':
    case 'observation.captured':
    case 'artifact.stored':
    case 'usage.recorded':
      return 3;
  }
}

/** A ledger line as the model reads it: the event without `runId` and `prev`. */
export function ledgerRecord(event: RunEvent): Record<string, unknown> {
  return {
    seq: event.seq,
    ts: event.ts,
    type: event.type,
    ...(event.stepId === undefined ? {} : { stepId: event.stepId }),
    data: event.data,
  };
}

export interface OmittedRun {
  readonly omitted: {
    readonly fromSeq: number;
    readonly toSeq: number;
    readonly count: number;
    readonly types: Readonly<Record<string, number>>;
  };
}

/** Events in seq order (stable for equal seq). */
export function orderedEvents(events: readonly RunEvent[]): RunEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.seq - b.event.seq || a.index - b.index)
    .map(({ event }) => event);
}

/** Positions (into `ordered`) of the droppable events per class, oldest first. */
export interface DropClasses {
  readonly telemetry: readonly number[];
  readonly detail: readonly number[];
  readonly steps: readonly number[];
}

/** Class 3 (telemetry), class 2 (detail) and class 1 (steps); class 0 is never dropped. */
export function eventDropClasses(ordered: readonly RunEvent[]): DropClasses {
  const telemetry: number[] = [];
  const detail: number[] = [];
  const steps: number[] = [];
  ordered.forEach((event, position) => {
    const priority = eventPriority(event);
    if (priority === 3) telemetry.push(position);
    else if (priority === 2) detail.push(position);
    else if (priority === 1) steps.push(position);
  });
  return { telemetry, detail, steps };
}

/** The ledger lines with the events at `dropped` positions summarised. */
export function ledgerLines(
  ordered: readonly RunEvent[],
  dropped: ReadonlySet<number>,
): (Record<string, unknown> | OmittedRun)[] {
  const lines: (Record<string, unknown> | OmittedRun)[] = [];
  let run: RunEvent[] = [];
  const flush = (): void => {
    const first = run[0];
    const last = run[run.length - 1];
    if (first === undefined || last === undefined) return;
    const types: Record<string, number> = {};
    for (const event of run) types[event.type] = (types[event.type] ?? 0) + 1;
    const sorted = Object.fromEntries(Object.entries(types).sort(([a], [b]) => (a < b ? -1 : 1)));
    lines.push({
      omitted: { fromSeq: first.seq, toSeq: last.seq, count: run.length, types: sorted },
    });
    run = [];
  };
  ordered.forEach((event, position) => {
    if (dropped.has(position)) {
      run.push(event);
    } else {
      flush();
      lines.push(ledgerRecord(event));
    }
  });
  flush();
  return lines;
}

/**
 * The events of a report input with their precise type. `ReportInput.events` is the
 * static type of the TypeBox union, which TypeScript cannot narrow by `type`; the
 * values are the same once the input has been validated.
 */
export function ledgerEvents(input: ReportInput): readonly RunEvent[] {
  return input.events as unknown as readonly RunEvent[];
}
