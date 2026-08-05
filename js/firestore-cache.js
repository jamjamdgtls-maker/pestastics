/* ════════════════════════════════════════════════════════════════
   firestore-cache.js
   Shared in-memory read cache + "smart write" wrappers, used by every
   module (Clients, Contracts, and whatever gets built next).

   Rule of thumb for callers:
     - Read a collection through cachedGetDocs/cachedGetDoc with an
       explicit cacheKey. The first read per session hits Firestore;
       every read after that (including on repeat page visits, since
       modules stay mounted once loaded) is served from memory.
     - After a write, prefer patchCachedDoc/addCachedDoc/removeCachedDoc
       to update the cache in place — zero extra reads. Fall back to
       invalidate() when the write's effect on the list is too complex
       to patch by hand (e.g. a value that depends on other documents).
   ════════════════════════════════════════════════════════════════ */

import {
  getDocs, getDoc, addDoc, updateDoc, deleteDoc, setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const cache = new Map(); // cacheKey -> Promise<data>

/** Read a query's docs, cached under `cacheKey`. Returns [{id, ...data}]. */
export async function cachedGetDocs(query, cacheKey) {
  if (!cacheKey) throw new Error('cachedGetDocs requires an explicit cacheKey');
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const promise = getDocs(query).then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
  cache.set(cacheKey, promise);
  // A failed read must not poison the cache for the rest of the session.
  // `cache` is a shared singleton across every mounted module, so a
  // rejected promise left in place here would be inherited by every
  // future caller for this key — app-wide — with no way to recover
  // short of a full page reload. Evict on failure so the next caller
  // (a retry, a re-visit, a data-bus reload) gets a fresh attempt.
  promise.catch(() => { if (cache.get(cacheKey) === promise) cache.delete(cacheKey); });
  return promise;
}

/** Read a single doc, cached under `cacheKey`. Returns {id, ...data} | null. */
export async function cachedGetDoc(ref, cacheKey) {
  if (!cacheKey) throw new Error('cachedGetDoc requires an explicit cacheKey');
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const promise = getDoc(ref).then(snap => (snap.exists() ? { id: snap.id, ...snap.data() } : null));
  cache.set(cacheKey, promise);
  // Same self-eviction on failure as cachedGetDocs above — see comment there.
  promise.catch(() => { if (cache.get(cacheKey) === promise) cache.delete(cacheKey); });
  return promise;
}

/* ── Change broadcasting ──
   Every write path in the app already invalidates the keys it touched,
   so invalidate() is the one choke point that knows "something in this
   collection just changed". It fans that out as a single debounced
   `pc:data-changed` event, which js/data-bus.js turns into live reloads
   of every affected module — that's what removes the need to refresh
   the browser after a create/edit/delete. */
const DERIVED_KEYS = {
  contracts: ['contracts:active'],
  complaints: ['complaints:open'],
  audit_log: ['audit_log:recent', 'audit_log:recent500'],
  users: ['users:approved']
};

let suppressDepth = 0;
let pendingKeys = new Set();
let flushScheduled = false;

function scheduleBroadcast(keys) {
  keys.forEach(k => pendingKeys.add(k));
  if (flushScheduled) return;
  flushScheduled = true;
  // Debounced to one event per turn, so a write that invalidates six
  // keys reloads each listening module once, not six times.
  setTimeout(() => {
    flushScheduled = false;
    const detailKeys = Array.from(pendingKeys);
    pendingKeys = new Set();
    if (!detailKeys.length || suppressDepth > 0) return;
    window.dispatchEvent(new CustomEvent('pc:data-changed', { detail: { keys: detailKeys } }));
  }, 0);
}

/** Run fn with change broadcasting turned off — used by the data bus
 *  while it reloads a module, so a reload can't trigger more reloads. */
export async function withSyncSuppressed(fn) {
  suppressDepth++;
  try { return await fn(); }
  finally { suppressDepth--; }
}

/** Drop one or more cache entries — next read for those keys hits
 *  Firestore again — then tell the rest of the app what changed. */
export function invalidate(...cacheKeys) {
  const all = [];
  cacheKeys.forEach(k => {
    all.push(k);
    (DERIVED_KEYS[k] || []).forEach(d => all.push(d));
  });
  all.forEach(k => cache.delete(k));
  if (all.length) scheduleBroadcast(all);
}


/** Merge a field patch into an already-cached array doc, no refetch. */
export function patchCachedDoc(cacheKey, docId, patch) {
  const cached = cache.get(cacheKey);
  if (!cached) return;
  cache.set(cacheKey, Promise.resolve(cached).then(data =>
    Array.isArray(data) ? data.map(d => (d.id === docId ? { ...d, ...patch } : d)) : data
  ));
}

/** Remove a doc from an already-cached array, no refetch. */
export function removeCachedDoc(cacheKey, docId) {
  const cached = cache.get(cacheKey);
  if (!cached) return;
  cache.set(cacheKey, Promise.resolve(cached).then(data =>
    Array.isArray(data) ? data.filter(d => d.id !== docId) : data
  ));
}

/** Append a doc to an already-cached array, no refetch. */
export function addCachedDoc(cacheKey, docWithId) {
  const cached = cache.get(cacheKey);
  if (!cached) return;
  cache.set(cacheKey, Promise.resolve(cached).then(data =>
    (Array.isArray(data) ? [...data, docWithId] : data)
  ));
}

/* ── Smart write wrappers: do the write, then invalidate whatever the
      caller says the write affects. Simplest correct default — use the
      patch/remove/add helpers above instead when you already have the
      exact shape of the change and want to skip the refetch. ── */

export async function smartAddDoc(colRef, data, cacheKeysToInvalidate = []) {
  const ref = await addDoc(colRef, data);
  invalidate(...cacheKeysToInvalidate);
  return ref;
}

export async function smartUpdateDoc(docRef, data, cacheKeysToInvalidate = []) {
  await updateDoc(docRef, data);
  invalidate(...cacheKeysToInvalidate);
}

export async function smartDeleteDoc(docRef, cacheKeysToInvalidate = []) {
  await deleteDoc(docRef);
  invalidate(...cacheKeysToInvalidate);
}

export async function smartSetDoc(docRef, data, options, cacheKeysToInvalidate = []) {
  await setDoc(docRef, data, options);
  invalidate(...cacheKeysToInvalidate);
}
