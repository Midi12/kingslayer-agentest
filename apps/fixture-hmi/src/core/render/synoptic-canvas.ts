import { INJECTION_SITES } from '../injection.js';
import type { Strings } from '../i18n.js';
import type { Conveyor, FaultName } from '../types.js';
import { statusLabel } from './conveyors.js';
import { escapeHtml, INDICATOR_HEX } from './html.js';
import { renderLayout } from './layout.js';

const COLUMNS = 5;
const CELL_W = 170;
const CELL_H = 90;

function color(conveyor: Conveyor, faults: ReadonlySet<FaultName>): keyof typeof INDICATOR_HEX {
  if (faults.has('wrong-state') && conveyor.id === 'C12') {
    return 'grey';
  }
  if (conveyor.status === 'Fault') {
    return 'red';
  }
  if (conveyor.status === 'Running') {
    return 'green';
  }
  if (conveyor.pendingRunAtMs !== null) {
    return 'amber';
  }
  return 'grey';
}

export interface SynopticCanvasCell {
  readonly id: string;
  readonly status: string;
  readonly fill: string;
  readonly x: number;
  readonly y: number;
}

export interface SynopticCanvasData {
  readonly cells: readonly SynopticCanvasCell[];
  readonly width: number;
  readonly height: number;
  readonly injectionText: string;
}

/**
 * The per-conveyor id, status text and fill colour the canvas draws, plus the injection
 * text when that fault is active. This is deliberately never embedded in the page's own
 * HTML (see `renderSynopticCanvasPage`): it is served from `GET /synoptic/canvas/data`
 * instead, and the page's client script fetches it after load and draws it to the
 * canvas. The binding notes for this page say "canvas drawing of C01..C20 with labels
 * and state text and no DOM for them" precisely so that a DOM or text extractor cannot
 * read a conveyor's state here and has to fall back to OCR or pixel reading of the
 * canvas, the way M04/M05/M20 are meant to exercise. A `<script type="application/json">`
 * data island in the page's own markup would defeat that (independent review, round 2):
 * `page.content()` on the served page shows nothing about any conveyor's id or status,
 * or, under `injection`, the marker text — all three live only in this endpoint's JSON
 * response, a separate network resource the canvas fault site's OCR requirement is
 * about, not a DOM node's text content.
 */
export function synopticCanvasData(
  conveyors: readonly Conveyor[],
  faults: ReadonlySet<FaultName>,
  t: Strings,
): SynopticCanvasData {
  const cells = conveyors.map((conveyor, index) => ({
    id: conveyor.id,
    status: statusLabel(conveyor.status, t),
    fill: INDICATOR_HEX[color(conveyor, faults)],
    x: (index % COLUMNS) * CELL_W + 10,
    y: Math.floor(index / COLUMNS) * CELL_H + 10,
  }));
  return {
    cells,
    width: CELL_W - 20,
    height: CELL_H - 20,
    injectionText: faults.has('injection') ? INJECTION_SITES.canvasText : '',
  };
}

const CANVAS_CLIENT_SCRIPT = `
<script>
(function () {
  var canvas = document.querySelector('[data-testid="synoptic-canvas"]');
  var ctx = canvas.getContext('2d');
  ctx.font = '14px system-ui, sans-serif';
  fetch('/synoptic/canvas/data', { headers: { 'x-argus-ui': '1' } })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      data.cells.forEach(function (cell) {
        ctx.fillStyle = cell.fill;
        ctx.beginPath();
        if (ctx.roundRect) { ctx.roundRect(cell.x, cell.y, data.width, data.height, 8); } else { ctx.rect(cell.x, cell.y, data.width, data.height); }
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.stroke();
        ctx.fillStyle = 'white';
        ctx.fillText(cell.id, cell.x + 10, cell.y + 24);
        ctx.fillText(cell.status, cell.x + 10, cell.y + 44);
      });
      if (data.injectionText) {
        ctx.fillStyle = '#0f172a';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(data.injectionText, 4, canvas.height - 4);
      }
      // A marker for anything (a test, a caller) that needs to know the async draw
      // above has actually finished landing on the canvas.
      canvas.setAttribute('data-rendered', '1');
    });
})();
</script>`;

export function renderSynopticCanvasPage(
  conveyors: readonly Conveyor[],
  faults: ReadonlySet<FaultName>,
  t: Strings,
  locale: 'en' | 'fr',
): string {
  const width = COLUMNS * CELL_W;
  const rows = Math.ceil(conveyors.length / COLUMNS);
  const height = rows * CELL_H;
  const body = `<h1 data-testid="page-title">${escapeHtml(t.navSynopticCanvas)}</h1>
  <canvas data-testid="synoptic-canvas" width="${width}" height="${height + 20}"></canvas>${CANVAS_CLIENT_SCRIPT}`;
  return renderLayout({ title: t.navSynopticCanvas, t, locale, faults: [...faults], bodyHtml: body });
}
