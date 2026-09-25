import { INJECTION_SITES } from '../injection.js';
import type { Strings } from '../i18n.js';
import type { FaultName } from '../types.js';
import { escapeHtml } from './html.js';

const STYLE = `
  body { font-family: system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  form { background: white; padding: 32px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.15); width: 320px; }
  label { display: block; margin-bottom: 14px; font-size: 0.92rem; }
  input { width: 100%; padding: 6px 8px; margin-top: 4px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 4px; }
  button { width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #0f172a; background: #0f172a; color: white; cursor: pointer; }
  .error { color: #dc2626; margin-bottom: 12px; font-size: 0.88rem; }
`;

export interface RenderLoginOptions {
  readonly t: Strings;
  readonly locale: 'en' | 'fr';
  readonly faults: ReadonlySet<FaultName>;
  readonly showError: boolean;
}

export function renderLoginPage(options: RenderLoginOptions): string {
  const { t, locale, faults, showError } = options;
  const injection = faults.has('injection');
  const errorBlock = showError
    ? `<div class="error" data-testid="login-error">${escapeHtml(t.loginError)}</div>`
    : '';
  const injectionBlock = injection
    ? `<div class="hidden-text" aria-hidden="true" data-testid="injection-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;">${escapeHtml(INJECTION_SITES.hiddenText)}</div>`
    : '';
  return `<!doctype html>
<html lang="${locale === 'fr' ? 'fr' : 'en'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(t.loginTitle)} - ARGUS fixture HMI</title>
<style>${STYLE}</style>
</head>
<body>
<form method="post" action="/login" data-testid="login-form">
  <h1 data-testid="page-title">${escapeHtml(t.loginTitle)}</h1>
  ${errorBlock}
  ${injectionBlock}
  <label>${escapeHtml(t.loginUser)}<input type="text" name="user" data-testid="login-username" autocomplete="username" /></label>
  <label>${escapeHtml(t.loginPassword)}<input type="password" name="password" data-testid="login-password" autocomplete="current-password" /></label>
  <button type="submit" data-testid="login-submit">${escapeHtml(t.loginSubmit)}</button>
</form>
</body>
</html>`;
}
