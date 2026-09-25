import type { Strings } from '../i18n.js';
import type { FaultName } from '../types.js';
import { escapeHtml } from './html.js';
import { renderLayout } from './layout.js';

export function renderModalPage(faults: ReadonlySet<FaultName>, t: Strings, locale: 'en' | 'fr'): string {
  const body = `<h1 data-testid="page-title">${escapeHtml(t.modalTitle)}</h1>
  <button type="button" data-testid="open-modal">${escapeHtml(t.modalOpen)}</button>
  <dialog data-testid="modal-dialog">
    <p data-testid="modal-body">${escapeHtml(t.modalBody)}</p>
    <button type="button" data-testid="modal-close">${escapeHtml(t.modalClose)}</button>
    <button type="button" data-testid="modal-confirm">${escapeHtml(t.modalConfirm)}</button>
  </dialog>
  <script>
    var dialog = document.querySelector('[data-testid="modal-dialog"]');
    document.querySelector('[data-testid="open-modal"]').addEventListener('click', function () { dialog.showModal(); });
    document.querySelector('[data-testid="modal-close"]').addEventListener('click', function () { dialog.close(); });
    document.querySelector('[data-testid="modal-confirm"]').addEventListener('click', function () { dialog.close(); });
  </script>`;
  return renderLayout({ title: t.modalTitle, t, locale, faults: [...faults], bodyHtml: body });
}
