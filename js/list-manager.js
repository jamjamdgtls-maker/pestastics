/* ════════════════════════════════════════════════════════════════
   list-manager.js
   A small, self-contained "manage this dropdown's options" modal,
   shared by every module that has a settings-backed list (Contract
   Type, Treatment Method, Assigned Team, Sales Agent, Communication
   Source, ...). All of these live as array fields on the single
   config/settings doc, so two modules editing "the same" list (e.g.
   Sales Agent in both Clients and Contracts) really are sharing one
   list — add it from either module and it shows up in both.

   This module builds its own modal DOM and injects its own <style>
   (once) rather than relying on the host module's scoped CSS, since
   it doesn't know which module it's being called from.

   Usage:
     import { openListManager } from './js/list-manager.js';
     openListManager({
       fieldName: 'salesAgents',
       title: 'Manage Sales Agents',
       onSaved: (items) => { ...repopulate a <select> with `items`... }
     });
   ════════════════════════════════════════════════════════════════ */

import { db } from '../firebase-config.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { cachedGetDoc, invalidate } from './firestore-cache.js';

const SETTINGS_PATH = () => doc(db, 'config', 'settings');

/** Reads one array field off the shared config/settings doc (via the
 *  same cache every module uses), falling back to []. */
export async function getSettingsList(fieldName) {
  let cfg = null;
  try { cfg = await cachedGetDoc(SETTINGS_PATH(), 'config:settings'); } catch {}
  return (cfg && Array.isArray(cfg[fieldName])) ? cfg[fieldName] : [];
}

/** Writes a whole array field back to config/settings and invalidates
 *  the shared cache so every module's next read picks up the change. */
async function saveSettingsList(fieldName, items) {
  await setDoc(SETTINGS_PATH(), { [fieldName]: items }, { merge: true });
  invalidate('config:settings');
}

let stylesInjected = false;
function injectStylesOnce() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .lm-overlay{position:fixed;inset:0;background:rgba(15,27,18,.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .lm-modal{background:#fff;border-radius:12px;width:100%;max-width:420px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 24px rgba(0,0,0,.12)}
    .lm-header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #e5e7eb;font-weight:700;font-size:15px;color:#111827}
    .lm-close{background:none;border:none;font-size:20px;line-height:1;cursor:pointer;color:#9ca3af;padding:2px 6px}
    .lm-close:hover{color:#111827}
    .lm-body{padding:16px 18px;overflow-y:auto;flex:1}
    .lm-add-row{display:flex;gap:8px;margin-bottom:14px}
    .lm-input{flex:1;padding:8px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:13.5px}
    .lm-input:focus{outline:none;border-color:hsl(142,76%,36%)}
    .lm-btn-primary{background:hsl(142,76%,36%);color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:13.5px;font-weight:500;cursor:pointer;white-space:nowrap}
    .lm-btn-primary:hover{background:hsl(142,76%,30%)}
    .lm-btn-secondary{background:none;border:1px solid #e5e7eb;color:#4b5563;border-radius:6px;padding:8px 14px;font-size:13.5px;cursor:pointer}
    .lm-row{display:flex;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid #f1f3f5}
    .lm-row-input{flex:1;padding:6px 8px;border:1px solid transparent;border-radius:5px;font-size:13px;background:transparent}
    .lm-row-input:focus{outline:none;border-color:hsl(142,76%,36%);background:#fff}
    .lm-icon-btn{background:none;border:1px solid #e5e7eb;border-radius:5px;width:28px;height:28px;cursor:pointer;font-size:13px;color:#4b5563;flex-shrink:0}
    .lm-icon-btn:hover{background:#f8f9fa}
    .lm-delete-row:hover{color:#dc2626;border-color:#fca5a5}
    .lm-save-row:hover{color:hsl(142,76%,36%);border-color:hsl(142,76%,80%)}
    .lm-empty{color:#9ca3af;font-size:13px;padding:16px 0;text-align:center}
    .lm-footer{padding:12px 18px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end}
    .lm-hint{font-size:12px;color:#9ca3af;margin-bottom:10px}
  `;
  document.head.appendChild(style);
}

/** Opens the manage-list modal for one config/settings array field.
 *  onSaved(items) fires after every add/edit/delete with the fresh
 *  array, so the caller can repopulate its <select> immediately. */
export async function openListManager({ fieldName, title, onSaved }) {
  injectStylesOnce();
  let items = (await getSettingsList(fieldName)).slice();

  const overlay = document.createElement('div');
  overlay.className = 'lm-overlay';
  overlay.innerHTML = `
    <div class="lm-modal">
      <div class="lm-header"><span>${title}</span><button class="lm-close" type="button">&times;</button></div>
      <div class="lm-body">
        <div class="lm-hint">Shared across every page that uses this list.</div>
        <div class="lm-add-row">
          <input type="text" class="lm-input" placeholder="Add new item…" />
          <button class="lm-btn-primary lm-add-btn" type="button">Add</button>
        </div>
        <div class="lm-list"></div>
      </div>
      <div class="lm-footer">
        <button class="lm-btn-secondary lm-cancel-btn" type="button">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const listEl = overlay.querySelector('.lm-list');
  const input = overlay.querySelector('.lm-input');

  function renderList() {
    listEl.innerHTML = items.length
      ? items.map((it, i) => `
        <div class="lm-row" data-i="${i}">
          <input type="text" class="lm-row-input" value="${String(it).replace(/"/g, '&quot;')}" />
          <button class="lm-icon-btn lm-save-row" type="button" title="Save change">✓</button>
          <button class="lm-icon-btn lm-delete-row" type="button" title="Delete">✕</button>
        </div>`).join('')
      : `<div class="lm-empty">No items yet — add one above.</div>`;

    listEl.querySelectorAll('.lm-save-row').forEach(btn => btn.addEventListener('click', async () => {
      const row = btn.closest('.lm-row');
      const i = Number(row.dataset.i);
      const val = row.querySelector('.lm-row-input').value.trim();
      if (!val) return;
      items[i] = val;
      await persist();
    }));
    listEl.querySelectorAll('.lm-delete-row').forEach(btn => btn.addEventListener('click', async () => {
      const row = btn.closest('.lm-row');
      const i = Number(row.dataset.i);
      if (!confirm(`Remove "${items[i]}" from this list?`)) return;
      items.splice(i, 1);
      await persist();
    }));
  }

  async function persist() {
    await saveSettingsList(fieldName, items);
    renderList();
    if (onSaved) onSaved(items.slice());
  }

  overlay.querySelector('.lm-add-btn').addEventListener('click', async () => {
    const val = input.value.trim();
    if (!val) return;
    if (items.some(x => String(x).toLowerCase() === val.toLowerCase())) { input.value = ''; return; }
    items.push(val);
    input.value = '';
    await persist();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') overlay.querySelector('.lm-add-btn').click(); });

  function close() { overlay.remove(); }
  overlay.querySelector('.lm-close').addEventListener('click', close);
  overlay.querySelector('.lm-cancel-btn').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  renderList();
  input.focus();
}
