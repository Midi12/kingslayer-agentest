import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FAKE_CLOCK_EPOCH,
  FakeClock,
  InMemoryEventBus,
  InMemoryMailer,
  InMemoryObjectStore,
  InMemoryPayments,
  InMemoryQueue,
  LEASE_TTL_MS,
  SeqIdGenerator,
  hmacSha256Hex,
  serveObjectStore,
  signWebhook,
} from '../src/index.js';

describe('FakeClock', () => {
  it('starts at the fixed epoch or a given time and moves only when told', async () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(FAKE_CLOCK_EPOCH);
    expect(clock.iso()).toBe('2026-01-01T00:00:00.000Z');
    expect(new FakeClock('2026-09-24T10:00:00Z').now()).toBe(Date.parse('2026-09-24T10:00:00Z'));
    expect(() => new FakeClock('not a date')).toThrow(RangeError);
    await clock.advance(1500);
    expect(clock.now()).toBe(FAKE_CLOCK_EPOCH + 1500);
    await expect(clock.advance(-1)).rejects.toThrow(RangeError);
    await expect(clock.set(0)).rejects.toThrow(RangeError);
    await clock.set('2026-01-02T00:00:00Z');
    expect(clock.iso()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('resolves sleeps in due order, each seeing its own due time', async () => {
    const clock = new FakeClock(0);
    const seen: [string, number][] = [];
    const a = clock.sleep(300).then(() => seen.push(['a', clock.now()]));
    const b = clock.sleep(100).then(() => seen.push(['b', clock.now()]));
    const c = clock.sleep(100).then(() => seen.push(['c', clock.now()]));
    expect(clock.pendingSleeps).toBe(3);
    expect(clock.nextDue()).toBe(100);
    await clock.advance(200);
    expect(seen).toEqual([
      ['b', 100],
      ['c', 100],
    ]);
    expect(clock.now()).toBe(200);
    await clock.runAll();
    await Promise.all([a, b, c]);
    expect(seen.at(-1)).toEqual(['a', 300]);
    expect(clock.nextDue()).toBeUndefined();
    await clock.sleep(0);
    await clock.sleep(-5);
  });

  it('rejects an aborted sleep and forgets it', async () => {
    const clock = new FakeClock(0);
    const controller = new AbortController();
    const sleep = clock.sleep(1000, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(sleep).rejects.toThrow('cancelled');
    expect(clock.pendingSleeps).toBe(0);
    await expect(clock.sleep(10, controller.signal)).rejects.toThrow('cancelled');
    const done = clock.sleep(10, new AbortController().signal);
    await clock.advance(10);
    await expect(done).resolves.toBeUndefined();
  });
});

describe('SeqIdGenerator', () => {
  it('counts per prefix with four digits by default', () => {
    const ids = new SeqIdGenerator();
    expect([ids.next('run'), ids.next('run'), ids.next('step')]).toEqual([
      'run_0001',
      'run_0002',
      'step_0001',
    ]);
    expect(ids.issued('run')).toBe(2);
    ids.reset();
    expect(ids.next('run')).toBe('run_0001');
  });

  it('can share one counter, change the width and the start', () => {
    const ids = new SeqIdGenerator({ shared: true, width: 2, start: 0 });
    expect([ids.next('a'), ids.next('b')]).toEqual(['a_00', 'b_01']);
    expect(ids.issued()).toBe(2);
    expect(() => new SeqIdGenerator({ width: 0 })).toThrow(RangeError);
    expect(() => new SeqIdGenerator({ start: -1 })).toThrow(RangeError);
  });
});

describe('InMemoryQueue', () => {
  function setup() {
    const clock = new FakeClock(0);
    const queue = new InMemoryQueue({ clock, ids: new SeqIdGenerator() });
    return { clock, queue };
  }
  const runner = { runnerId: 'runner_1', runnerOrgId: null, labels: ['linux', 'gpu'] };

  it('leases matching jobs first in, renews on heartbeat and completes', async () => {
    const { clock, queue } = setup();
    expect((await queue.enqueue({ runId: 'r1', orgId: 'o1', labels: ['linux'] })).ok).toBe(true);
    await queue.enqueue({ runId: 'r2', orgId: 'o2', labels: ['windows'] });
    expect(await queue.enqueue({ runId: 'r1', orgId: 'o1', labels: [] })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    const leased = await queue.lease(runner);
    expect(leased).toMatchObject({
      ok: true,
      value: {
        leaseId: 'lease_0001',
        job: { runId: 'r1', attempts: 1 },
        expiresAt: new Date(LEASE_TTL_MS).toISOString(),
      },
    });
    expect(await queue.lease(runner)).toEqual({ ok: true, value: null });
    await clock.advance(10_000);
    expect(await queue.heartbeat('lease_0001')).toEqual({
      ok: true,
      value: { expiresAt: new Date(10_000 + LEASE_TTL_MS).toISOString(), cancelRequested: false },
    });
    expect(await queue.heartbeat('nope')).toEqual({ ok: false, error: { code: 'not_found' } });
    expect((await queue.complete('lease_0001')).ok).toBe(true);
    expect(queue.snapshot().map((entry) => entry.job.runId)).toEqual(['r2']);
  });

  it('matches self-hosted runners to their org only', async () => {
    const { queue } = setup();
    await queue.enqueue({ runId: 'r1', orgId: 'o1', labels: [] });
    expect(await queue.lease({ runnerId: 'x', runnerOrgId: 'o2', labels: [] })).toEqual({
      ok: true,
      value: null,
    });
    expect((await queue.lease({ runnerId: 'y', runnerOrgId: 'o1', labels: [] })).ok).toBe(true);
  });

  it('expires stale leases: re-queued twice, then lost; expired leases refuse calls', async () => {
    const { clock, queue } = setup();
    await queue.enqueue({ runId: 'r1', orgId: 'o1', labels: [] });
    const results: unknown[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const lease = await queue.lease(runner);
      expect(lease.ok && lease.value?.job.attempts).toBe(attempt);
      await clock.advance(LEASE_TTL_MS + 1);
      if (lease.ok && lease.value !== null) {
        expect(await queue.heartbeat(lease.value.leaseId)).toEqual({
          ok: false,
          error: { code: 'lease_expired' },
        });
      }
      results.push(await queue.expireStale(clock.iso()));
    }
    expect(results).toEqual([
      { ok: true, value: { requeued: ['r1'], lost: [] } },
      { ok: true, value: { requeued: ['r1'], lost: [] } },
      { ok: true, value: { requeued: [], lost: ['r1'] } },
    ]);
    expect(await queue.expireStale('yesterday')).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
  });

  it('releases without counting an attempt, and cancels queued or leased runs', async () => {
    const { clock, queue } = setup();
    await queue.enqueue({ runId: 'r1', orgId: 'o1', labels: [] });
    await queue.enqueue({ runId: 'r2', orgId: 'o1', labels: [] });
    const lease = await queue.lease(runner);
    const leaseId = lease.ok ? (lease.value?.leaseId ?? '') : '';
    expect((await queue.release(leaseId)).ok).toBe(true);
    expect(queue.snapshot()[0]).toMatchObject({ job: { attempts: 0 }, leaseId: null });
    const again = await queue.lease(runner);
    const againId = again.ok ? (again.value?.leaseId ?? '') : '';
    expect((await queue.cancel('r1')).ok).toBe(true);
    expect(await queue.heartbeat(againId)).toMatchObject({
      ok: true,
      value: { cancelRequested: true },
    });
    expect((await queue.cancel('r2')).ok).toBe(true);
    expect(await queue.cancel('r3')).toEqual({ ok: false, error: { code: 'not_found' } });
    await clock.advance(LEASE_TTL_MS + 1);
    expect(await queue.expireStale(clock.iso())).toEqual({
      ok: true,
      value: { requeued: [], lost: [] },
    });
    expect(await queue.complete(againId)).toEqual({ ok: false, error: { code: 'not_found' } });
    expect(await queue.release(againId)).toEqual({ ok: false, error: { code: 'not_found' } });
  });

  it('answers unavailable on every call while down', async () => {
    const { queue } = setup();
    queue.setUnavailable('db down');
    const down = { ok: false, error: { code: 'unavailable', message: 'db down' } };
    expect(await queue.enqueue({ runId: 'r', orgId: 'o', labels: [] })).toEqual(down);
    expect(await queue.lease(runner)).toEqual(down);
    expect(await queue.heartbeat('l')).toEqual(down);
    expect(await queue.complete('l')).toEqual(down);
    expect(await queue.release('l')).toEqual(down);
    expect(await queue.cancel('r')).toEqual(down);
    expect(await queue.expireStale('2026-01-01T00:00:00Z')).toEqual(down);
    queue.setUnavailable(undefined);
    expect((await queue.lease(runner)).ok).toBe(true);
  });
});

describe('InMemoryEventBus', () => {
  it('delivers to subscribers of the channel, logs messages, and unsubscribes', async () => {
    const bus = new InMemoryEventBus();
    const got: string[] = [];
    const off = await bus.subscribe('run:1', (payload) => got.push(payload));
    await bus.subscribe('run:2', () => got.push('wrong'));
    expect(bus.subscriberCount('run:1')).toBe(1);
    expect((await bus.publish('run:1', 'a')).ok).toBe(true);
    await off();
    await bus.publish('run:1', 'b');
    expect(got).toEqual(['a']);
    expect(bus.published).toEqual([
      { channel: 'run:1', payload: 'a' },
      { channel: 'run:1', payload: 'b' },
    ]);
    expect(bus.subscriberCount('none')).toBe(0);
    bus.setUnavailable('down');
    expect(await bus.publish('run:1', 'c')).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'down' },
    });
  });
});

describe('InMemoryMailer', () => {
  it('sends once per idempotency key, validates recipients and fails on demand', async () => {
    const mailer = new InMemoryMailer(new SeqIdGenerator());
    const message = {
      to: ['qa@example.com'],
      subject: 'Run failed',
      text: 'details',
      idempotencyKey: 'k1',
    };
    expect(await mailer.send(message)).toEqual({ ok: true, value: { messageId: 'mail_0001' } });
    expect(await mailer.send(message)).toEqual({ ok: true, value: { messageId: 'mail_0001' } });
    expect(mailer.outbox).toHaveLength(1);
    expect(await mailer.send({ ...message, to: [], idempotencyKey: 'k2' })).toMatchObject({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(
      await mailer.send({ ...message, to: ['not-an-address'], idempotencyKey: 'k3' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'rejected', message: 'invalid recipient not-an-address' },
    });
    mailer.failNext({ code: 'unavailable', message: 'smtp down' });
    expect(await mailer.send({ ...message, idempotencyKey: 'k4' })).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'smtp down' },
    });
  });
});

describe('hmacSha256Hex', () => {
  it('matches node:crypto for short, block-sized and long keys', () => {
    for (const key of ['k', 'x'.repeat(64), 'y'.repeat(100)]) {
      for (const message of ['', 'hello', 'z'.repeat(300)]) {
        expect(hmacSha256Hex(key, message)).toBe(
          createHmac('sha256', key).update(message).digest('hex'),
        );
      }
    }
    expect(hmacSha256Hex(new Uint8Array([1, 2]), new Uint8Array([3]))).toBe(
      createHmac('sha256', Buffer.from([1, 2]))
        .update(Buffer.from([3]))
        .digest('hex'),
    );
  });
});

describe('InMemoryPayments', () => {
  function setup() {
    const clock = new FakeClock('2026-09-24T12:00:00Z');
    return { clock, payments: new InMemoryPayments({ clock, ids: new SeqIdGenerator() }) };
  }
  const checkout = {
    orgId: 'o1',
    customerId: null,
    packId: 'pack-100',
    successUrl: 'https://a/s',
    cancelUrl: 'https://a/c',
    idempotencyKey: 'c1',
  };
  const charge = {
    customerId: 'cus_1',
    amountMinor: 5000,
    currency: 'eur' as const,
    description: 'top-up',
    idempotencyKey: 'ch1',
  };

  it('creates idempotent checkout sessions and portal links', async () => {
    const { payments } = setup();
    const first = await payments.createCheckoutSession(checkout);
    expect(first).toEqual({
      ok: true,
      value: { sessionId: 'cs_fake_0001', url: 'https://checkout.payments.invalid/cs_fake_0001' },
    });
    expect(await payments.createCheckoutSession(checkout)).toEqual(first);
    expect(payments.checkouts).toHaveLength(1);
    expect(
      await payments.createPortalSession({ customerId: 'cus 1', returnUrl: 'https://a' }),
    ).toEqual({
      ok: true,
      value: { url: 'https://billing.payments.invalid/cus%201' },
    });
  });

  it('charges off-session with queued outcomes, idempotently', async () => {
    const { payments } = setup();
    payments.queueCharges('requires_action', { code: 'declined', message: 'insufficient funds' });
    expect(await payments.chargeOffSession(charge)).toEqual({
      ok: true,
      value: { paymentId: 'pi_fake_0001', status: 'requires_action' },
    });
    expect(await payments.chargeOffSession(charge)).toEqual({
      ok: true,
      value: { paymentId: 'pi_fake_0001', status: 'requires_action' },
    });
    expect(await payments.chargeOffSession({ ...charge, idempotencyKey: 'ch2' })).toEqual({
      ok: false,
      error: { code: 'declined', message: 'insufficient funds' },
    });
    expect(await payments.chargeOffSession({ ...charge, idempotencyKey: 'ch3' })).toMatchObject({
      ok: true,
      value: { status: 'succeeded' },
    });
    expect(
      await payments.chargeOffSession({ ...charge, amountMinor: 0, idempotencyKey: 'ch4' }),
    ).toMatchObject({ ok: false, error: { code: 'declined' } });
    expect(payments.charges.map((entry) => entry.status)).toEqual(['requires_action', 'succeeded']);
  });

  it('verifies webhook signatures, their age and their body', async () => {
    const { clock, payments } = setup();
    const { body, signature } = payments.webhook({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { pack: 'p' },
    });
    expect(payments.verifyWebhook(body, signature)).toEqual({
      ok: true,
      value: {
        id: 'evt_1',
        type: 'checkout.session.completed',
        createdAt: '2026-09-24T12:00:00.000Z',
        data: { pack: 'p' },
      },
    });
    const invalid = { ok: false, error: { code: 'invalid_signature' } };
    expect(payments.verifyWebhook(`${body} `, signature)).toEqual(invalid);
    expect(payments.verifyWebhook(body, 'garbage')).toEqual(invalid);
    expect(payments.verifyWebhook(body, `${signature},v1=other`)).toMatchObject({ ok: true });
    const t = Math.floor(clock.now() / 1000);
    expect(
      payments.verifyWebhook('not json', signWebhook('not json', 'whsec_fake_argus_testkit', t)),
    ).toEqual(invalid);
    expect(
      payments.verifyWebhook('{"id":1}', signWebhook('{"id":1}', 'whsec_fake_argus_testkit', t)),
    ).toEqual(invalid);
    await clock.advance(301_000);
    expect(payments.verifyWebhook(body, signature)).toEqual(invalid);
  });

  it('answers unavailable while down', async () => {
    const { payments } = setup();
    payments.setUnavailable('stripe down');
    const down = { ok: false, error: { code: 'unavailable', message: 'stripe down' } };
    expect(await payments.createCheckoutSession(checkout)).toEqual(down);
    expect(await payments.createPortalSession({ customerId: 'c', returnUrl: 'r' })).toEqual(down);
    expect(await payments.chargeOffSession(charge)).toEqual(down);
  });
});

describe('InMemoryObjectStore', () => {
  it('stores, lists by prefix with cursors, heads and deletes', async () => {
    const store = new InMemoryObjectStore({ clock: new FakeClock(0), pageSize: 2 });
    const bytes = new TextEncoder().encode('hello');
    expect(await store.put('runs/r1/a.png', bytes, 'image/png')).toEqual({
      ok: true,
      value: {
        bytes: 5,
        sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      },
    });
    await store.put('runs/r1/b.png', bytes, 'image/png');
    await store.put('runs/r1/c.png', bytes, 'image/png');
    await store.put('other/x', bytes, 'text/plain');
    const page = await store.list('runs/');
    expect(page).toMatchObject({ ok: true, value: { nextCursor: 'runs/r1/b.png' } });
    const next = await store.list('runs/', 'runs/r1/b.png');
    expect(next).toMatchObject({
      ok: true,
      value: { objects: [{ key: 'runs/r1/c.png' }], nextCursor: null },
    });
    expect(await store.head('other/x')).toEqual({
      ok: true,
      value: {
        key: 'other/x',
        bytes: 5,
        contentType: 'text/plain',
        lastModified: '1970-01-01T00:00:00.000Z',
      },
    });
    expect(await store.head('missing')).toEqual({ ok: true, value: null });
    expect(await store.get('missing')).toEqual({
      ok: false,
      error: { code: 'not_found', key: 'missing' },
    });
    expect(await store.delete(['other/x', 'missing'])).toEqual({ ok: true, value: { deleted: 1 } });
    expect(store.keys()).toEqual(['runs/r1/a.png', 'runs/r1/b.png', 'runs/r1/c.png']);
  });

  it('answers unavailable while down, and refuses to pre-sign without its server', async () => {
    const store = new InMemoryObjectStore({ clock: new FakeClock(0) });
    expect(await store.presignGet('k', 60)).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
    store.setUnavailable('s3 down');
    const down = { ok: false, error: { code: 'unavailable', message: 's3 down' } };
    expect(await store.put('k', new Uint8Array(), 'x')).toEqual(down);
    expect(await store.get('k')).toEqual(down);
    expect(await store.head('k')).toEqual(down);
    expect(await store.delete(['k'])).toEqual(down);
    expect(await store.list('')).toEqual(down);
    expect(await store.presignPut('k', 'x', 60)).toEqual(down);
  });

  it('serves pre-signed PUT and GET on loopback, with S3-like refusals', async () => {
    const clock = new FakeClock(0);
    const store = new InMemoryObjectStore({ clock });
    const server = await serveObjectStore(store);
    try {
      const put = await store.presignPut('runs/r 1/frame.png', 'image/png', 60);
      if (!put.ok) throw new Error('presign failed');
      expect(put.value.headers).toEqual({ 'content-type': 'image/png' });
      expect(put.value.expiresAt).toBe('1970-01-01T00:01:00.000Z');
      const wrongType = await fetch(put.value.url, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: 'x',
      });
      expect(wrongType.status).toBe(403);
      const stored = await fetch(put.value.url, {
        method: 'PUT',
        headers: put.value.headers,
        body: 'PNGDATA',
      });
      expect(stored.status).toBe(200);
      const get = await store.presignGet('runs/r 1/frame.png', 60);
      if (!get.ok) throw new Error('presign failed');
      const fetched = await fetch(get.value.url);
      expect(fetched.headers.get('content-type')).toBe('image/png');
      expect(await fetched.text()).toBe('PNGDATA');
      expect(
        (await fetch(get.value.url.replace(/signature=[0-9a-f]+/, 'signature=00'))).status,
      ).toBe(403);
      expect((await fetch(`${server.url}/elsewhere`)).status).toBe(403);
      expect((await fetch(`${server.url}/objects/%E0%A4%A?expires=1&signature=x`)).status).toBe(
        403,
      );
      expect((await fetch(get.value.url, { method: 'DELETE' })).status).toBe(403);
      const missing = await store.presignGet('nothing', 60);
      if (!missing.ok) throw new Error('presign failed');
      expect((await fetch(missing.value.url)).status).toBe(404);
      expect(await store.presignGet('k', 0)).toMatchObject({ ok: false });
      await clock.advance(61_000);
      expect((await fetch(get.value.url)).status).toBe(403);
      expect(server.requests.map((request) => request.status)).toEqual([
        403, 200, 200, 403, 403, 403, 403, 404, 403,
      ]);
      store.setUnavailable('down');
      const later = new InMemoryObjectStore({ clock });
      expect(
        later.checkPresigned('GET', '/objects/k?expires=1&signature=bad', undefined),
      ).toMatchObject({ ok: false });
    } finally {
      await server.close();
    }
    expect(await store.presignGet('k', 60)).toMatchObject({ ok: false });
  });
});
