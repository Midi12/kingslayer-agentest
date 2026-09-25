import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtureServer, type FixtureServerHandle } from '../src/index.js';

let handle: FixtureServerHandle;

async function login(base: string, password = 'op-secret-2026'): Promise<string> {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `user=operator&password=${encodeURIComponent(password)}`,
    redirect: 'manual',
  });
  const cookie = res.headers.get('set-cookie');
  expect(cookie).toBeTruthy();
  const value = (cookie ?? '').split(';')[0];
  expect(value).toBeTruthy();
  return value ?? '';
}

beforeEach(async () => {
  handle = await createFixtureServer({ seed: 5, clock: 'frozen' });
});

afterEach(async () => {
  await handle.close();
});

describe('health and auth', () => {
  it('answers healthz without auth', async () => {
    const res = await fetch(`${handle.url}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('redirects a protected page to /login when unauthenticated', async () => {
    const res = await fetch(`${handle.url}/conveyors`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('rejects a bad login and shows the error page', async () => {
    const res = await fetch(`${handle.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'user=operator&password=nope',
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    const location = res.headers.get('location');
    expect(location).toBe('/login?error=1');
    const errorPage = await fetch(`${handle.url}${location ?? ''}`);
    expect(await errorPage.text()).toContain('login-error');
  });

  it('logs in, reaches a protected page, then logs out and loses access', async () => {
    const cookie = await login(handle.url);
    const page = await fetch(`${handle.url}/conveyors`, { headers: { cookie } });
    expect(page.status).toBe(200);
    const logout = await fetch(`${handle.url}/logout`, { headers: { cookie }, redirect: 'manual' });
    expect(logout.status).toBe(303);
    const after = await fetch(`${handle.url}/conveyors`, { headers: { cookie }, redirect: 'manual' });
    expect(after.status).toBe(302);
  });

  it('honours FIXTURE_OPERATOR_PASSWORD overrides', async () => {
    const other = await createFixtureServer({ seed: 1, clock: 'frozen', operatorPassword: 'other-pw' });
    try {
      const bad = await fetch(`${other.url}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'user=operator&password=op-secret-2026',
        redirect: 'manual',
      });
      expect(bad.status).toBe(303);
      expect(bad.headers.get('location')).toContain('error=1');
      const cookie = await login(other.url, 'other-pw');
      const page = await fetch(`${other.url}/conveyors`, { headers: { cookie } });
      expect(page.status).toBe(200);
    } finally {
      await other.close();
    }
  });
});

describe('pages render for every route', () => {
  it('serves all eight pages with 200 once authenticated', async () => {
    const cookie = await login(handle.url);
    for (const path of [
      '/login',
      '/conveyors',
      '/synoptic/svg',
      '/synoptic/canvas',
      '/alarms',
      '/trends',
      '/settings',
      '/modal',
    ]) {
      const res = await fetch(`${handle.url}${path}`, { headers: { cookie } });
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
    }
  });

  it('settings form submits and persists the new values', async () => {
    const cookie = await login(handle.url);
    const res = await fetch(`${handle.url}/settings`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'label=Renamed&threshold=88&mode=manual&notifyOnFault=on&accessCode=xyz',
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    const state = await fetch(`${handle.url}/sim/state`);
    const body = (await state.json()) as { settings: { label: string; threshold: number } };
    expect(body.settings.label).toBe('Renamed');
    expect(body.settings.threshold).toBe(88);
  });

  it('rejects an invalid settings submission', async () => {
    const cookie = await login(handle.url);
    await fetch(`${handle.url}/settings`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'label=&threshold=5',
      redirect: 'manual',
    });
    const state = await fetch(`${handle.url}/sim/state`);
    const body = (await state.json()) as { settings: { label: string } };
    expect(body.settings.label).not.toBe('');
  });
});

describe('the simulator API', () => {
  it('starts and stops a conveyor', async () => {
    const start = await fetch(`${handle.url}/sim/conveyors/C01/start`, { method: 'POST' });
    expect(start.status).toBe(200);
    const stop = await fetch(`${handle.url}/sim/conveyors/C01/stop`, { method: 'POST' });
    expect(stop.status).toBe(200);
  });

  it('404s start/stop for an unknown conveyor', async () => {
    const start = await fetch(`${handle.url}/sim/conveyors/C99/start`, { method: 'POST' });
    expect(start.status).toBe(404);
    const stop = await fetch(`${handle.url}/sim/conveyors/C99/stop`, { method: 'POST' });
    expect(stop.status).toBe(404);
  });

  it('raises a fault with 202, exactly the TestScript http step contract', async () => {
    const res = await fetch(`${handle.url}/sim/conveyors/C07/faults`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'jam' }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { alarmId: string };
    expect(body.alarmId).toMatch(/^alarm-/);
  });

  it('422s an empty fault type and 404s an unknown conveyor', async () => {
    const empty = await fetch(`${handle.url}/sim/conveyors/C01/faults`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: '' }),
    });
    expect(empty.status).toBe(422);
    const unknown = await fetch(`${handle.url}/sim/conveyors/C99/faults`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'jam' }),
    });
    expect(unknown.status).toBe(404);
  });

  it('acknowledges an alarm, then rejects a second ack and an unknown id', async () => {
    const state = await fetch(`${handle.url}/sim/state`);
    const body = (await state.json()) as { alarms: { id: string }[] };
    const firstAlarm = body.alarms[0];
    expect(firstAlarm).toBeDefined();
    const alarmId = firstAlarm?.id ?? '';
    const first = await fetch(`${handle.url}/sim/alarms/${alarmId}/ack`, { method: 'POST' });
    expect(first.status).toBe(200);
    const second = await fetch(`${handle.url}/sim/alarms/${alarmId}/ack`, { method: 'POST' });
    expect(second.status).toBe(409);
    const unknown = await fetch(`${handle.url}/sim/alarms/nope/ack`, { method: 'POST' });
    expect(unknown.status).toBe(404);
  });

  it('resets and reseeds the simulator', async () => {
    await fetch(`${handle.url}/sim/conveyors/C01/start`, { method: 'POST' });
    const reset = await fetch(`${handle.url}/sim/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 999 }),
    });
    expect(reset.status).toBe(200);
    const seed = await fetch(`${handle.url}/sim/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 7 }),
    });
    expect(seed.status).toBe(200);
    expect(await seed.json()).toEqual({ seed: 7 });
    const badSeed = await fetch(`${handle.url}/sim/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(badSeed.status).toBe(422);
  });

  it('rejects a non-integer or negative seed on /sim/seed and /sim/reset (round-3 review)', async () => {
    for (const seed of [1.5, -3, -0.5]) {
      const seedRes = await fetch(`${handle.url}/sim/seed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seed }),
      });
      expect(seedRes.status, `seed ${String(seed)}`).toBe(422);
      const resetRes = await fetch(`${handle.url}/sim/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seed }),
      });
      expect(resetRes.status, `reset seed ${String(seed)}`).toBe(422);
    }
    // A reset with no seed at all still works (keeps the current seed).
    const resetNoSeed = await fetch(`${handle.url}/sim/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resetNoSeed.status).toBe(200);
  });

  it('reads and sets the clock', async () => {
    const get = await fetch(`${handle.url}/sim/state`);
    expect(((await get.json()) as { clockMode: string }).clockMode).toBe('frozen');
    const setReal = await fetch(`${handle.url}/sim/clock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'real' }),
    });
    expect(setReal.status).toBe(200);
    const bad = await fetch(`${handle.url}/sim/clock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'sideways' }),
    });
    expect(bad.status).toBe(422);
    const setFrozenAt = await fetch(`${handle.url}/sim/clock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'frozen', now: 123456 }),
    });
    expect(setFrozenAt.status).toBe(200);
    expect(await setFrozenAt.json()).toEqual({ mode: 'frozen', now: 123456 });
  });

  it('rejects a negative or non-integer "now" on /sim/clock (round-3 review)', async () => {
    for (const now of [-5, 1.5]) {
      const res = await fetch(`${handle.url}/sim/clock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'frozen', now }),
      });
      expect(res.status, `now ${String(now)}`).toBe(422);
    }
  });

  it('rejects an explicit "now" with mode real instead of silently ignoring it', async () => {
    // Round-2 review: `real` mode always reads the wall clock, so a `now` given
    // alongside it used to be accepted and silently dropped.
    const res = await fetch(`${handle.url}/sim/clock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'real', now: 123456 }),
    });
    expect(res.status).toBe(422);
  });

  it('treats a JSON content-type with an empty body as {} instead of 400ing', async () => {
    // Round-2 review: Fastify's default JSON parser rejects an empty body sent with a
    // JSON content-type; a TestScript http step that sets that content type without a
    // body (ack/start/stop take no fields) would hit this.
    const res = await fetch(`${handle.url}/sim/conveyors/C01/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
  });

  it('lists and appends the call log', async () => {
    await fetch(`${handle.url}/sim/conveyors/C02/start`, { method: 'POST' });
    const log = await fetch(`${handle.url}/sim/log`);
    const body = (await log.json()) as { entries: { action: string }[] };
    expect(body.entries.some((entry) => entry.action === 'start')).toBe(true);
  });

  it('lists, toggles and clears faults, rejecting an unknown name', async () => {
    const list = await fetch(`${handle.url}/sim/faults`);
    const body = (await list.json()) as { active: string[]; all: string[] };
    expect(body.all).toHaveLength(14);
    const on = await fetch(`${handle.url}/sim/faults/injection`, { method: 'POST' });
    expect(on.status).toBe(200);
    expect(((await on.json()) as { active: string[] }).active).toContain('injection');
    const off = await fetch(`${handle.url}/sim/faults/injection`, { method: 'DELETE' });
    expect(((await off.json()) as { active: string[] }).active).not.toContain('injection');
    const badOn = await fetch(`${handle.url}/sim/faults/not-a-fault`, { method: 'POST' });
    expect(badOn.status).toBe(404);
    const badOff = await fetch(`${handle.url}/sim/faults/not-a-fault`, { method: 'DELETE' });
    expect(badOff.status).toBe(404);
  });
});

describe('slow-load', () => {
  it('adds real latency to page and API responses, and never to healthz', async () => {
    await fetch(`${handle.url}/sim/faults/slow-load`, { method: 'POST' });
    const healthStart = Date.now();
    await fetch(`${handle.url}/healthz`);
    expect(Date.now() - healthStart).toBeLessThan(500);

    const start = Date.now();
    await fetch(`${handle.url}/login`);
    expect(Date.now() - start).toBeGreaterThanOrEqual(1000);
  });
});

describe('session-expiry', () => {
  it('invalidates sessions that existed when it fired, but a fresh login afterwards still works', async () => {
    const staleCookie = await login(handle.url);
    await fetch(`${handle.url}/sim/faults/session-expiry`, { method: 'POST' });

    const staleAttempt = await fetch(`${handle.url}/conveyors`, {
      headers: { cookie: staleCookie },
      redirect: 'manual',
    });
    expect(staleAttempt.status).toBe(302);
    expect(staleAttempt.headers.get('location')).toBe('/login');

    // A re-login made after the fault fired must still work — the fault expires the
    // sessions that existed when it fired, not "every session, forever".
    const freshCookie = await login(handle.url);
    const freshAttempt = await fetch(`${handle.url}/conveyors`, {
      headers: { cookie: freshCookie },
      redirect: 'manual',
    });
    expect(freshAttempt.status).toBe(200);
  });
});

describe('/sim/log source', () => {
  it('tells a page click apart from a direct API call', async () => {
    // Marked as coming from the page (the fixture's own client script sends this header).
    await fetch(`${handle.url}/sim/conveyors/C03/start`, {
      method: 'POST',
      headers: { 'x-argus-ui': '1' },
    });
    // A plain API call, as a test harness or another module would make it.
    await fetch(`${handle.url}/sim/conveyors/C04/start`, { method: 'POST' });

    const log = (await fetch(`${handle.url}/sim/log`).then((res) => res.json())) as {
      entries: { action: string; source: string; conveyorId: string | null }[];
    };
    const uiEntry = log.entries.find((entry) => entry.action === 'start' && entry.conveyorId === 'C03');
    const apiEntry = log.entries.find((entry) => entry.action === 'start' && entry.conveyorId === 'C04');
    expect(uiEntry?.source).toBe('ui');
    expect(apiEntry?.source).toBe('api');
  });

  it('logs fault toggles, seed/reset and clock changes too, with a sequence that survives a reset', async () => {
    await fetch(`${handle.url}/sim/faults/injection`, { method: 'POST' });
    await fetch(`${handle.url}/sim/clock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'frozen', now: 42 }),
    });
    const beforeReset = (await fetch(`${handle.url}/sim/log`).then((res) => res.json())) as {
      entries: { seq: number; action: string }[];
    };
    expect(beforeReset.entries.some((entry) => entry.action === 'fault-toggle')).toBe(true);
    expect(beforeReset.entries.some((entry) => entry.action === 'clock')).toBe(true);
    const maxSeqBeforeReset = Math.max(...beforeReset.entries.map((entry) => entry.seq));

    await fetch(`${handle.url}/sim/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 5 }),
    });
    const afterReset = (await fetch(`${handle.url}/sim/log`).then((res) => res.json())) as {
      entries: { seq: number; action: string }[];
    };
    expect(afterReset.entries).toHaveLength(1);
    expect(afterReset.entries[0]?.action).toBe('reset');
    // The sequence counter is monotonic over the server's lifetime, not reset to 1 each time.
    expect(afterReset.entries[0]?.seq).toBeGreaterThan(maxSeqBeforeReset);
  });
});

describe('/settings error handling', () => {
  it('redirects with an error flag and shows it, instead of silently dropping an invalid submission', async () => {
    const cookie = await login(handle.url);
    const post = await fetch(`${handle.url}/settings`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'label=&threshold=77',
      redirect: 'manual',
    });
    expect(post.status).toBe(303);
    expect(post.headers.get('location')).toBe('/settings?error=1');

    const page = await fetch(`${handle.url}/settings?error=1`, { headers: { cookie } });
    const html = await page.text();
    expect(html).toContain('data-testid="settings-error"');
  });
});
