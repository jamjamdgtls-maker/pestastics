/* ════════════════════════════════════════════════════════════════
   router.js
   Every route name maps to either:
     - a built-in view already sitting in index.html's DOM
       (login, register, pending, admin, dashboard, forbidden), or
     - a lazy view registered here, fetched from its own HTML file
       the first time it's visited, then left mounted (hidden) in
       #view-mount for every visit after that — no re-fetch, no
       re-running its <script type="module">, no duplicate listeners.

   Convention every lazy-view file must follow: exactly one top-level
   <div data-view="name" id="view-name">...</div>, plus its own <style>
   and <script type="module"> tags alongside it. See clients.html /
   contracts.html for the pattern. Add a new module by adding one line
   to LAZY_VIEWS below.
   ════════════════════════════════════════════════════════════════ */

const LAZY_VIEWS = {
  clients: 'clients.html',
  contracts: 'contracts.html',
  treatments: 'treatments.html',
  payments: 'payments.html',
  renewals: 'renewals.html',
  complaints: 'complaints.html',
  inspections: 'inspections.html',
  overdue: 'overdue.html',
  calendar: 'calendar.html',
  'report-daily-schedule': 'report-daily-schedule.html',
  'report-monthly-collection': 'report-monthly-collection.html'
};

const mountedLazyViews = new Set();

export function isLazyView(name) {
  return Object.prototype.hasOwnProperty.call(LAZY_VIEWS, name);
}

export function isKnownView(name) {
  return isLazyView(name) || !!document.querySelector(`[data-view="${name}"]`);
}

function hideAllViews() {
  document.querySelectorAll('[data-view]').forEach(v => v.classList.remove('active'));
}

function setLoading(show) {
  let el = document.getElementById('router-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'router-loading';
    el.className = 'router-loading';
    el.innerHTML = '<div class="router-loading-spinner"></div>';
    document.body.appendChild(el);
  }
  el.style.display = show ? 'flex' : 'none';
}

function renderLoadError(name, path, message) {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-view', name);
  wrapper.id = `view-${name}`;
  wrapper.innerHTML = `
    <div class="wrap narrow">
      <h1>Couldn't load this page.</h1>
      <p class="sub">"${path}" failed to load (${message}). Check your connection, then try navigating here again.</p>
    </div>`;
  document.getElementById('view-mount').appendChild(wrapper);
}

/* Fetches a module's HTML file once, then:
     1. appends its <style> blocks to <head>, tagged so re-navigation
        never duplicates them
     2. moves its own top-level [data-view] element (every module file
        is expected to have exactly one) into #view-mount as-is — the
        existing show/hide convention just works because the module
        already wrote its markup with that attribute
     3. recreates its <script> tags as real elements — script content
        injected via innerHTML never executes, so this step is required
        for the module's own logic to actually run */
async function fetchAndMount(name) {
  const path = LAZY_VIEWS[name];
  setLoading(true);
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    doc.querySelectorAll('style').forEach((styleEl, i) => {
      const tag = document.createElement('style');
      tag.setAttribute('data-view-style', `${name}-${i}`);
      tag.textContent = styleEl.textContent;
      document.head.appendChild(tag);
    });

    const mount = document.getElementById('view-mount');
    Array.from(doc.body.children).forEach(node => {
      if (node.tagName === 'SCRIPT') return; // scripts are handled below
      mount.appendChild(document.importNode(node, true));
    });

    if (!document.querySelector(`[data-view="${name}"]`)) {
      console.warn(`[router] "${path}" loaded but has no top-level [data-view="${name}"] element — it won't be shown.`);
    }

    doc.querySelectorAll('script').forEach(oldScript => {
      const newScript = document.createElement('script');
      for (const attr of oldScript.attributes) newScript.setAttribute(attr.name, attr.value);
      if (oldScript.textContent) newScript.textContent = oldScript.textContent;
      document.body.appendChild(newScript);
    });

    mountedLazyViews.add(name);
  } catch (err) {
    console.error(`[router] failed to load view "${name}" (${path}):`, err);
    renderLoadError(name, path, err.message);
    mountedLazyViews.add(name); // don't hammer a dead file on every hashchange
  } finally {
    setLoading(false);
  }
}

/** Ensure `name` is mounted (fetching it the first time if it's a lazy
 *  view) and show it, hiding every other view. Falls back to the
 *  "notfound" built-in view for anything unrecognized. */
export async function showView(name) {
  if (isLazyView(name) && !mountedLazyViews.has(name)) {
    await fetchAndMount(name);
  }
  hideAllViews();
  const el = document.querySelector(`[data-view="${name}"]`);
  if (el) {
    el.classList.add('active');
    window.dispatchEvent(new CustomEvent('router:view-shown', { detail: { name } }));
    return el;
  }
  const nf = document.querySelector('[data-view="notfound"]');
  if (nf) nf.classList.add('active');
  window.dispatchEvent(new CustomEvent('router:view-shown', { detail: { name: 'notfound' } }));
  return null;
}

/** Broadcasts the resolved, approved profile to every mounted (and
 *  not-yet-mounted) module. Modules read window.__pcProfile on load
 *  in case it's already set, and listen for "pc:profile" for updates —
 *  see clients.html / contracts.html for the receiving side. */
export function setProfile(profile) {
  window.__pcProfile = profile;
  window.dispatchEvent(new CustomEvent('pc:profile', { detail: profile }));
}

/** Lets a module file register further lazy views if the project grows
 *  a plugin-style structure later; not required for normal use. */
export function registerLazyView(name, path) {
  LAZY_VIEWS[name] = path;
}
