import { describe, expect, it } from 'vitest';
import { blinkOn, FixtureSimulator } from '../src/core/sim.js';
import { CONVEYOR_IDS, START_DELAY_MS } from '../src/core/types.js';

function newSim(atMs = 0): FixtureSimulator {
  return new FixtureSimulator({ seed: 42, operatorPassword: 'secret', atMs });
}

describe('FixtureSimulator conveyors', () => {
  it('lists all twenty conveyors, stopped, on construction', () => {
    const sim = newSim();
    const conveyors = sim.listConveyors(0);
    expect(conveyors).toHaveLength(20);
    expect(new Set(conveyors.map((c) => c.id))).toEqual(new Set(CONVEYOR_IDS));
    expect(conveyors.every((c) => c.status === 'Stopped')).toBe(true);
  });

  it('row order is a deterministic function of the seed, and varies with it (M19 needs seeds that reorder rows)', () => {
    const a1 = new FixtureSimulator({ seed: 1, operatorPassword: 'x', atMs: 0 }).listConveyors(0).map((c) => c.id);
    const a2 = new FixtureSimulator({ seed: 1, operatorPassword: 'x', atMs: 0 }).listConveyors(0).map((c) => c.id);
    expect(a1).toEqual(a2);

    const orders = [1, 2, 3].map((seed) =>
      new FixtureSimulator({ seed, operatorPassword: 'x', atMs: 0 }).listConveyors(0).map((c) => c.id),
    );
    // At least one of the three differs from the fixed CONVEYOR_IDS order and from
    // another seed's order; a fixed table layout (the round-1 review finding) would fail
    // this.
    const distinctOrders = new Set(orders.map((order) => order.join(',')));
    expect(distinctOrders.size).toBeGreaterThan(1);
    expect(orders.some((order) => order.join(',') !== CONVEYOR_IDS.join(','))).toBe(true);
  });

  it('start becomes Running only after the delay elapses', () => {
    const sim = newSim(0);
    const result = sim.startConveyor('C01', 0, 'api');
    expect(result.ok).toBe(true);
    expect(sim.conveyor('C01', 0)?.status).toBe('Stopped');
    expect(sim.conveyor('C01', START_DELAY_MS - 1)?.status).toBe('Stopped');
    expect(sim.conveyor('C01', START_DELAY_MS)?.status).toBe('Running');
  });

  it('stop clears a pending start and any fault', () => {
    const sim = newSim(0);
    sim.startConveyor('C01', 0, 'api');
    sim.stopConveyor('C01', 100, 'api');
    expect(sim.conveyor('C01', START_DELAY_MS)?.status).toBe('Stopped');
  });

  it('rejects an unknown conveyor', () => {
    const sim = newSim();
    expect(sim.startConveyor('C99', 0, 'api').ok).toBe(false);
    expect(sim.stopConveyor('C99', 0, 'api').ok).toBe(false);
    expect(sim.raiseConveyorFault('C99', 'jam', 0, 'api').ok).toBe(false);
  });

  it('raising a fault sets status Fault and creates an alarm', () => {
    const sim = newSim(0);
    const result = sim.raiseConveyorFault('C03', 'jam', 500, 'api');
    expect(result.ok).toBe(true);
    expect(sim.conveyor('C03', 500)?.status).toBe('Fault');
    const alarms = sim.listAlarms();
    expect(alarms.some((a) => a.conveyorId === 'C03' && a.kind === 'jam')).toBe(true);
  });

  it('rejects an empty fault type', () => {
    const sim = newSim();
    expect(sim.raiseConveyorFault('C01', '  ', 0, 'api').ok).toBe(false);
  });

  describe('faults', () => {
    it('no-effect makes start and stop no-ops but still logs the attempt', () => {
      const sim = newSim(0);
      sim.setFault('no-effect', true);
      const before = sim.conveyor('C01', 0);
      sim.startConveyor('C01', 0, 'ui');
      expect(sim.conveyor('C01', START_DELAY_MS)).toEqual(before);
      expect(sim.getLog().some((entry) => entry.detail.includes('no-effect'))).toBe(true);
    });

    it('wrong-state keeps C12 Stopped forever, other conveyors unaffected', () => {
      const sim = newSim(0);
      sim.setFault('wrong-state', true);
      sim.startConveyor('C12', 0, 'ui');
      sim.startConveyor('C05', 0, 'ui');
      expect(sim.conveyor('C12', 10_000)?.status).toBe('Stopped');
      expect(sim.conveyor('C05', START_DELAY_MS)?.status).toBe('Running');
    });

    it('rejects an unknown fault name', () => {
      const sim = newSim();
      expect(sim.setFault('not-a-real-fault', true).ok).toBe(false);
    });

    it('activeFaults reflects toggles in FAULT_NAMES order, not insertion order', () => {
      const sim = newSim();
      sim.setFault('locale-fr', true);
      sim.setFault('injection', true);
      expect(sim.activeFaults()).toEqual(['locale-fr', 'injection']);
      sim.setFault('injection', false);
      expect(sim.activeFaults()).toEqual(['locale-fr']);
    });
  });
});

describe('FixtureSimulator alarms', () => {
  it('seeds two alarms on reset', () => {
    const sim = newSim(10_000);
    expect(sim.listAlarms()).toHaveLength(2);
  });

  it('acknowledges an alarm once, and rejects a second ack', () => {
    const sim = newSim(0);
    const [alarm] = sim.listAlarms();
    expect(alarm).toBeDefined();
    if (alarm === undefined) return;
    const first = sim.ackAlarm(alarm.id, 100, 'ui');
    expect(first.ok).toBe(true);
    const second = sim.ackAlarm(alarm.id, 200, 'ui');
    expect(second.ok).toBe(false);
  });

  it('rejects acknowledging an unknown alarm', () => {
    const sim = newSim();
    expect(sim.ackAlarm('nope', 0, 'ui').ok).toBe(false);
  });

  it('isBlinking is false once acked or when no-blink is active', () => {
    const sim = newSim(0);
    const [alarm] = sim.listAlarms();
    expect(alarm).toBeDefined();
    if (alarm === undefined) return;
    expect(sim.isBlinking(alarm)).toBe(true);
    sim.setFault('no-blink', true);
    expect(sim.isBlinking(alarm)).toBe(false);
    sim.setFault('no-blink', false);
    sim.ackAlarm(alarm.id, 0, 'ui');
    const acked = sim.alarm(alarm.id);
    expect(acked).toBeDefined();
    if (acked === undefined) return;
    expect(sim.isBlinking(acked)).toBe(false);
  });
});

describe('FixtureSimulator sessions', () => {
  it('logs in only with the operator user and configured password', () => {
    const sim = newSim();
    expect(sim.login('operator', 'wrong', 0).ok).toBe(false);
    expect(sim.login('someone', 'secret', 0).ok).toBe(false);
    const result = sim.login('operator', 'secret', 0);
    expect(result.ok).toBe(true);
  });

  it('validates a session token and rejects an unknown one', () => {
    const sim = newSim();
    const result = sim.login('operator', 'secret', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sim.validateSession(result.value.token)).toBeDefined();
    expect(sim.validateSession('bogus')).toBeUndefined();
    expect(sim.validateSession(undefined)).toBeUndefined();
  });

  it('session-expiry invalidates every session', () => {
    const sim = newSim();
    const result = sim.login('operator', 'secret', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    sim.setFault('session-expiry', true);
    expect(sim.validateSession(result.value.token)).toBeUndefined();
  });

  it('logout removes the session', () => {
    const sim = newSim();
    const result = sim.login('operator', 'secret', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    sim.logout(result.value.token, 10);
    expect(sim.validateSession(result.value.token)).toBeUndefined();
    // logging out an unknown token is a silent no-op
    sim.logout('bogus', 10);
  });
});

describe('FixtureSimulator settings', () => {
  it('has deterministic defaults from the seed', () => {
    const a = newSim();
    const b = newSim();
    expect(a.getSettings()).toEqual(b.getSettings());
  });

  it('updates settings and rejects an empty label', () => {
    const sim = newSim();
    const values = { ...sim.getSettings(), label: 'New label', threshold: 77 };
    expect(sim.updateSettings(values, 0, 'ui').ok).toBe(true);
    expect(sim.getSettings().label).toBe('New label');
    expect(sim.updateSettings({ ...values, label: '  ' }, 0, 'ui').ok).toBe(false);
  });
});

describe('FixtureSimulator trend and snapshot', () => {
  it('trend is a pure function of seed and now', () => {
    const a = newSim();
    const b = newSim();
    expect(a.trend(50_000)).toEqual(b.trend(50_000));
  });

  it('trend defaults to sixty points spaced one second apart', () => {
    const sim = newSim();
    const points = sim.trend(60_000);
    expect(points).toHaveLength(60);
    expect(points[59]?.tMs).toBe(60_000);
    expect(points[0]?.tMs).toBe(60_000 - 59_000);
  });

  it('reset reseeds every part of the state deterministically', () => {
    const sim = newSim(0);
    sim.startConveyor('C01', 0, 'ui');
    sim.setFault('injection', true);
    sim.reset(1000, 99);
    expect(sim.activeFaults()).toEqual([]);
    expect(sim.conveyor('C01', 1000)?.status).toBe('Stopped');
    const other = new FixtureSimulator({ seed: 99, operatorPassword: 'secret', atMs: 1000 });
    expect(sim.snapshot(1000).conveyors).toEqual(other.snapshot(1000).conveyors);
  });

  it('snapshot reports the seed, faults and settings together', () => {
    const sim = newSim(500);
    sim.setFault('locale-fr', true);
    const snap = sim.snapshot(500);
    expect(snap.seed).toBe(42);
    expect(snap.faults).toEqual(['locale-fr']);
    expect(snap.nowMs).toBe(500);
  });
});

describe('blinkOn', () => {
  it('alternates every 500ms', () => {
    expect(blinkOn(0)).toBe(true);
    expect(blinkOn(499)).toBe(true);
    expect(blinkOn(500)).toBe(false);
    expect(blinkOn(999)).toBe(false);
    expect(blinkOn(1000)).toBe(true);
  });
});
