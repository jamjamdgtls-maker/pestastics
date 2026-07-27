/* ════════════════════════════════════════════════════════════════
   team-manager.js
   Manages the `teams` collection directly (not a config/settings
   array like list-manager.js), since each team doc carries a
   member/technician roster that Treatments cascades a dropdown from.
   Shared by Contracts and Treatments so a team added from either
   place shows up in both — this replaces the earlier split where
   Contracts read config/settings.teamsList while Treatments read this
   collection, which meant a team added in one place never appeared
   in the other.

   Usage:
     import { getTeamNames, openTeamManager } from './js/team-manager.js';
     openTeamManager({ onSaved: (teamNames) => { ...repopulate a <select>... } });
   ════════════════════════════════════════════════════════════════ */

import { db } from '../firebase-config.js';
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { invalidate, cachedGetDocs } from './firestore-cache.js';

/** Team names only, for populating a plain <select> — cached like any
 *  other collection read, shared cache key with Treatments' own load. */
export async function getTeamNames() {
  const teams = await cachedGetDocs(collection(db, 'teams'), 'teams');
  return [...new Set(teams.map(t => t.teamName).filter(Boolean))].sort();
}

let stylesInjected = false;
function injectStylesOnce() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .tm-overlay{position:fixed;inset:0;background:rgba(15,27,18,.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .tm-modal{background:#fff;border-radius:12px;width:100%;max-width:480px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 8px 24px rgba(0,0,0,.12)}
    .tm-header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #e5e7eb;font-weight:700;font-size:15px;color:#111827}
    .tm-close{background:none;border:none;font-size:20px;line-height:1;cursor:pointer;color:#9ca3af;padding:2px 6px}
    .tm-close:hover{color:#111827}
    .tm-body{padding:16px 18px;overflow-y:auto;flex:1}
    .tm-hint{font-size:12px;color:#9ca3af;margin-bottom:14px}
    .tm-add-box{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:16px}
    .tm-add-box input{width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:13.5px;margin-bottom:8px}
    .tm-add-box input:focus{outline:none;border-color:hsl(142,76%,36%)}
    .tm-btn-primary{background:hsl(142,76%,36%);color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:13.5px;font-weight:500;cursor:pointer}
    .tm-btn-primary:hover{background:hsl(142,76%,30%)}
    .tm-btn-secondary{background:none;border:1px solid #e5e7eb;color:#4b5563;border-radius:6px;padding:8px 14px;font-size:13.5px;cursor:pointer}
    .tm-team-card{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin-bottom:10px}
    .tm-team-name{width:100%;padding:6px 8px;border:1px solid transparent;border-radius:5px;font-size:13.5px;font-weight:600;background:transparent;margin-bottom:6px}
    .tm-team-name:focus{outline:none;border-color:hsl(142,76%,36%);background:#fff}
    .tm-team-members{width:100%;padding:6px 8px;border:1px solid transparent;border-radius:5px;font-size:12.5px;color:#4b5563;background:transparent}
    .tm-team-members:focus{outline:none;border-color:hsl(142,76%,36%);background:#fff}
    .tm-team-actions{display:flex;gap:6px;margin-top:8px}
    .tm-icon-btn{background:none;border:1px solid #e5e7eb;border-radius:5px;padding:5px 10px;cursor:pointer;font-size:12px;color:#4b5563}
    .tm-icon-btn:hover{background:#f8f9fa}
    .tm-delete-btn:hover{color:#dc2626;border-color:#fca5a5}
    .tm-save-btn:hover{color:hsl(142,76%,36%);border-color:hsl(142,76%,80%)}
    .tm-empty{color:#9ca3af;font-size:13px;padding:16px 0;text-align:center}
    .tm-footer{padding:12px 18px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end}
  `;
  document.head.appendChild(style);
}

/** Opens the team-management modal. onSaved(teamNames) fires after
 *  every add/rename/delete with the fresh name list, so the caller can
 *  repopulate its <select> immediately. */
export async function openTeamManager({ onSaved }) {
  injectStylesOnce();
  let teams = await getDocs(collection(db, 'teams')).then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));

  const overlay = document.createElement('div');
  overlay.className = 'tm-overlay';
  overlay.innerHTML = `
    <div class="tm-modal">
      <div class="tm-header"><span>Manage Teams</span><button class="tm-close" type="button">&times;</button></div>
      <div class="tm-body">
        <div class="tm-hint">Shared across every page that assigns a team — Contracts, Treatments, etc.</div>
        <div class="tm-add-box">
          <input type="text" class="tm-new-name" placeholder="New team name" />
          <input type="text" class="tm-new-members" placeholder="Technicians (comma-separated, optional)" />
          <button type="button" class="tm-btn-primary tm-add-btn">Add Team</button>
        </div>
        <div class="tm-list"></div>
      </div>
      <div class="tm-footer">
        <button type="button" class="tm-btn-secondary tm-cancel-btn">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const listEl = overlay.querySelector('.tm-list');

  function renderList() {
    listEl.innerHTML = teams.length
      ? teams.map((t, i) => `
        <div class="tm-team-card" data-i="${i}">
          <input type="text" class="tm-team-name" value="${String(t.teamName || '').replace(/"/g, '&quot;')}" placeholder="Team name" />
          <input type="text" class="tm-team-members" value="${(t.members || t.technicians || []).join(', ').replace(/"/g, '&quot;')}" placeholder="Technicians (comma-separated)" />
          <div class="tm-team-actions">
            <button type="button" class="tm-icon-btn tm-save-btn">Save</button>
            <button type="button" class="tm-icon-btn tm-delete-btn">Delete</button>
          </div>
        </div>`).join('')
      : `<div class="tm-empty">No teams yet — add one above.</div>`;

    listEl.querySelectorAll('.tm-save-btn').forEach(btn => btn.addEventListener('click', async () => {
      const card = btn.closest('.tm-team-card');
      const i = Number(card.dataset.i);
      const teamName = card.querySelector('.tm-team-name').value.trim();
      const members = card.querySelector('.tm-team-members').value.split(',').map(s => s.trim()).filter(Boolean);
      if (!teamName) return;
      try {
        await updateDoc(doc(db, 'teams', teams[i].id), { teamName, members });
        teams[i] = { ...teams[i], teamName, members };
        await persist();
      } catch (err) {
        alert('Could not save this team: ' + err.message);
      }
    }));
    listEl.querySelectorAll('.tm-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
      const card = btn.closest('.tm-team-card');
      const i = Number(card.dataset.i);
      if (!confirm(`Remove team "${teams[i].teamName}"? Past treatments/contracts keep the team name they already have.`)) return;
      try {
        await deleteDoc(doc(db, 'teams', teams[i].id));
        teams.splice(i, 1);
        await persist();
      } catch (err) {
        alert('Could not delete this team — only a super admin can delete teams. (' + err.message + ')');
      }
    }));
  }

  async function persist() {
    invalidate('teams');
    renderList();
    if (onSaved) onSaved([...new Set(teams.map(t => t.teamName).filter(Boolean))].sort());
  }

  overlay.querySelector('.tm-add-btn').addEventListener('click', async () => {
    const nameInput = overlay.querySelector('.tm-new-name');
    const membersInput = overlay.querySelector('.tm-new-members');
    const teamName = nameInput.value.trim();
    if (!teamName) return;
    if (teams.some(t => (t.teamName || '').toLowerCase() === teamName.toLowerCase())) { nameInput.value = ''; return; }
    const members = membersInput.value.split(',').map(s => s.trim()).filter(Boolean);
    try {
      const ref = await addDoc(collection(db, 'teams'), { teamName, members });
      teams.push({ id: ref.id, teamName, members });
      nameInput.value = ''; membersInput.value = '';
      await persist();
    } catch (err) {
      alert('Could not add this team: ' + err.message);
    }
  });

  function close() { overlay.remove(); }
  overlay.querySelector('.tm-close').addEventListener('click', close);
  overlay.querySelector('.tm-cancel-btn').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  renderList();
}
