import { INJECTION_SITES } from '../injection.js';
import type { Strings } from '../i18n.js';
import type { FaultName } from '../types.js';
import { escapeAttr, escapeHtml } from './html.js';

export interface NavItem {
  readonly href: string;
  readonly testid: string;
  readonly label: string;
}

function navItems(t: Strings): NavItem[] {
  return [
    { href: '/conveyors', testid: 'nav-conveyors', label: t.navConveyors },
    { href: '/synoptic/svg', testid: 'nav-synoptic-svg', label: t.navSynopticSvg },
    { href: '/synoptic/canvas', testid: 'nav-synoptic-canvas', label: t.navSynopticCanvas },
    { href: '/alarms', testid: 'nav-alarms', label: t.navAlarms },
    { href: '/trends', testid: 'nav-trends', label: t.navTrends },
    { href: '/settings', testid: 'nav-settings', label: t.navSettings },
    { href: '/modal', testid: 'nav-modal', label: t.navModal },
  ];
}

const BASE_STYLE = `
  :root { color-scheme: light; }
  body { font-family: system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
  header.top { background: #0f172a; color: white; padding: 12px 20px; display: flex; align-items: center; gap: 20px; }
  header.top .brand { font-weight: 700; font-size: 1.1rem; }
  nav.main a { color: #cbd5e1; text-decoration: none; margin-right: 16px; font-size: 0.95rem; }
  nav.main a:hover, nav.main a:focus { color: white; }
  main { padding: 20px; max-width: 1100px; margin: 0 auto; }
  table { border-collapse: collapse; width: 100%; background: white; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; font-size: 0.92rem; }
  th { background: #f1f5f9; }
  .indicator { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  button { cursor: pointer; border: 1px solid #cbd5e1; background: white; padding: 4px 10px; border-radius: 4px; font-size: 0.88rem; }
  button:hover { background: #f1f5f9; }
  .toast { background: #fee2e2; border: 1px solid #dc2626; color: #7f1d1d; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; }
  .hidden-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .overlay .box { background: white; padding: 24px 28px; border-radius: 8px; max-width: 360px; text-align: center; }
`;

export interface LayoutOptions {
  readonly title: string;
  readonly t: Strings;
  readonly locale: 'en' | 'fr';
  readonly faults: readonly FaultName[];
  readonly bodyHtml: string;
  /** Renders a blocking overlay over the page content; only `/conveyors` sets this. */
  readonly blockingModal?: boolean;
  readonly extraHead?: string;
}

export function renderLayout(options: LayoutOptions): string {
  const { title, t, locale, faults, bodyHtml, blockingModal = false, extraHead = '' } = options;
  const injection = faults.includes('injection');
  const errorToast = faults.includes('error-toast');
  const items = navItems(t);
  const nav = items
    .map(
      (item) =>
        `<a href="${escapeAttr(item.href)}" data-testid="${escapeAttr(item.testid)}">${escapeHtml(item.label)}</a>`,
    )
    .join('');
  const toast = errorToast
    ? `<div class="toast" data-testid="toast-error" role="alert">${escapeHtml(t.errorToast)}${
        injection ? ` <span data-testid="toast-injection">${escapeHtml(INJECTION_SITES.toast)}</span>` : ''
      }</div>`
    : injection
      ? `<div class="toast" data-testid="toast-injection" role="alert">${escapeHtml(INJECTION_SITES.toast)}</div>`
      : '';
  const injectionBlock = injection
    ? `<p data-testid="injection-visible">${escapeHtml(INJECTION_SITES.visible)}</p>` +
      `<div class="hidden-text" aria-hidden="true" data-testid="injection-hidden">${escapeHtml(INJECTION_SITES.hiddenText)}</div>` +
      `<button type="button" data-testid="injection-aria" aria-label="${escapeAttr(INJECTION_SITES.ariaLabel)}">i</button>` +
      `<img data-testid="injection-alt" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7" alt="${escapeAttr(INJECTION_SITES.altText)}" />`
    : '';
  const overlay = blockingModal
    ? `<div class="overlay" data-testid="blocking-modal-overlay" role="dialog" aria-modal="true">
        <div class="box">
          <h2 data-testid="blocking-modal-title">${escapeHtml(t.blockingModalTitle)}</h2>
          <p data-testid="blocking-modal-body">${escapeHtml(t.blockingModalBody)}</p>
        </div>
      </div>`
    : '';
  return `<!doctype html>
<html lang="${locale === 'fr' ? 'fr' : 'en'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} - ARGUS fixture HMI</title>
<style>${BASE_STYLE}</style>
${extraHead}
</head>
<body>
<header class="top">
  <span class="brand" data-testid="brand">ARGUS Fixture HMI</span>
  <nav class="main" data-testid="main-nav">${nav}</nav>
  <a href="/logout" data-testid="nav-logout" style="margin-left:auto;color:#cbd5e1;">${escapeHtml(t.navLogout)}</a>
</header>
<main data-testid="page-main">
${toast}
${injectionBlock}
${bodyHtml}
</main>
${overlay}
</body>
</html>`;
}
