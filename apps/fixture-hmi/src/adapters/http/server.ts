/**
 * The Fastify HTTP adapter: every route of the fixture HMI (pages and `/sim/*`), wired
 * to the pure core (`FixtureSimulator`, the render functions) and the one clock adapter.
 * This file is a composition root's neighbour: it is imported only from `src/index.ts`.
 */
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { SimClock } from '../clock.js';
import { renderAlarmsPage } from '../../core/render/alarms.js';
import { renderConveyorsPage, renderConveyorsTableFrame } from '../../core/render/conveyors.js';
import { renderLoginPage } from '../../core/render/login.js';
import { renderModalPage } from '../../core/render/modal.js';
import { renderSettingsPage } from '../../core/render/settings.js';
import { renderSynopticCanvasPage } from '../../core/render/synoptic-canvas.js';
import { renderSynopticSvgPage } from '../../core/render/synoptic-svg.js';
import { renderTrendsPage } from '../../core/render/trends.js';
import type { FixtureSimulator } from '../../core/sim.js';
import { stringsFor, type Locale } from '../../core/i18n.js';
import { FAULT_NAMES, SLOW_LOAD_DELAY_MS, isFaultName, type FaultName } from '../../core/types.js';

const SESSION_COOKIE = 'argus_session';

const PROTECTED_PATH_PREFIXES = [
  '/conveyors',
  '/synoptic/svg',
  '/synoptic/canvas',
  '/alarms',
  '/trends',
  '/settings',
  '/modal',
];

function isProtectedPath(path: string): boolean {
  return PROTECTED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function localeOf(sim: FixtureSimulator): Locale {
  return sim.hasFault('locale-fr') ? 'fr' : 'en';
}

function faultSet(sim: FixtureSimulator): ReadonlySet<FaultName> {
  return new Set(sim.activeFaults());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return (body ?? {}) as Record<string, unknown>;
}

export interface BuildServerOptions {
  readonly sim: FixtureSimulator;
  readonly clock: SimClock;
  readonly logger: boolean;
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const { sim, clock } = options;
  const app = Fastify({ logger: options.logger });

  app.register(formbody);
  app.register(cookie, { secret: 'argus-fixture-hmi-cookie-secret' });

  // Real, artificial latency for `slow-load`; never applied to the liveness probe.
  app.addHook('onRequest', async (request) => {
    if (request.url !== '/healthz' && sim.hasFault('slow-load')) {
      await sleep(SLOW_LOAD_DELAY_MS);
    }
  });

  function sessionToken(request: FastifyRequest): string | undefined {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw === undefined) {
      return undefined;
    }
    const unsigned = request.unsignCookie(raw);
    return unsigned.valid ? unsigned.value : undefined;
  }

  app.addHook('preHandler', (request, reply, done) => {
    const path = new URL(request.url, 'http://fixture-hmi.local').pathname;
    if (isProtectedPath(path) && sim.validateSession(sessionToken(request)) === undefined) {
      reply.redirect('/login', 302);
      done();
      return;
    }
    done();
  });

  app.get('/healthz', (_request, reply) => {
    reply.send({ status: 'ok' });
  });

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  app.get('/login', (request, reply) => {
    const showError = (request.query as Record<string, unknown>)['error'] === '1';
    const html = renderLoginPage({
      t: stringsFor(localeOf(sim)),
      locale: localeOf(sim),
      faults: faultSet(sim),
      showError,
    });
    reply.type('text/html; charset=utf-8').send(html);
  });

  app.post('/login', (request, reply) => {
    const body = bodyRecord(request.body);
    const user = typeof body['user'] === 'string' ? body['user'] : '';
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    const result = sim.login(user, password, clock.now());
    if (!result.ok) {
      reply.redirect('/login?error=1', 303);
      return;
    }
    reply.setCookie(SESSION_COOKIE, result.value.token, { path: '/', httpOnly: true, signed: true });
    reply.redirect('/conveyors', 303);
  });

  app.get('/logout', (request, reply) => {
    const token = sessionToken(request);
    if (token !== undefined) {
      sim.logout(token, clock.now());
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.redirect('/login', 303);
  });

  // -----------------------------------------------------------------------
  // Pages
  // -----------------------------------------------------------------------

  app.get('/conveyors', (_request, reply) => {
    const now = clock.now();
    const html = renderConveyorsPage({
      conveyors: sim.listConveyors(now),
      faults: faultSet(sim),
      t: stringsFor(localeOf(sim)),
      locale: localeOf(sim),
      nowMs: now,
    });
    reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/conveyors/table-frame', (_request, reply) => {
    const now = clock.now();
    const html = renderConveyorsTableFrame(
      sim.listConveyors(now),
      faultSet(sim),
      stringsFor(localeOf(sim)),
      localeOf(sim),
      now,
    );
    reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/synoptic/svg', (_request, reply) => {
    const now = clock.now();
    const html = renderSynopticSvgPage(sim.listConveyors(now), faultSet(sim), stringsFor(localeOf(sim)), localeOf(sim));
    reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/synoptic/canvas', (_request, reply) => {
    const now = clock.now();
    const html = renderSynopticCanvasPage(
      sim.listConveyors(now),
      faultSet(sim),
      stringsFor(localeOf(sim)),
      localeOf(sim),
    );
    reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/alarms', (_request, reply) => {
    const now = clock.now();
    const html = renderAlarmsPage({
      alarms: sim.listAlarms(),
      faults: faultSet(sim),
      t: stringsFor(localeOf(sim)),
      locale: localeOf(sim),
      nowMs: now,
      realTime: !clock.isFrozen(),
    });
    reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/trends', (_request, reply) => {
    const now = clock.now();
    const html = renderTrendsPage(sim.trend(now), faultSet(sim), stringsFor(localeOf(sim)), localeOf(sim));
    reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/settings', (_request, reply) => {
    const html = renderSettingsPage(sim.getSettings(), faultSet(sim), stringsFor(localeOf(sim)), localeOf(sim));
    reply.type('text/html; charset=utf-8').send(html);
  });

  app.post('/settings', (request, reply) => {
    const body = bodyRecord(request.body);
    sim.updateSettings(
      {
        label: typeof body['label'] === 'string' ? body['label'] : '',
        threshold: Number(body['threshold'] ?? 0),
        mode: body['mode'] === 'manual' || body['mode'] === 'maintenance' ? body['mode'] : 'auto',
        notifyOnFault: body['notifyOnFault'] === 'on' || body['notifyOnFault'] === 'true',
        accessCode: typeof body['accessCode'] === 'string' ? body['accessCode'] : '',
      },
      clock.now(),
      'ui',
    );
    reply.redirect('/settings', 303);
  });

  app.get('/modal', (_request, reply) => {
    const html = renderModalPage(faultSet(sim), stringsFor(localeOf(sim)), localeOf(sim));
    reply.type('text/html; charset=utf-8').send(html);
  });

  // -----------------------------------------------------------------------
  // Simulator API
  // -----------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/sim/conveyors/:id/start', (request, reply) => {
    const result = sim.startConveyor(request.params.id, clock.now(), 'api');
    reply.status(result.ok ? 200 : 404).send(result.ok ? { ok: true } : result.error);
  });

  app.post<{ Params: { id: string } }>('/sim/conveyors/:id/stop', (request, reply) => {
    const result = sim.stopConveyor(request.params.id, clock.now(), 'api');
    reply.status(result.ok ? 200 : 404).send(result.ok ? { ok: true } : result.error);
  });

  app.post<{ Params: { id: string } }>('/sim/conveyors/:id/faults', (request, reply) => {
    const body = bodyRecord(request.body);
    const type = typeof body['type'] === 'string' ? body['type'] : '';
    const result = sim.raiseConveyorFault(request.params.id, type, clock.now(), 'api');
    if (!result.ok) {
      reply.status(result.error.code === 'UNKNOWN_CONVEYOR' ? 404 : 422).send(result.error);
      return;
    }
    reply.status(202).send(result.value);
  });

  app.post<{ Params: { id: string } }>('/sim/alarms/:id/ack', (request, reply) => {
    const result = sim.ackAlarm(request.params.id, clock.now(), 'api');
    if (!result.ok) {
      reply.status(result.error.code === 'UNKNOWN_ALARM' ? 404 : 409).send(result.error);
      return;
    }
    reply.status(200).send({ ok: true });
  });

  app.post('/sim/reset', (request, reply) => {
    const body = bodyRecord(request.body);
    const seed = typeof body['seed'] === 'number' ? body['seed'] : undefined;
    sim.reset(clock.now(), seed);
    reply.status(200).send(sim.snapshot(clock.now()));
  });

  app.post('/sim/seed', (request, reply) => {
    const body = bodyRecord(request.body);
    const seed = typeof body['seed'] === 'number' ? body['seed'] : undefined;
    if (seed === undefined) {
      reply.status(422).send({ code: 'INVALID_SEED', message: 'seed must be a number' });
      return;
    }
    sim.reset(clock.now(), seed);
    reply.status(200).send({ seed });
  });

  app.post('/sim/clock', (request, reply) => {
    const body = bodyRecord(request.body);
    const mode = body['mode'];
    if (mode !== 'real' && mode !== 'frozen') {
      reply.status(422).send({ code: 'INVALID_CLOCK_MODE', message: 'mode must be real or frozen' });
      return;
    }
    const at = typeof body['now'] === 'number' ? body['now'] : undefined;
    clock.setMode(mode, at);
    reply.status(200).send({ mode: clock.getMode(), now: clock.now() });
  });

  app.get('/sim/state', (_request, reply) => {
    reply.status(200).send({ ...sim.snapshot(clock.now()), clockMode: clock.getMode() });
  });

  app.get('/sim/log', (_request, reply) => {
    reply.status(200).send({ entries: sim.getLog() });
  });

  app.get('/sim/faults', (_request, reply) => {
    reply.status(200).send({ active: sim.activeFaults(), all: FAULT_NAMES });
  });

  app.post<{ Params: { name: string } }>('/sim/faults/:name', (request, reply) => {
    if (!isFaultName(request.params.name)) {
      reply.status(404).send({ code: 'UNKNOWN_FAULT', message: `unknown fault "${request.params.name}"` });
      return;
    }
    sim.setFault(request.params.name, true);
    reply.status(200).send({ active: sim.activeFaults() });
  });

  app.delete<{ Params: { name: string } }>('/sim/faults/:name', (request, reply) => {
    if (!isFaultName(request.params.name)) {
      reply.status(404).send({ code: 'UNKNOWN_FAULT', message: `unknown fault "${request.params.name}"` });
      return;
    }
    sim.setFault(request.params.name, false);
    reply.status(200).send({ active: sim.activeFaults() });
  });

  return app;
}
