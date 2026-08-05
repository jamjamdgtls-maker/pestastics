/* ════════════════════════════════════════════════════════════════
   js/app-shell.js
   Cross-cutting chrome that every page shares, applied from one place
   instead of being copy-pasted into twenty HTML files:

     · Branding      — logo.jpg in every sidebar, login and print header
     · Browser title — "Pestastic - <Active Section>", always in sync
     · Sidebar       — only shows pages the signed-in account may open
     · Route guard   — a hidden page is unreachable by hand-typed URL
     · Layout        — strips the legacy per-module Refresh control

   Each module keeps its own markup; this file only normalises the
   parts that must look and behave identically everywhere.
   ════════════════════════════════════════════════════════════════ */

import { MODULES, canAccess, canAccessRoute, defaultRouteFor } from './permissions.js';

export const LOGO_SRC = 'logo.jpg';
export const BRAND_NAME = 'Pestastic';

/* ── Browser titles ── */
const TITLES = {
  login: 'Sign In',
  register: 'Request Access',
  pending: 'Pending Approval',
  forbidden: 'Access Denied',
  notfound: 'Page Not Found',
  dashboard: 'Dashboard',
  clients: 'Clients',
  contracts: 'Contracts',
  treatments: 'Treatments',
  payments: 'Payments',
  renewals: 'Renewals',
  complaints: 'Complaints',
  inspections: 'Inspections',
  overdue: 'Overdue',
  calendar: 'Calendar',
  'report-daily-schedule': 'Daily Schedule Report',
  'report-service': 'Service Report',
  'report-client-soa': 'Client SOA',
  'report-monthly-collection': 'Monthly Collection Report',
  'report-overdue-treatments': 'Overdue Treatments Report',
  admin: 'User Management',
  'audit-log': 'Audit Log'
};

export function titleForRoute(route) {
  return `${BRAND_NAME} - ${TITLES[route] || 'Pest Control Management'}`;
}

function currentRoute() {
  return (window.location.hash || '#dashboard').slice(1);
}

export function applyDocumentTitle(route = currentRoute()) {
  document.title = titleForRoute(route);
}

/* ── Branding ──
   Every module ships the same placeholder mark in its sidebar; swap
   each one for the real logo, once, wherever it turns up. */
function brandingMarkup(size) {
  return `<img src="${LOGO_SRC}" alt="${BRAND_NAME} logo" width="${size}" height="${size}"
    style="width:100%;height:100%;object-fit:cover;display:block" />`;
}

export function applyBranding(root = document) {
  root.querySelectorAll('.sidebar-logo-icon:not([data-branded]), .auth-logo:not([data-branded])')
    .forEach(el => {
      el.setAttribute('data-branded', '1');
      el.style.background = 'transparent';
      el.style.overflow = 'hidden';
      el.style.borderRadius = '10px';
      el.style.padding = '0';
      el.innerHTML = brandingMarkup(el.classList.contains('auth-logo') ? 64 : 36);
    });

  root.querySelectorAll('.brand-logo-slot:not([data-branded])').forEach(el => {
    el.setAttribute('data-branded', '1');
    el.innerHTML = `<img src="${LOGO_SRC}" alt="${BRAND_NAME} logo" class="brand-logo-img" />`;
  });
}

/* ── Sidebar gating ──
   Hides every nav link the account may not open, then hides any
   section heading left with nothing under it, so the sidebar never
   shows an empty group. */
export function applySidebarPermissions(profile, root = document) {
  root.querySelectorAll('.sidebar-nav').forEach(nav => {
    nav.querySelectorAll('a.nav-item[href^="#"]').forEach(link => {
      const route = link.getAttribute('href').slice(1);
      const owner = MODULES.find(m => m.routes.includes(route));
      const allowed = !owner || canAccess(profile, owner.key);
      link.style.display = allowed ? '' : 'none';
      link.setAttribute('aria-hidden', allowed ? 'false' : 'true');
    });

    // A label owns every item until the next label.
    const children = Array.from(nav.children);
    children.forEach((node, i) => {
      if (!node.classList?.contains('nav-section-label')) return;
      let anyVisible = false;
      for (let j = i + 1; j < children.length; j++) {
        const next = children[j];
        if (next.classList?.contains('nav-section-label')) break;
        if (next.style.display !== 'none') { anyVisible = true; break; }
      }
      node.style.display = anyVisible ? '' : 'none';
    });
  });
}

/* ── Active nav highlight (sidebar is the only page indicator now
      that the top bar is gone) ── */
export function applyActiveNav(route = currentRoute(), root = document) {
  root.querySelectorAll('a.nav-item[href^="#"]').forEach(link => {
    link.classList.toggle('active', link.getAttribute('href').slice(1) === route);
  });
}

/* ── Legacy chrome removal ── */
export function stripLegacyChrome(root = document) {
  root.querySelectorAll('#btn-refresh, #dash-btn-refresh, .topbar-refresh').forEach(el => el.remove());
  root.querySelectorAll('.main-wrapper > .topbar').forEach(el => el.remove());
}

/* ── Route guard ──
   Returns the route the app should actually show. A blocked route
   never renders: the caller redirects instead. */
export function resolveRoute(profile, route = currentRoute()) {
  if (canAccessRoute(profile, route)) return route;
  return null;
}

export function redirectToAllowedRoute(profile) {
  const target = defaultRouteFor(profile);
  window.location.hash = `#${target}`;
}

/* ── Wiring ──
   initAppShell() is called once by index.html. Lazy modules mount
   long after that, so everything re-runs on router:view-shown. */
let shellProfile = null;

export function setShellProfile(profile) {
  shellProfile = profile;
  refreshShell();
}

export function refreshShell(route = currentRoute()) {
  applyBranding();
  stripLegacyChrome();
  applySidebarPermissions(shellProfile);
  applyActiveNav(route);
  applyDocumentTitle(route);
}

export function initAppShell() {
  applyBranding();
  applyDocumentTitle();

  window.addEventListener('router:view-shown', e => {
    refreshShell(e.detail?.name || currentRoute());
  });
  window.addEventListener('hashchange', () => applyDocumentTitle());
  window.addEventListener('pc:profile', e => setShellProfile(e.detail));
}
