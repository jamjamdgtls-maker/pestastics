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
  return promise;
}

/** Read a single doc, cached under `cacheKey`. Returns {id, ...data} | null. */
export async function cachedGetDoc(ref, cacheKey) {
  if (!cacheKey) throw new Error('cachedGetDoc requires an explicit cacheKey');
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const promise = getDoc(ref).then(snap => (snap.exists() ? { id: snap.id, ...snap.data() } : null));
  cache.set(cacheKey, promise);
  return promise;
}

/** Drop one or more cache entries — next read for those keys hits Firestore again. */
export function invalidate(...cacheKeys) {
  cacheKeys.forEach(k => cache.delete(k));
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
