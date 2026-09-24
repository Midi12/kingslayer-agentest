/**
 * The fixture simulator: one seeded in-memory model for conveyors, alarms, trends,
 * faults and sessions. Every method that cares about time takes `atMs` explicitly from
 * the caller (the `Clock` port, wired only in adapters) so the core never reads a clock
 * or `Math.random` itself, and the same call sequence with the same timestamps always
 * gives the same state.
 */
import { err, ok, type Result } from '@argus/contracts';
import {
  BLINK_PERIOD_MS,
  CONVEYOR_IDS,
  FAULT_NAMES,
  START_DELAY_MS,
  type Alarm,
  type AlarmKind,
  type Conveyor,
  type ConveyorId,
  type FaultName,
  type LogEntry,
  type LogSource,
  type Session,
  type SettingsFormValues,
  type SimSnapshot,
  type TrendPoint,
} from './types.js';

export type SimErrorCode =
  | 'UNKNOWN_CONVEYOR'
  | 'UNKNOWN_ALARM'
  | 'ALREADY_ACKED'
  | 'INVALID_CREDENTIALS'
  | 'UNKNOWN_FAULT'
  | 'INVALID_FAULT_TYPE'
  | 'INVALID_SETTINGS';

export interface SimError {
  readonly code: SimErrorCode;
  readonly message: string;
}

function simErr(code: SimErrorCode, message: string): Result<never, SimError> {
  return err({ code, message });
}

/** `50 + 30 * sin(...)`, a deterministic per-conveyor speed derived from the seed only. */
function baseSpeed(seed: number, index: number): number {
  const phase = (seed % 97) + index * 13;
  return Math.round((0.6 + 0.35 * Math.sin(phase / 7)) * 100) / 100;
}

function initialConveyors(seed: number): Conveyor[] {
  return CONVEYOR_IDS.map((id, index) => ({
    id,
    name: `Conveyor ${id}`,
    status: 'Stopped',
    speed: baseSpeed(seed, index),
    pendingRunAtMs: null,
    faultType: null,
  }));
}

/** Two alarms raised at reset so `/alarms` always has content to acknowledge. */
function initialAlarms(seed: number, atMs: number): Alarm[] {
  const first = CONVEYOR_IDS[(seed % 7) + 3] ?? 'C05';
  const second = CONVEYOR_IDS[(seed % 5) + 9] ?? 'C11';
  return [
    {
      id: 'alarm-1',
      conveyorId: first,
      kind: 'jam',
      message: `Jam detected on ${first}`,
      raisedAtMs: atMs - 4000,
      ackedAtMs: null,
    },
    {
      id: 'alarm-2',
      conveyorId: second,
      kind: 'sensor',
      message: `Sensor fault on ${second}`,
      raisedAtMs: atMs - 2000,
      ackedAtMs: null,
    },
  ];
}

function defaultSettings(seed: number): SettingsFormValues {
  return {
    label: `Line ${(seed % 9) + 1}`,
    threshold: 40 + (seed % 40),
    mode: 'auto',
    notifyOnFault: true,
    accessCode: '',
  };
}

/** Whether an unacknowledged alarm is in the "on" half of the 1 Hz square wave at `atMs`. */
export function blinkOn(atMs: number): boolean {
  return Math.floor(atMs / (BLINK_PERIOD_MS / 2)) % 2 === 0;
}

export class FixtureSimulator {
  private seed: number;
  private readonly operatorPassword: string;
  private conveyors = new Map<ConveyorId, Conveyor>();
  private alarms: Alarm[] = [];
  private faults = new Set<FaultName>();
  private log: LogEntry[] = [];
  private sessions = new Map<string, Session>();
  private settings: SettingsFormValues;
  private nextLogSeq = 1;
  private nextAlarmSeq = 1;
  private nextSessionSeq = 1;

  constructor(options: { readonly seed: number; readonly operatorPassword: string; readonly atMs: number }) {
    this.seed = options.seed;
    this.operatorPassword = options.operatorPassword;
    this.settings = defaultSettings(this.seed);
    this.reset(options.atMs, this.seed);
  }

  reset(atMs: number, seed?: number): void {
    this.seed = seed ?? this.seed;
    this.conveyors = new Map(initialConveyors(this.seed).map((conveyor) => [conveyor.id, conveyor]));
    this.alarms = initialAlarms(this.seed, atMs);
    this.faults = new Set();
    this.log = [];
    this.sessions = new Map();
    this.settings = defaultSettings(this.seed);
    this.nextLogSeq = 1;
    this.nextAlarmSeq = this.alarms.length + 1;
    this.nextSessionSeq = 1;
  }

  private record(atMs: number, source: LogSource, action: string, extra: Partial<Omit<LogEntry, 'seq' | 'atMs' | 'source' | 'action'>> = {}): void {
    this.log.push({
      seq: this.nextLogSeq++,
      atMs,
      source,
      action,
      conveyorId: extra.conveyorId ?? null,
      alarmId: extra.alarmId ?? null,
      detail: extra.detail ?? '',
    });
  }

  // ---------------------------------------------------------------------
  // Faults
  // ---------------------------------------------------------------------

  activeFaults(): FaultName[] {
    return FAULT_NAMES.filter((name) => this.faults.has(name));
  }

  hasFault(name: FaultName): boolean {
    return this.faults.has(name);
  }

  setFault(name: string, on: boolean): Result<void, SimError> {
    if (!(FAULT_NAMES as readonly string[]).includes(name)) {
      return simErr('UNKNOWN_FAULT', `unknown fault "${name}"`);
    }
    const fault = name as FaultName;
    if (on) {
      this.faults.add(fault);
    } else {
      this.faults.delete(fault);
    }
    return ok(undefined);
  }

  // ---------------------------------------------------------------------
  // Conveyors
  // ---------------------------------------------------------------------

  private resolved(conveyor: Conveyor, atMs: number): Conveyor {
    if (this.faults.has('wrong-state') && conveyor.id === 'C12') {
      return { ...conveyor, status: 'Stopped', pendingRunAtMs: null };
    }
    if (conveyor.pendingRunAtMs !== null && atMs >= conveyor.pendingRunAtMs) {
      return { ...conveyor, status: 'Running', pendingRunAtMs: null };
    }
    return conveyor;
  }

  conveyor(id: string, atMs: number): Conveyor | undefined {
    const found = this.conveyors.get(id);
    return found === undefined ? undefined : this.resolved(found, atMs);
  }

  listConveyors(atMs: number): Conveyor[] {
    return CONVEYOR_IDS.map((id) => this.conveyor(id, atMs)).filter(
      (conveyor): conveyor is Conveyor => conveyor !== undefined,
    );
  }

  startConveyor(id: string, atMs: number, source: LogSource): Result<void, SimError> {
    const current = this.conveyors.get(id);
    if (current === undefined) {
      return simErr('UNKNOWN_CONVEYOR', `unknown conveyor "${id}"`);
    }
    if (this.faults.has('no-effect')) {
      this.record(atMs, source, 'start', { conveyorId: id, detail: 'ignored: no-effect fault active' });
      return ok(undefined);
    }
    this.conveyors.set(id, {
      ...current,
      status: 'Stopped',
      faultType: null,
      pendingRunAtMs: atMs + START_DELAY_MS,
    });
    this.record(atMs, source, 'start', { conveyorId: id });
    return ok(undefined);
  }

  stopConveyor(id: string, atMs: number, source: LogSource): Result<void, SimError> {
    const current = this.conveyors.get(id);
    if (current === undefined) {
      return simErr('UNKNOWN_CONVEYOR', `unknown conveyor "${id}"`);
    }
    if (this.faults.has('no-effect')) {
      this.record(atMs, source, 'stop', { conveyorId: id, detail: 'ignored: no-effect fault active' });
      return ok(undefined);
    }
    this.conveyors.set(id, { ...current, status: 'Stopped', pendingRunAtMs: null, faultType: null });
    this.record(atMs, source, 'stop', { conveyorId: id });
    return ok(undefined);
  }

  raiseConveyorFault(id: string, type: string, atMs: number, source: LogSource): Result<{ alarmId: string }, SimError> {
    const current = this.conveyors.get(id);
    if (current === undefined) {
      return simErr('UNKNOWN_CONVEYOR', `unknown conveyor "${id}"`);
    }
    if (type.trim() === '') {
      return simErr('INVALID_FAULT_TYPE', 'fault type must be non-empty');
    }
    this.conveyors.set(id, { ...current, status: 'Fault', pendingRunAtMs: null, faultType: type });
    const alarmId = `alarm-${this.nextAlarmSeq++}`;
    const kind: AlarmKind = type === 'jam' ? 'jam' : 'sensor';
    this.alarms.push({
      id: alarmId,
      conveyorId: id,
      kind,
      message: `${type[0]?.toUpperCase() ?? ''}${type.slice(1)} on ${id}`,
      raisedAtMs: atMs,
      ackedAtMs: null,
    });
    this.record(atMs, source, 'fault', { conveyorId: id, alarmId, detail: type });
    return ok({ alarmId });
  }

  // ---------------------------------------------------------------------
  // Alarms
  // ---------------------------------------------------------------------

  listAlarms(): Alarm[] {
    return [...this.alarms];
  }

  alarm(id: string): Alarm | undefined {
    return this.alarms.find((candidate) => candidate.id === id);
  }

  ackAlarm(id: string, atMs: number, source: LogSource): Result<void, SimError> {
    const index = this.alarms.findIndex((candidate) => candidate.id === id);
    if (index === -1) {
      return simErr('UNKNOWN_ALARM', `unknown alarm "${id}"`);
    }
    const alarm = this.alarms[index];
    if (alarm === undefined) {
      return simErr('UNKNOWN_ALARM', `unknown alarm "${id}"`);
    }
    if (alarm.ackedAtMs !== null) {
      return simErr('ALREADY_ACKED', `alarm "${id}" is already acknowledged`);
    }
    this.alarms[index] = { ...alarm, ackedAtMs: atMs };
    this.record(atMs, source, 'ack', { conveyorId: alarm.conveyorId, alarmId: id });
    return ok(undefined);
  }

  isBlinking(alarm: Alarm): boolean {
    return alarm.ackedAtMs === null && !this.faults.has('no-blink');
  }

  // ---------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------

  login(user: string, password: string, atMs: number): Result<{ token: string }, SimError> {
    if (user !== 'operator' || password !== this.operatorPassword) {
      return simErr('INVALID_CREDENTIALS', 'invalid user or password');
    }
    const token = `sess-${this.seed}-${this.nextSessionSeq++}`;
    this.sessions.set(token, { token, user, createdAtMs: atMs });
    this.record(atMs, 'ui', 'login', { detail: user });
    return ok({ token });
  }

  logout(token: string, atMs: number): void {
    if (this.sessions.delete(token)) {
      this.record(atMs, 'ui', 'logout');
    }
  }

  validateSession(token: string | undefined): Session | undefined {
    if (token === undefined || this.faults.has('session-expiry')) {
      return undefined;
    }
    return this.sessions.get(token);
  }

  // ---------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------

  getSettings(): SettingsFormValues {
    return this.settings;
  }

  updateSettings(values: SettingsFormValues, atMs: number, source: LogSource): Result<void, SimError> {
    if (values.label.trim() === '' || !Number.isFinite(values.threshold)) {
      return simErr('INVALID_SETTINGS', 'label and threshold are required');
    }
    this.settings = values;
    this.record(atMs, source, 'settings', {});
    return ok(undefined);
  }

  // ---------------------------------------------------------------------
  // Trends: a pure function of the seed and the current time only.
  // ---------------------------------------------------------------------

  trend(atMs: number, points = 60, stepMs = 1000): TrendPoint[] {
    return Array.from({ length: points }, (_, index) => {
      const tMs = atMs - (points - 1 - index) * stepMs;
      const value =
        50 + 15 * Math.sin((2 * Math.PI * (tMs / 1000 + this.seed)) / 12) + (this.seed % 5);
      return { tMs, value: Math.round(value * 100) / 100 };
    });
  }

  // ---------------------------------------------------------------------
  // Introspection
  // ---------------------------------------------------------------------

  getLog(): LogEntry[] {
    return [...this.log];
  }

  snapshot(atMs: number): SimSnapshot {
    return {
      seed: this.seed,
      nowMs: atMs,
      conveyors: this.listConveyors(atMs),
      alarms: this.listAlarms(),
      faults: this.activeFaults(),
      log: this.getLog(),
      settings: this.getSettings(),
    };
  }
}
