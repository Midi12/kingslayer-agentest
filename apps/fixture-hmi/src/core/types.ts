/**
 * Pure data types for the fixture simulator (core, no I/O). Time enters only as an
 * explicit millisecond timestamp passed in by the caller; nothing here reads a clock.
 */

/** The twenty conveyor ids, `C01` through `C20`. */
export const CONVEYOR_IDS: readonly string[] = Array.from(
  { length: 20 },
  (_, index) => `C${String(index + 1).padStart(2, '0')}`,
);

export type ConveyorId = string;

export const CONVEYOR_STATUSES = ['Stopped', 'Running', 'Fault'] as const;
export type ConveyorStatus = (typeof CONVEYOR_STATUSES)[number];

export const INDICATOR_COLORS = ['grey', 'green', 'red', 'amber'] as const;
export type IndicatorColor = (typeof INDICATOR_COLORS)[number];

/** The fourteen fault toggles, exactly the names the spec lists. */
export const FAULT_NAMES = [
  'rename-start',
  'move-start',
  'dup-labels',
  'error-toast',
  'slow-load',
  'session-expiry',
  'blocking-modal',
  'no-effect',
  'wrong-state',
  'no-blink',
  'locale-fr',
  'shadow-dom',
  'iframe',
  'injection',
] as const;
export type FaultName = (typeof FAULT_NAMES)[number];

export function isFaultName(value: string): value is FaultName {
  return (FAULT_NAMES as readonly string[]).includes(value);
}

/** The delay, in simulator time, before Start makes a conveyor Running. */
export const START_DELAY_MS = 800;

/** How long an artificial `slow-load` response takes. */
export const SLOW_LOAD_DELAY_MS = 1200;

/** Blink period target: 1 Hz, 500 ms on and 500 ms off. */
export const BLINK_PERIOD_MS = 1000;

export interface Conveyor {
  readonly id: ConveyorId;
  /** The name as stored; `dup-labels` changes what is displayed, not this value. */
  readonly name: string;
  readonly status: ConveyorStatus;
  readonly speed: number;
  /** Set while a Start is pending; the status becomes Running once now() reaches this. */
  readonly pendingRunAtMs: number | null;
  readonly faultType: string | null;
}

export type AlarmKind = 'jam' | 'blocked' | 'overrun' | 'sensor';

export interface Alarm {
  readonly id: string;
  readonly conveyorId: ConveyorId;
  readonly kind: AlarmKind;
  /** English message, used by `/sim/*` API responses and as the fallback when `messageKey` is unset. */
  readonly message: string;
  /**
   * Set only for the two alarms `reset` seeds; the render layer looks up a localized
   * template by this key instead of `message` so `locale-fr` translates them too. Alarms
   * raised through `/sim/conveyors/{id}/faults` carry an arbitrary caller-supplied fault
   * type in `message` and have no key: free text like that cannot be machine-translated.
   */
  readonly messageKey?: 'jam' | 'sensor';
  readonly raisedAtMs: number;
  readonly ackedAtMs: number | null;
}

export type LogSource = 'ui' | 'api';

export interface LogEntry {
  readonly seq: number;
  readonly atMs: number;
  readonly source: LogSource;
  readonly action: string;
  readonly conveyorId: ConveyorId | null;
  readonly alarmId: string | null;
  readonly detail: string;
}

export interface Session {
  readonly token: string;
  readonly user: string;
  readonly createdAtMs: number;
}

export interface SettingsFormValues {
  readonly label: string;
  readonly threshold: number;
  readonly mode: 'auto' | 'manual' | 'maintenance';
  readonly notifyOnFault: boolean;
  readonly accessCode: string;
}

export interface TrendPoint {
  readonly tMs: number;
  readonly value: number;
}

export interface SimSnapshot {
  readonly seed: number;
  readonly nowMs: number;
  readonly conveyors: readonly Conveyor[];
  readonly alarms: readonly Alarm[];
  readonly faults: readonly FaultName[];
  readonly log: readonly LogEntry[];
  readonly settings: SettingsFormValues;
}
