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
