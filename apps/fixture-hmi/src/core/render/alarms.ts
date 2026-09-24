import { blinkOn } from '../sim.js';
import type { Strings } from '../i18n.js';
import type { Alarm, FaultName } from '../types.js';
import { ALARM_OFF_HEX, ALARM_ON_HEX, escapeAttr, escapeHtml } from './html.js';
import { renderLayout } from './layout.js';

function formatTime(ms: number): string {
  return new Date(ms).toISOString();
}

export interface RenderAlarmsOptions {
  readonly alarms: readonly Alarm[];
  readonly faults: ReadonlySet<FaultName>;
  readonly t: Strings;
  readonly locale: 'en' | 'fr';
  readonly nowMs: number;
  /** True when the page is served in real-time clock mode: blinking rows animate via CSS. */
  readonly realTime: boolean;
}

export function renderAlarmsPage(options: RenderAlarmsOptions): string {
  const { alarms, faults, t, locale, nowMs, realTime } = options;
  const noBlink = faults.has('no-blink');
  const rows = alarms
    .map((alarm) => {
      const idLower = alarm.id;
      const blinking = alarm.ackedAtMs === null && !noBlink;
      let style = '';
      let cssClass = '';
      if (blinking && realTime) {
        cssClass = ' class="blinking-row"';
      } else if (alarm.ackedAtMs === null) {
        const on = noBlink ? true : blinkOn(nowMs);
        style = ` style="background-color:${on ? ALARM_ON_HEX : ALARM_OFF_HEX}"`;
      }
      const ackCell =
        alarm.ackedAtMs === null
          ? `<button type="button" data-testid="ack-${idLower}" data-action="ack" data-alarm="${escapeAttr(alarm.id)}">${escapeHtml(t.acknowledge)}</button>`
          : `<span data-testid="ack-state-${idLower}">${escapeHtml(t.acknowledged)}</span>`;
      return `<tr data-testid="alarm-row-${idLower}"${cssClass}${style}>
        <td data-testid="alarm-message-${idLower}">${escapeHtml(alarm.message)}</td>
        <td data-testid="alarm-conveyor-${idLower}">${escapeHtml(alarm.conveyorId)}</td>
        <td data-testid="alarm-raised-${idLower}">${formatTime(alarm.raisedAtMs)}</td>
        <td data-testid="alarm-ack-${idLower}">${ackCell}</td>
      </tr>`;
    })
    .join('\n');
  const style = `<style>
    @keyframes argus-blink { 0%, 49.9% { background-color: ${ALARM_ON_HEX}; } 50%, 100% { background-color: ${ALARM_OFF_HEX}; } }
    .blinking-row { animation: argus-blink 1s steps(2, jump-none) infinite; }
  </style>`;
  const script = `<script>
document.addEventListener('click', function (event) {
  var target = event.target.closest('[data-action="ack"]');
  if (!target) return;
  var id = target.getAttribute('data-alarm');
  fetch('/sim/alarms/' + id + '/ack', { method: 'POST' }).then(function () { location.reload(); });
});
</script>`;
  const body = `<h1 data-testid="page-title">${escapeHtml(t.alarmsTitle)}</h1>
  <table data-testid="alarms-table">
    <thead><tr><th>${escapeHtml(t.colAlarm)}</th><th>${escapeHtml(t.colConveyor)}</th><th>${escapeHtml(t.colRaised)}</th><th>${escapeHtml(t.colAck)}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>${script}`;
  return renderLayout({ title: t.alarmsTitle, t, locale, faults: [...faults], bodyHtml: body, extraHead: style });
}
