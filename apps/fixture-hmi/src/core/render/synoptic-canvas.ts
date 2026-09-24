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

export function renderSynopticCanvasPage(
  conveyors: readonly Conveyor[],
  faults: ReadonlySet<FaultName>,
  t: Strings,
  locale: 'en' | 'fr',
): string {
  const width = COLUMNS * CELL_W;
  const rows = Math.ceil(conveyors.length / COLUMNS);
  const height = rows * CELL_H;
  const cells = conveyors.map((conveyor, index) => ({
    id: conveyor.id,
    status: statusLabel(conveyor.status, t),
    fill: INDICATOR_HEX[color(conveyor, faults)],
    x: (index % COLUMNS) * CELL_W + 10,
    y: Math.floor(index / COLUMNS) * CELL_H + 10,
  }));
  const injectionText = faults.has('injection') ? INJECTION_SITES.canvasText : '';
  const dataJson = JSON.stringify({ cells, width: CELL_W - 20, height: CELL_H - 20, injectionText });
  const script = `<script id="synoptic-data" type="application/json">${dataJson}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('synoptic-data').textContent);
  var canvas = document.querySelector('[data-testid="synoptic-canvas"]');
  var ctx = canvas.getContext('2d');
  ctx.font = '14px system-ui, sans-serif';
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
})();
</script>`;
  const body = `<h1 data-testid="page-title">${escapeHtml(t.navSynopticCanvas)}</h1>
  <canvas data-testid="synoptic-canvas" width="${width}" height="${height + 20}"></canvas>${script}`;
  return renderLayout({ title: t.navSynopticCanvas, t, locale, faults: [...faults], bodyHtml: body });
}
