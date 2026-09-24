import type { Strings } from '../i18n.js';
import type { Conveyor, FaultName } from '../types.js';
import { statusLabel } from './conveyors.js';
import { escapeAttr, escapeHtml, INDICATOR_HEX } from './html.js';
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

export function renderSynopticSvgPage(
  conveyors: readonly Conveyor[],
  faults: ReadonlySet<FaultName>,
  t: Strings,
  locale: 'en' | 'fr',
): string {
  const width = COLUMNS * CELL_W;
  const rows = Math.ceil(conveyors.length / COLUMNS);
  const height = rows * CELL_H;
  const groups = conveyors
    .map((conveyor, index) => {
      const col = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const x = col * CELL_W + 10;
      const y = row * CELL_H + 10;
      const fill = INDICATOR_HEX[color(conveyor, faults)];
      const idLower = conveyor.id.toLowerCase();
      const label = statusLabel(conveyor.status, t);
      return `<g data-testid="svg-${idLower}" role="img" tabindex="0" data-conveyor="${escapeAttr(conveyor.id)}" style="cursor:pointer">
        <title>${escapeHtml(conveyor.id)} - ${escapeHtml(label)}</title>
        <rect x="${x}" y="${y}" width="${CELL_W - 20}" height="${CELL_H - 20}" rx="8" fill="${fill}" stroke="#0f172a" stroke-width="1" />
        <text x="${x + 10}" y="${y + 24}" fill="white" font-size="14" font-family="system-ui">${escapeHtml(conveyor.id)}</text>
        <text x="${x + 10}" y="${y + 44}" fill="white" font-size="12" font-family="system-ui">${escapeHtml(label)}</text>
      </g>`;
    })
    .join('\n');
  const script = `<script>
document.querySelectorAll('[data-conveyor]').forEach(function (g) {
  g.addEventListener('click', function () {
    var id = g.getAttribute('data-conveyor');
    fetch('/sim/conveyors/' + id + '/start', { method: 'POST', headers: { 'x-argus-ui': '1' } }).then(function () { location.reload(); });
  });
});
</script>`;
  const body = `<h1 data-testid="page-title">${escapeHtml(t.navSynopticSvg)}</h1>
  <svg data-testid="synoptic-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    ${groups}
  </svg>${script}`;
  return renderLayout({ title: t.navSynopticSvg, t, locale, faults: [...faults], bodyHtml: body });
}
