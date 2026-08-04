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

import { PERMISSION_MODULE_KEYS } from './permissions.js';

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
  'report-monthly-collection': 'report-monthly-collection.html',
  'report-service': 'report-service.html',
  'report-overdue-treatments': 'report-overdue-treatments.html',
  'report-client-soa': 'report-client-soa.html',
  admin: 'user-management.html',
  'audit-log': 'audit-log.html'
};

const mountedLazyViews = new Set();

/* Every route's tab title, "Pestastic - <Page>" — includes both lazy
   views and the built-in ones that already live in index.html's DOM
   (login/register/pending/admin/dashboard/forbidden aren't in
   LAZY_VIEWS, so they need their own entries here too). Anything not
   listed falls back to plain "Pestastic" rather than a route slug. */
const VIEW_TITLES = {
  login: 'Sign In',
  register: 'Register',
  pending: 'Pending Approval',
  forbidden: 'Access Denied',
  notfound: 'Not Found',
  dashboard: 'Dashboard',
  admin: 'User Management',
  clients: 'Clients',
  contracts: 'Contracts',
  treatments: 'Treatments',
  payments: 'Payments',
  renewals: 'Renewals',
  complaints: 'Complaints',
  inspections: 'Inspections',
  overdue: 'Overdue',
  calendar: 'Calendar',
  'audit-log': 'Audit Log',
  'report-daily-schedule': 'Daily Schedule Report',
  'report-monthly-collection': 'Monthly Collection Report',
  'report-service': 'Service Report',
  'report-overdue-treatments': 'Overdue Treatments Report',
  'report-client-soa': 'Client SOA'
};

function setPageTitle(name) {
  const label = VIEW_TITLES[name];
  document.title = label ? `Pestastic - ${label}` : 'Pestastic';
}

/* ── Sidebar permission filtering (item 6) ──
   Every module file ships its own full copy of the sidebar markup
   (see router.js's file doc), but every copy uses the same href="#x"
   convention for its nav-item links. Rather than touch all 21 files
   individually, this walks every sidebar currently in the DOM — mounted
   modules stay in the DOM even while hidden — and shows/hides each
   nav-item by matching its target route against the permission matrix.
   Re-run whenever the profile/permissions change and after every new
   lazy view mounts its own sidebar copy for the first time. */
let navRole = null;
let navPermissions = null;

function refreshNavVisibility() {
  if (!navRole) return;
  document.querySelectorAll('.sidebar .sidebar-nav').forEach(nav => {
    let currentLabel = null;
    let labelHasVisibleItem = false;
    const closeLabel = () => {
      if (currentLabel) currentLabel.style.display = labelHasVisibleItem ? '' : 'none';
    };
    Array.from(nav.children).forEach(child => {
      if (child.classList.contains('nav-section-label')) {
        closeLabel();
        currentLabel = child;
        labelHasVisibleItem = false;
        return;
      }
      if (!child.classList.contains('nav-item') || !child.getAttribute('href')?.startsWith('#')) return;
      const route = child.getAttribute('href').slice(1);
      let visible = true;
      if (route === 'audit-log') {
        visible = navRole === 'superadmin';
      } else if (PERMISSION_MODULE_KEYS.has(route)) {
        visible = navRole === 'superadmin' || (navPermissions?.[navRole]?.[route] !== false);
      }
      child.style.display = visible ? '' : 'none';
      if (visible) labelHasVisibleItem = true;
    });
    closeLabel();
  });
}

/** Called by index.html once the signed-in user's role + permission
 *  matrix are known (and again whenever a super admin saves changes to
 *  the matrix), so every sidebar copy — mounted now or later — reflects
 *  what this user is actually allowed to open. */
export function applyNavPermissions(role, permissions) {
  navRole = role;
  navPermissions = permissions;
  refreshNavVisibility();
}

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
    refreshNavVisibility(); // this module just added its own sidebar copy to the DOM
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
    setPageTitle(name);
    window.dispatchEvent(new CustomEvent('router:view-shown', { detail: { name } }));
    return el;
  }
  const nf = document.querySelector('[data-view="notfound"]');
  if (nf) nf.classList.add('active');
  setPageTitle('notfound');
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
