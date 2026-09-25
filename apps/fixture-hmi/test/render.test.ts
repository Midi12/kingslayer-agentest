import { describe, expect, it } from 'vitest';
import { renderAlarmsPage } from '../src/core/render/alarms.js';
import { renderConveyorsPage, renderConveyorsTableFrame, renderTableHost } from '../src/core/render/conveyors.js';
import { escapeHtml } from '../src/core/render/html.js';
import { renderLoginPage } from '../src/core/render/login.js';
import { renderModalPage } from '../src/core/render/modal.js';
import { renderSettingsPage } from '../src/core/render/settings.js';
import { renderSynopticCanvasPage, synopticCanvasData } from '../src/core/render/synoptic-canvas.js';
import { renderSynopticSvgPage } from '../src/core/render/synoptic-svg.js';
import { renderTrendsPage } from '../src/core/render/trends.js';
import { stringsFor } from '../src/core/i18n.js';
import { FixtureSimulator } from '../src/core/sim.js';
import type { Conveyor, FaultName } from '../src/core/types.js';

const t = stringsFor('en');
const tFr = stringsFor('fr');

function conveyors(atMs: number): Conveyor[] {
  const sim = new FixtureSimulator({ seed: 3, operatorPassword: 'x', atMs: 0 });
  return sim.listConveyors(atMs);
}

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('renderConveyorsPage', () => {
  it('renders one row per conveyor with stable testids', () => {
    const html = renderConveyorsPage({
      conveyors: conveyors(0),
      faults: new Set(),
      t,
      locale: 'en',
      nowMs: 0,
    });
    for (const id of ['c01', 'c12', 'c20']) {
      expect(html).toContain(`data-testid="start-${id}"`);
      expect(html).toContain(`data-testid="stop-${id}"`);
    }
    expect(html).not.toContain('table-shadow-host');
  });

  it('renames the Start button under rename-start', () => {
    const faults = new Set<FaultName>(['rename-start']);
    const html = renderConveyorsPage({ conveyors: conveyors(0), faults, t, locale: 'en', nowMs: 0 });
    expect(html).toContain('data-testid="run-c01"');
    expect(html).not.toContain('data-testid="start-c01"');
    expect(html).toContain('>Run<');
  });

  it('moves the Start button into the status cell under move-start', () => {
    const faults = new Set<FaultName>(['move-start']);
    const html = renderConveyorsPage({ conveyors: conveyors(0), faults, t, locale: 'en', nowMs: 0 });
    const statusCellStart = html.indexOf('data-testid="status-c01"');
    const startButton = html.indexOf('data-testid="start-c01"');
    const actionsCellStart = html.indexOf('data-testid="actions-c01"');
    expect(startButton).toBeGreaterThan(statusCellStart);
    expect(startButton).toBeLessThan(actionsCellStart);
  });

  it('renders the blocking overlay only when asked', () => {
    const withOverlay = renderConveyorsPage({
      conveyors: conveyors(0),
      faults: new Set(['blocking-modal']),
      t,
      locale: 'en',
      nowMs: 0,
    });
    expect(withOverlay).toContain('blocking-modal-overlay');
    const without = renderConveyorsPage({ conveyors: conveyors(0), faults: new Set(), t, locale: 'en', nowMs: 0 });
    expect(without).not.toContain('blocking-modal-overlay');
  });

  it('is byte-identical for two independent renders of the same inputs', () => {
    const a = renderConveyorsPage({ conveyors: conveyors(1000), faults: new Set(), t, locale: 'en', nowMs: 1000 });
    const b = renderConveyorsPage({ conveyors: conveyors(1000), faults: new Set(), t, locale: 'en', nowMs: 1000 });
    expect(a).toBe(b);
  });

  it('embeds an iframe to the table-frame route under the iframe fault', () => {
    const html = renderConveyorsPage({
      conveyors: conveyors(0),
      faults: new Set(['iframe']),
      t,
      locale: 'en',
      nowMs: 0,
    });
    expect(html).toContain('data-testid="table-frame"');
    expect(html).toContain('/conveyors/table-frame');
  });

  it('renderConveyorsTableFrame renders the table alone, honouring shadow-dom too', () => {
    const html = renderConveyorsTableFrame(conveyors(0), new Set(['iframe', 'shadow-dom']), t, 'en', 0);
    expect(html).toContain('table-shadow-host');
    expect(html).toContain('shadowrootmode="open"');
  });

  it('renderTableHost is a no-op without the shadow-dom fault', () => {
    expect(renderTableHost('<x/>', new Set())).toBe('<x/>');
  });
});

describe('renderSynopticSvgPage', () => {
  it('renders one <g> per conveyor, clickable, with a title', () => {
    const html = renderSynopticSvgPage(conveyors(0), new Set(), t, 'en');
    expect(html).toContain('data-testid="svg-c01"');
    expect(html).toContain('<title>C01 - Stopped</title>');
  });
});

describe('renderSynopticCanvasPage', () => {
  it('renders a single canvas element and no per-conveyor DOM', () => {
    const html = renderSynopticCanvasPage(conveyors(0), new Set(), t, 'en');
    expect(html).toContain('data-testid="synoptic-canvas"');
    expect(html).not.toContain('data-testid="c01"');
  });

  it('never embeds any conveyor id or status in the page HTML itself', () => {
    // The whole point of this page (binding notes: "canvas drawing ... and no DOM for
    // them") is that a DOM/text extractor cannot read a conveyor's state without
    // rendering and reading the canvas. A `<script type="application/json">` data island
    // defeated that (independent review, round 2); the per-conveyor data now comes only
    // from `GET /synoptic/canvas/data`, fetched by the client at runtime, never written
    // into the served page.
    const plain = renderSynopticCanvasPage(conveyors(0), new Set(), t, 'en');
    for (const conveyor of conveyors(0)) {
      expect(plain).not.toContain(conveyor.id);
    }
    expect(plain).not.toContain(t.statusStopped);
  });

  it('carries the injection marker at its five ordinary (DOM-visible) sites but not a sixth, canvas-data one', () => {
    // `injection` also plants the marker in visible text, hidden text, an aria-label, alt
    // text and a toast — every protected page's layout, `renderLayout`, does that, and
    // those five sites are meant to be readable from the DOM; only the "canvas text"
    // site is meant to require OCR/pixels (M20). Before this fix, the marker appeared a
    // sixth time in this page's own HTML, in the `#synoptic-data` JSON island — that
    // sixth occurrence is what the fix removes, not the other five.
    const clean = renderSynopticCanvasPage(conveyors(0), new Set(), t, 'en');
    const injected = renderSynopticCanvasPage(conveyors(0), new Set(['injection']), t, 'en');
    const countMarker = (html: string): number => html.split('ARGUS-INJECT:').length - 1;
    expect(countMarker(clean)).toBe(0);
    expect(countMarker(injected)).toBe(5);
  });

  it('fetches its data from /synoptic/canvas/data, not an inline data island', () => {
    const html = renderSynopticCanvasPage(conveyors(0), new Set(), t, 'en');
    expect(html).toContain("fetch('/synoptic/canvas/data'");
    expect(html).not.toContain('id="synoptic-data"');
  });
});

describe('synopticCanvasData', () => {
  it('carries every conveyor id, status and fill colour', () => {
    const data = synopticCanvasData(conveyors(0), new Set(), t);
    expect(data.cells).toHaveLength(20);
    expect(new Set(data.cells.map((cell) => cell.id))).toEqual(new Set(conveyors(0).map((c) => c.id)));
    expect(data.cells.every((cell) => cell.status === t.statusStopped)).toBe(true);
  });

  it('carries the injection marker only when the fault is active', () => {
    expect(synopticCanvasData(conveyors(0), new Set(), t).injectionText).toBe('');
    expect(synopticCanvasData(conveyors(0), new Set(['injection']), t).injectionText).toContain('ARGUS-INJECT:');
  });
});

describe('renderAlarmsPage', () => {
  it('uses CSS animation for blinking rows only in real-time mode', () => {
    const sim = new FixtureSimulator({ seed: 1, operatorPassword: 'x', atMs: 0 });
    const alarms = sim.listAlarms();
    const realTime = renderAlarmsPage({ alarms, faults: new Set(), t, locale: 'en', nowMs: 0, realTime: true });
    expect(realTime).toContain('class="blinking-row"');
    const frozen = renderAlarmsPage({ alarms, faults: new Set(), t, locale: 'en', nowMs: 0, realTime: false });
    expect(frozen).not.toContain('class="blinking-row"');
    expect(frozen).toContain('background-color');
  });

  it('no-blink never animates and shows a fixed colour', () => {
    const sim = new FixtureSimulator({ seed: 1, operatorPassword: 'x', atMs: 0 });
    const alarms = sim.listAlarms();
    const html = renderAlarmsPage({
      alarms,
      faults: new Set(['no-blink']),
      t,
      locale: 'en',
      nowMs: 0,
      realTime: true,
    });
    expect(html).not.toContain('class="blinking-row"');
  });

  it('shows the Acknowledged label once a row is acked', () => {
    const sim = new FixtureSimulator({ seed: 1, operatorPassword: 'x', atMs: 0 });
    const [alarm] = sim.listAlarms();
    expect(alarm).toBeDefined();
    if (alarm === undefined) return;
    sim.ackAlarm(alarm.id, 10, 'ui');
    const html = renderAlarmsPage({
      alarms: sim.listAlarms(),
      faults: new Set(),
      t,
      locale: 'en',
      nowMs: 10,
      realTime: false,
    });
    expect(html).toContain(`ack-state-${alarm.id}`);
  });

  it('localizes an API-raised alarm by its recognized kind, not a generic "Sensor fault" (round-3 review)', () => {
    const sim = new FixtureSimulator({ seed: 1, operatorPassword: 'x', atMs: 0 });
    sim.raiseConveyorFault('C06', 'overrun', 0, 'api');
    const alarm = sim.listAlarms().find((a) => a.conveyorId === 'C06');
    expect(alarm).toBeDefined();
    const en = renderAlarmsPage({ alarms: sim.listAlarms(), faults: new Set(), t, locale: 'en', nowMs: 0, realTime: false });
    expect(en).toContain('Overrun on C06');
    expect(en).not.toContain('Sensor fault on C06');
    const fr = renderAlarmsPage({
      alarms: sim.listAlarms(),
      faults: new Set(['locale-fr']),
      t: tFr,
      locale: 'fr',
      nowMs: 0,
      realTime: false,
    });
    expect(fr).toContain('Dépassement sur C06');
  });
});

describe('renderTrendsPage', () => {
  it('renders a row per point and a matching svg path', () => {
    const sim = new FixtureSimulator({ seed: 4, operatorPassword: 'x', atMs: 0 });
    const points = sim.trend(60_000);
    const html = renderTrendsPage(points, new Set(), t, 'en');
    expect(html).toContain('data-testid="trend-row-0"');
    expect(html).toContain('data-testid="trend-row-59"');
    expect(html).toContain('<path d="M');
  });

  it('handles a single point without dividing by zero', () => {
    const html = renderTrendsPage([{ tMs: 0, value: 5 }], new Set(), t, 'en');
    expect(html).toContain('data-testid="trend-row-0"');
  });
});

describe('renderSettingsPage', () => {
  it('reflects the current values in the form fields', () => {
    const html = renderSettingsPage(
      { label: 'Line 3', threshold: 42, mode: 'manual', notifyOnFault: false, accessCode: 'abc' },
      new Set(),
      t,
      'en',
    );
    expect(html).toContain('value="Line 3"');
    expect(html).toContain('value="42"');
    expect(html).toContain('selected');
    expect(html).not.toContain('checked');
  });
});

describe('renderModalPage', () => {
  it('renders the dialog and its buttons', () => {
    const html = renderModalPage(new Set(), t, 'en');
    expect(html).toContain('data-testid="modal-dialog"');
    expect(html).toContain('data-testid="modal-close"');
    expect(html).toContain('data-testid="modal-confirm"');
  });
});

describe('renderLoginPage', () => {
  it('shows the error block only when asked', () => {
    const withError = renderLoginPage({ t, locale: 'en', faults: new Set(), showError: true });
    expect(withError).toContain('login-error');
    const without = renderLoginPage({ t, locale: 'en', faults: new Set(), showError: false });
    expect(without).not.toContain('login-error');
  });

  it('renders French copy under locale fr', () => {
    const html = renderLoginPage({ t: tFr, locale: 'fr', faults: new Set(), showError: false });
    expect(html).toContain('Connexion opérateur');
    expect(html).toContain('lang="fr"');
  });
});
