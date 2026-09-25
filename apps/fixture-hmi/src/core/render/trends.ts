import type { Strings } from '../i18n.js';
import type { FaultName, TrendPoint } from '../types.js';
import { escapeHtml } from './html.js';
import { renderLayout } from './layout.js';

const CHART_W = 600;
const CHART_H = 200;

function buildPath(points: readonly TrendPoint[]): string {
  if (points.length === 0) {
    return '';
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = CHART_W / Math.max(points.length - 1, 1);
  return points
    .map((point, index) => {
      const x = index * stepX;
      const y = CHART_H - ((point.value - min) / span) * (CHART_H - 20) - 10;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function renderTrendsPage(
  points: readonly TrendPoint[],
  faults: ReadonlySet<FaultName>,
  t: Strings,
  locale: 'en' | 'fr',
): string {
  const path = buildPath(points);
  const rows = points
    .map(
      (point, index) =>
        `<tr data-testid="trend-row-${index}"><td data-testid="trend-time-${index}">${(point.tMs / 1000).toFixed(1)}</td><td data-testid="trend-value-${index}">${point.value.toFixed(2)}</td></tr>`,
    )
    .join('\n');
  const body = `<h1 data-testid="page-title">${escapeHtml(t.trendsTitle)}</h1>
  <svg data-testid="trend-chart" width="${CHART_W}" height="${CHART_H}" viewBox="0 0 ${CHART_W} ${CHART_H}" xmlns="http://www.w3.org/2000/svg">
    <path d="${path}" fill="none" stroke="#2563eb" stroke-width="2" />
  </svg>
  <table data-testid="trend-table">
    <thead><tr><th>${escapeHtml(t.colTime)}</th><th>${escapeHtml(t.colValue)}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  return renderLayout({ title: t.trendsTitle, t, locale, faults: [...faults], bodyHtml: body });
}
