import type { Strings } from '../i18n.js';
import type { FaultName, SettingsFormValues } from '../types.js';
import { escapeAttr, escapeHtml } from './html.js';
import { renderLayout } from './layout.js';

export function renderSettingsPage(
  values: SettingsFormValues,
  faults: ReadonlySet<FaultName>,
  t: Strings,
  locale: 'en' | 'fr',
): string {
  const body = `<h1 data-testid="page-title">${escapeHtml(t.settingsTitle)}</h1>
  <form method="post" action="/settings" data-testid="settings-form">
    <p><label>${escapeHtml(t.settingsLabel)}<br/>
      <input type="text" name="label" data-testid="settings-label" value="${escapeAttr(values.label)}" />
    </label></p>
    <p><label>${escapeHtml(t.settingsThreshold)}<br/>
      <input type="number" name="threshold" data-testid="settings-threshold" value="${values.threshold}" />
    </label></p>
    <p><label>${escapeHtml(t.settingsMode)}<br/>
      <select name="mode" data-testid="settings-mode">
        <option value="auto" ${values.mode === 'auto' ? 'selected' : ''}>auto</option>
        <option value="manual" ${values.mode === 'manual' ? 'selected' : ''}>manual</option>
        <option value="maintenance" ${values.mode === 'maintenance' ? 'selected' : ''}>maintenance</option>
      </select>
    </label></p>
    <p><label>
      <input type="checkbox" name="notifyOnFault" data-testid="settings-notify" ${values.notifyOnFault ? 'checked' : ''} />
      ${escapeHtml(t.settingsNotify)}
    </label></p>
    <p><label>${escapeHtml(t.settingsAccessCode)}<br/>
      <input type="password" name="accessCode" data-testid="settings-access-code" value="${escapeAttr(values.accessCode)}" autocomplete="off" />
    </label></p>
    <p><button type="submit" data-testid="settings-submit">${escapeHtml(t.settingsSave)}</button></p>
  </form>`;
  return renderLayout({ title: t.settingsTitle, t, locale, faults: [...faults], bodyHtml: body });
}
