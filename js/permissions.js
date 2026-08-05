/* ════════════════════════════════════════════════════════════════
   js/permissions.js
   Single source of truth for "who may see which page".

   Rules of the model:
     - superadmin  → unrestricted, always. Never configurable, never
       hidden, never blocked. Nothing in this file can lock a super
       admin out of anything.
     - admin / user → every module is configurable per-account from
       User Management. A user document may carry a `permissions`
       map ({ moduleKey: true|false }); anything missing from that map
       falls back to the role default below.

   Every module, sidebar link and route guard in the app reads its
   answer from here — there is no second place that decides access.
   ════════════════════════════════════════════════════════════════ */

/** The permission matrix, in sidebar order. `routes` lists every hash
 *  route that the module owns; the route guard maps a hash back to a
 *  module key through this table. */
export const MODULES = [
  { key: 'dashboard',   label: 'Dashboard',       routes: ['dashboard'] },
  { key: 'clients',     label: 'Clients',         routes: ['clients'] },
  { key: 'contracts',   label: 'Contracts',       routes: ['contracts'] },
  { key: 'treatments',  label: 'Treatments',      routes: ['treatments'] },
  { key: 'payments',    label: 'Payments',        routes: ['payments'] },
  { key: 'renewals',    label: 'Renewals',        routes: ['renewals'] },
  { key: 'complaints',  label: 'Complaints',      routes: ['complaints'] },
  { key: 'inspections', label: 'Inspections',     routes: ['inspections'] },
  {
    key: 'reports', label: 'Reports',
    routes: [
      'overdue', 'calendar',
      'report-daily-schedule', 'report-service', 'report-client-soa',
      'report-monthly-collection', 'report-overdue-treatments'
    ]
  },
  { key: 'users',       label: 'User Management', routes: ['admin', 'audit-log'] }
];

export const MODULE_KEYS = MODULES.map(m => m.key);

/** Role defaults, used for any module a user document doesn't pin
 *  explicitly. Super admin isn't listed — it never consults defaults. */
export const ROLE_DEFAULTS = {
  admin: {
    dashboard: true, clients: true, contracts: true, treatments: true,
    payments: true, renewals: true, complaints: true, inspections: true,
    reports: true, users: true
  },
  user: {
    dashboard: true, clients: true, contracts: true, treatments: true,
    payments: true, renewals: true, complaints: true, inspections: true,
    reports: true, users: false
  }
};

export function isSuperAdmin(profile) {
  return (profile?.role || '') === 'superadmin';
}

/** Resolved permission map for a profile — role defaults with the
 *  account's own overrides applied on top. Super admins resolve to
 *  "everything true" and can't be narrowed. */
export function permissionsFor(profile) {
  const out = {};
  if (isSuperAdmin(profile)) {
    MODULE_KEYS.forEach(k => { out[k] = true; });
    return out;
  }
  const defaults = ROLE_DEFAULTS[profile?.role] || ROLE_DEFAULTS.user;
  const overrides = (profile && typeof profile.permissions === 'object' && profile.permissions) || {};
  MODULE_KEYS.forEach(k => {
    out[k] = typeof overrides[k] === 'boolean' ? overrides[k] : !!defaults[k];
  });
  return out;
}

/** May this profile open this module? */
export function canAccess(profile, moduleKey) {
  if (isSuperAdmin(profile)) return true;
  if (!profile) return false;
  return !!permissionsFor(profile)[moduleKey];
}

/** Which module owns this hash route (null for shell routes such as
 *  login/register/pending/forbidden/notfound). */
export function moduleForRoute(route) {
  const r = (route || '').replace(/^#/, '');
  const found = MODULES.find(m => m.routes.includes(r));
  return found ? found.key : null;
}

/** Route guard. Unknown/shell routes are always allowed through — the
 *  shell router decides what to do with them. Anything that maps to a
 *  module is checked against the matrix, so a hand-typed URL is just
 *  as blocked as a hidden sidebar link. */
export function canAccessRoute(profile, route) {
  const key = moduleForRoute(route);
  if (!key) return true;
  return canAccess(profile, key);
}

/** First route this profile is actually allowed to land on. */
export function defaultRouteFor(profile) {
  if (canAccess(profile, 'dashboard')) return 'dashboard';
  const first = MODULES.find(m => canAccess(profile, m.key));
  return first ? first.routes[0] : 'forbidden';
}
