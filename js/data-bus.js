/* ════════════════════════════════════════════════════════════════
   data-bus.js
   Cross-module live-refresh registry. A module calls registerModuleSync
   once to say "reload me whenever any of these cache keys change,
   anywhere in the app" — not just when the person navigates back to
   this module (that's already handled per-module by the
   router:view-shown pattern used throughout the app), but immediately,
   while it's sitting mounted-but-inactive in the background.

   The signal comes from js/firestore-cache.js: every invalidate() call
   (which every write in the app already goes through, directly or via
   the smart*Doc wrappers) now also dispatches a pc:cache-invalidated
   event with the keys that just went stale. This module just fans that
   out to whoever registered interest in those specific keys.

   Usage:
     import { registerModuleSync } from './js/data-bus.js';
     registerModuleSync({
       view: 'report-client-soa',   // for your own debugging/logging only
       keys: ['clients', 'config:settings'],
       isReady: () => reportInitialized, // don't reload before first mount
       reload: () => loadRefData()
     });
   ════════════════════════════════════════════════════════════════ */

const subscribers = new Map(); // view name -> { keys: Set, isReady, reload }

/** Register (or replace) a module's live-refresh subscription. */
export function registerModuleSync({ view, keys, isReady, reload }) {
  if (!view || typeof reload !== 'function') {
    throw new Error('registerModuleSync requires at least { view, reload }');
  }
  subscribers.set(view, { keys: new Set(keys || []), isReady: isReady || (() => true), reload });
}

/** Drop a module's subscription — not currently needed anywhere (mounted
 *  modules stay mounted for the life of the app), but here for symmetry
 *  and in case a future module needs to unsubscribe conditionally. */
export function unregisterModuleSync(view) {
  subscribers.delete(view);
}

window.addEventListener('pc:cache-invalidated', e => {
  const changedKeys = e.detail?.keys || [];
  if (!changedKeys.length) return;
  subscribers.forEach((sub, view) => {
    try {
      if (!sub.isReady()) return; // not mounted/initialized yet — its own first load will already read fresh data
      if (!changedKeys.some(k => sub.keys.has(k))) return; // not a key this module cares about
      sub.reload();
    } catch (err) {
      console.error(`[data-bus] live-refresh failed for "${view}":`, err);
    }
  });
});
