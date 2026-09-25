/**
 * Pure HTML string helpers. Nothing here performs I/O, reads a clock or calls
 * `Math.random`; every render function is a total function of its arguments.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value);
}

/** Indicator colours, chosen to sit far from the other seven ARGUS palette names. */
export const INDICATOR_HEX: Record<'grey' | 'green' | 'red' | 'amber', string> = {
  grey: '#9ca3af',
  green: '#16a34a',
  red: '#dc2626',
  amber: '#d97706',
};

export const ALARM_ON_HEX = '#dc2626';
export const ALARM_OFF_HEX = '#ffffff';

/**
 * Shared by every client script that starts a conveyor and then reloads to show the
 * result: Start's effect is delayed (`START_DELAY_MS` of simulator time), so reloading
 * right after the POST still shows the pending, amber state. `pollThenReload` instead
 * polls `/sim/state` until the conveyor is no longer pending (resolved to Running, or
 * left in place by a fault such as `wrong-state`) before reloading, up to a bound so a
 * fault that never resolves it (`no-effect`) still reloads once and shows its own state.
 * Originally written for the conveyors table only (round 2); the SVG synoptic's click
 * handler called `location.reload()` immediately instead and was missed, so a healthy
 * `start` click there still showed amber for `START_DELAY_MS` (round 3 review).
 */
export const POLL_THEN_RELOAD_SCRIPT = `
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
}`;
