/* ════════════════════════════════════════════════════════════════
   js/data-bus.js
   Cross-module live sync.

   The problem this solves: every module keeps its own in-memory copy
   of the collections it renders, filled once through firestore-cache.
   A contract created in Contracts used to leave Treatments, Payments,
   Renewals, SOA and the Dashboard showing yesterday's numbers until
   the browser was refreshed by hand.

   How it works now:
     1. firestore-cache.invalidate() (which every write path already
        calls) drops the affected cache keys and then broadcasts a
        single debounced `pc:data-changed` event.
     2. Every module registers itself here once, declaring the cache
        keys it renders and how to reload itself.
     3. On a change the visible module reloads immediately; hidden
        modules are flagged dirty and reload the instant they're shown.

   No module ever needs a Refresh button, and no CRUD operation needs
   a page reload to become visible everywhere else.
   ════════════════════════════════════════════════════════════════ */

import { invalidate, withSyncSuppressed } from './firestore-cache.js';

const registrations = [];

function currentRoute() {
  return (window.location.hash || '#dashboard').slice(1);
}

/** Register a module with the bus.
 *  view    – the [data-view] name this module renders as
 *  keys    – cache keys the module reads (used both to decide
 *            relevance and to invalidate before a reload)
 *  isReady – () => boolean, true once the module has finished its
 *            first load (so we never reload a half-built module)
 *  reload  – () => void|Promise, re-reads and re-renders everything
 */
export function registerModuleSync({ view, keys = [], isReady = () => true, reload }) {
  if (typeof reload !== 'function') throw new Error('registerModuleSync needs a reload()');
  const entry = { view, keys, isReady, reload, dirty: false };
  registrations.push(entry);

  // Shown again after being hidden → flush any change that landed
  // while we weren't looking.
  window.addEventListener('router:view-shown', e => {
    if (e.detail?.name !== view) return;
    if (!entry.isReady()) return;
    runReload(entry);
  });

  return entry;
}

async function runReload(entry) {
  entry.dirty = false;
  try {
    // Reloading re-reads Firestore on purpose; suppressing the bus
    // while we do it keeps one change from bouncing between modules.
    await withSyncSuppressed(async () => {
      invalidate(...entry.keys);
      await entry.reload();
    });
  } catch (err) {
    console.error(`[data-bus] reload failed for "${entry.view}"`, err);
  }
}

window.addEventListener('pc:data-changed', e => {
  const changed = e.detail?.keys || [];
  const active = currentRoute();
  registrations.forEach(entry => {
    const relevant = !entry.keys.length || entry.keys.some(k => changed.includes(k));
    if (!relevant) return;
    if (!entry.isReady()) return;
    if (entry.view === active) runReload(entry);
    else entry.dirty = true; // picked up by router:view-shown
  });
});

/** Explicit broadcast for callers that wrote through something other
 *  than the cache helpers (rare — prefer invalidate()). */
export function notifyDataChanged(...keys) {
  invalidate(...keys);
}
