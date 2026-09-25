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

/**
 * A deterministic permutation of `CONVEYOR_IDS`, seeded only by `seed` (xorshift32, no
 * `Math.random`). M19's evaluation protocol runs every grounding task under three data
 * seeds "that reorder rows" (`docs/spec/03-implementation-spec.md`, M19 section); this is
 * what gives row order something to vary. Every other seeded default (speeds, the two
 * alarm conveyors, settings) already varied with the seed, but row order did not.
 */
function conveyorRowOrder(seed: number): ConveyorId[] {
  const ids = [...CONVEYOR_IDS];
  let state = (seed ^ 0x9e3779b9) >>> 0;
  if (state === 0) {
    state = 0x9e3779b9;
  }
  const nextUint32 = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = nextUint32() % (i + 1);
    const a = ids[i];
    const b = ids[j];
    if (a !== undefined && b !== undefined) {
      ids[i] = b;
      ids[j] = a;
    }
  }
  return ids;
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
      messageKey: 'jam',
      raisedAtMs: atMs - 4000,
      ackedAtMs: null,
    },
    {
      id: 'alarm-2',
      conveyorId: second,
      kind: 'sensor',
      message: `Sensor fault on ${second}`,
      messageKey: 'sensor',
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
  private rowOrder: ConveyorId[] = [...CONVEYOR_IDS];
  private alarms: Alarm[] = [];
  private faults = new Set<FaultName>();
  private log: LogEntry[] = [];
  private sessions = new Map<string, Session>();
  private settings: SettingsFormValues;
  private nextLogSeq = 1;
  private nextAlarmSeq = 1;
  private nextSessionSeq = 1;
  /**
   * A snapshot of every session token that existed the moment `session-expiry` was last
   * turned on, taken fresh each time it turns on. Only those tokens are treated as
   * expired (and only while the fault stays on), so a login made afterwards — a
   * re-login attempt — still works. A timestamp comparison would have the same intent
   * but breaks under a frozen clock, where "before" and "after" the fault fired can be
   * the same instant; a token snapshot has no such ambiguity (ADR-M02-3 revisited: the
   * fault models "every session that existed when the fault fired", not "every session,
   * forever").
   */
  private sessionExpiryVictims = new Set<string>();

  constructor(options: { readonly seed: number; readonly operatorPassword: string; readonly atMs: number }) {
    this.seed = options.seed;
    this.operatorPassword = options.operatorPassword;
    this.settings = defaultSettings(this.seed);
    this.reset(options.atMs, this.seed);
  }

  /** `source` and `action` describe the call that triggered the reset for the log; `/sim/seed` uses `'seed'`. */
  reset(atMs: number, seed?: number, source: LogSource = 'api', action: 'reset' | 'seed' = 'reset'): void {
    this.seed = seed ?? this.seed;
    this.rowOrder = conveyorRowOrder(this.seed);
    this.conveyors = new Map(initialConveyors(this.seed).map((conveyor) => [conveyor.id, conveyor]));
    this.alarms = initialAlarms(this.seed, atMs);
    this.faults = new Set();
    this.log = [];
    this.sessions = new Map();
    this.settings = defaultSettings(this.seed);
    this.sessionExpiryVictims = new Set();
    this.nextAlarmSeq = this.alarms.length + 1;
    this.nextSessionSeq = 1;
    this.record(atMs, source, action, { detail: `seed=${String(this.seed)}` });
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

  setFault(name: string, on: boolean, atMs = 0, source: LogSource = 'api'): Result<void, SimError> {
    if (!(FAULT_NAMES as readonly string[]).includes(name)) {
      return simErr('UNKNOWN_FAULT', `unknown fault "${name}"`);
    }
    const fault = name as FaultName;
    if (on) {
      this.faults.add(fault);
      if (fault === 'session-expiry') {
        this.sessionExpiryVictims = new Set(this.sessions.keys());
      }
    } else {
      this.faults.delete(fault);
      // The victim set is left as-is: it is only consulted while the fault is active
      // (see validateSession) and rebuilt fresh the next time this turns on.
    }
    this.record(atMs, source, 'fault-toggle', { detail: `${fault}=${String(on)}` });
    return ok(undefined);
  }

  /** Records a state-changing call that has no conveyor/alarm of its own, e.g. `/sim/clock`. */
  logAction(atMs: number, source: LogSource, action: string, detail = ''): void {
    this.record(atMs, source, action, { detail });
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

  /** Row order is `conveyorRowOrder(seed)`, not insertion order: see that function's doc. */
  listConveyors(atMs: number): Conveyor[] {
    return this.rowOrder.map((id) => this.conveyor(id, atMs)).filter(
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
      // `message` stays the English fallback (also what `/sim/*` API responses carry),
      // but `messageKey` lets the alarms page translate this the same way a seeded jam
      // or sensor alarm already does, so `locale-fr` covers API-raised alarms too.
      message: `${type[0]?.toUpperCase() ?? ''}${type.slice(1)} on ${id}`,
      messageKey: type === 'jam' ? 'jam' : 'sensor',
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
    if (token === undefined) {
      return undefined;
    }
    const session = this.sessions.get(token);
    if (session === undefined) {
      return undefined;
    }
    if (this.faults.has('session-expiry') && this.sessionExpiryVictims.has(token)) {
      // Only sessions that already existed when the fault fired are expired; a login
      // made afterwards (a re-login attempt) keeps working.
      return undefined;
    }
    return session;
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
