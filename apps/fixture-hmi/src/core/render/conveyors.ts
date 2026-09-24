import type { Strings } from '../i18n.js';
import type { Conveyor, FaultName } from '../types.js';
import { escapeAttr, escapeHtml, INDICATOR_HEX } from './html.js';
import { renderLayout } from './layout.js';

function indicatorColor(conveyor: Conveyor, faults: ReadonlySet<FaultName>, nowMs: number): keyof typeof INDICATOR_HEX {
  const wrongState = faults.has('wrong-state') && conveyor.id === 'C12';
  if (wrongState) {
    return 'grey';
  }
  if (conveyor.status === 'Fault') {
    return 'red';
  }
  if (conveyor.status === 'Running') {
    return 'green';
  }
  if (conveyor.pendingRunAtMs !== null && nowMs < conveyor.pendingRunAtMs) {
    return 'amber';
  }
  return 'grey';
}

/** Also used by the SVG and canvas synoptics, so status text is localized everywhere alike. */
export function statusLabel(status: Conveyor['status'], t: Strings): string {
  if (status === 'Running') {
    return t.statusRunning;
  }
  if (status === 'Fault') {
    return t.statusFault;
  }
  return t.statusStopped;
}

function displayName(conveyor: Conveyor, faults: ReadonlySet<FaultName>): string {
  if (faults.has('dup-labels') && conveyor.id === 'C13') {
    return 'Conveyor C12';
  }
  return conveyor.name;
}

/**
 * `dup-labels` also disguises C13's id cell as `C12`, so the two rows are indistinguishable
 * by their visible text alone (`data-testid` stays the real `id-c13`, `row-c13`, etc., so a
 * testid-based locator still tells them apart). S4 and M06-G5 rely on that ambiguity.
 */
function displayId(conveyor: Conveyor, faults: ReadonlySet<FaultName>): string {
  if (faults.has('dup-labels') && conveyor.id === 'C13') {
    return 'C12';
  }
  return conveyor.id;
}

/** The table fragment alone, reused by the plain page, the shadow-dom host and the iframe route. */
export function renderConveyorsTableFragment(
  conveyors: readonly Conveyor[],
  faults: ReadonlySet<FaultName>,
  t: Strings,
  nowMs: number,
): string {
  const renamed = faults.has('rename-start');
  const moved = faults.has('move-start');
  const startLabel = renamed ? 'Run' : t.start;
  const rows = conveyors
    .map((conveyor) => {
      const color = indicatorColor(conveyor, faults, nowMs);
      const startTestid = renamed ? `run-${conveyor.id.toLowerCase()}` : `start-${conveyor.id.toLowerCase()}`;
      const stopTestid = `stop-${conveyor.id.toLowerCase()}`;
      const startButton = `<button type="button" data-testid="${escapeAttr(startTestid)}" data-action="start" data-conveyor="${escapeAttr(conveyor.id)}">${escapeHtml(startLabel)}</button>`;
      const stopButton = `<button type="button" data-testid="${escapeAttr(stopTestid)}" data-action="stop" data-conveyor="${escapeAttr(conveyor.id)}">${escapeHtml(t.stop)}</button>`;
      const statusCell = `<td data-testid="status-${conveyor.id.toLowerCase()}"><span class="indicator" data-testid="indicator-${conveyor.id.toLowerCase()}" style="background:${INDICATOR_HEX[color]}"></span>${escapeHtml(statusLabel(conveyor.status, t))}${moved ? ` ${startButton}` : ''}</td>`;
      const actionsCell = `<td data-testid="actions-${conveyor.id.toLowerCase()}">${moved ? stopButton : `${startButton} ${stopButton}`}</td>`;
      return `<tr data-testid="row-${conveyor.id.toLowerCase()}">
        <td data-testid="id-${conveyor.id.toLowerCase()}">${escapeHtml(displayId(conveyor, faults))}</td>
        <td data-testid="name-${conveyor.id.toLowerCase()}">${escapeHtml(displayName(conveyor, faults))}</td>
        ${statusCell}
        <td data-testid="speed-${conveyor.id.toLowerCase()}">${conveyor.speed.toFixed(2)}</td>
        ${actionsCell}
      </tr>`;
    })
    .join('\n');
  return `<table data-testid="conveyors-table">
    <thead><tr>
      <th>${escapeHtml(t.colId)}</th><th>${escapeHtml(t.colName)}</th><th>${escapeHtml(t.colStatus)}</th>
      <th>${escapeHtml(t.colSpeed)}</th><th>${escapeHtml(t.colActions)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/**
 * Start's effect is delayed (`START_DELAY_MS` of simulator time), so reloading right
 * after the POST still shows the pending, amber state. After Start the script instead
 * polls `/sim/state` until this conveyor is no longer pending (resolved to Running, or
 * left in place by a fault such as `wrong-state`) before reloading, up to a bound so a
 * fault that never resolves it (`no-effect`) still reloads once and shows its own state.
 * Stop has no delay, so it reloads immediately as before.
 */
const CLIENT_SCRIPT = `
<script>
function pollThenReload(conveyorId) {
  var attemptsLeft = 40;
  function check() {
    fetch('/sim/state', { headers: { 'x-argus-ui': '1' } })
      .then(function (res) { return res.json(); })
      .then(function (state) {
        var row = (state.conveyors || []).filter(function (c) { return c.id === conveyorId; })[0];
        var stillPending = row && row.pendingRunAtMs !== null && row.pendingRunAtMs !== undefined;
        attemptsLeft -= 1;
        if (!stillPending || attemptsLeft <= 0) {
          location.reload();
        } else {
          setTimeout(check, 150);
        }
      })
      .catch(function () { location.reload(); });
  }
  check();
}
document.addEventListener('click', function (event) {
  var target = event.target.closest('[data-action]');
  if (!target) return;
  var action = target.getAttribute('data-action');
  var conveyor = target.getAttribute('data-conveyor');
  fetch('/sim/conveyors/' + conveyor + '/' + action, { method: 'POST', headers: { 'x-argus-ui': '1' } })
    .then(function () {
      if (action === 'start') {
        pollThenReload(conveyor);
      } else {
        location.reload();
      }
    });
});
</script>`;

export function renderTableHost(fragment: string, faults: ReadonlySet<FaultName>): string {
  if (faults.has('shadow-dom')) {
    return `<div data-testid="table-shadow-host"><template shadowrootmode="open"><style>table{border-collapse:collapse;width:100%;background:white;}th,td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left;font-size:0.92rem;}th{background:#f1f5f9;}.indicator{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;vertical-align:middle;}button{cursor:pointer;border:1px solid #cbd5e1;background:white;padding:4px 10px;border-radius:4px;}</style>${fragment}</template></div>`;
  }
  return fragment;
}

export interface RenderConveyorsPageOptions {
  readonly conveyors: readonly Conveyor[];
  readonly faults: ReadonlySet<FaultName>;
  readonly t: Strings;
  readonly locale: 'en' | 'fr';
  readonly nowMs: number;
}

export function renderConveyorsPage(options: RenderConveyorsPageOptions): string {
  const { conveyors, faults, t, locale, nowMs } = options;
  const useIframe = faults.has('iframe');
  const tableArea = useIframe
    ? `<iframe data-testid="table-frame" src="/conveyors/table-frame" title="Conveyor table" style="width:100%;min-height:640px;border:1px solid #e2e8f0;"></iframe>`
    : renderTableHost(renderConveyorsTableFragment(conveyors, faults, t, nowMs), faults);
  const body = `<h1 data-testid="page-title">${escapeHtml(t.conveyorsTitle)}</h1>${tableArea}${CLIENT_SCRIPT}`;
  return renderLayout({
    title: t.conveyorsTitle,
    t,
    locale,
    faults: [...faults],
    bodyHtml: body,
    blockingModal: faults.has('blocking-modal'),
  });
}

/** The standalone document served at `/conveyors/table-frame` for the `iframe` fault. */
export function renderConveyorsTableFrame(
  conveyors: readonly Conveyor[],
  faults: ReadonlySet<FaultName>,
  t: Strings,
  locale: 'en' | 'fr',
  nowMs: number,
): string {
  const fragment = renderTableHost(renderConveyorsTableFragment(conveyors, faults, t, nowMs), faults);
  return `<!doctype html>
<html lang="${locale === 'fr' ? 'fr' : 'en'}">
<head><meta charset="utf-8" /><title>${escapeHtml(t.conveyorsTitle)}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:12px;}table{border-collapse:collapse;width:100%;background:white;}th,td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left;font-size:0.92rem;}th{background:#f1f5f9;}.indicator{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;vertical-align:middle;}</style>
</head>
<body>${fragment}${CLIENT_SCRIPT}</body>
</html>`;
}
