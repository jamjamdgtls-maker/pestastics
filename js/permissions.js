/* ════════════════════════════════════════════════════════════════
   permissions.js
   Single source of truth for the page-level permission matrix (item 6
   of the system review): which of Admin/User can reach which module.

   Super Admin is always unrestricted and never appears in the matrix.
   Audit Log is deliberately absent — it stays a fixed superadmin-only
   page, same as it's always been, not something a super admin can
   hand out. Everything else in LAZY_VIEWS (js/router.js) plus
   Dashboard is configurable.

   Storage: one doc, config/permissions, shaped as
     { admin: { <moduleKey>: bool, ... }, user: { <moduleKey>: bool, ... } }
   Firestore rules restrict writes to superadmin; any signed-in
   approved user can read it (they need their own row to route).
   ════════════════════════════════════════════════════════════════ */

import { db } from '../firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const PERMISSIONS_DOC_ID = 'permissions';
const ROLES_WITH_MATRIX = ['admin', 'user'];

/* Grouped for the User Management UI; `key` must match the route name
   used in js/router.js's LAZY_VIEWS (or 'dashboard', which is built
   into index.html rather than lazy-loaded). */
export const PERMISSION_MODULES = [
  { key: 'dashboard', label: 'Dashboard', group: 'Core' },
  { key: 'clients', label: 'Clients', group: 'Core' },
  { key: 'contracts', label: 'Contracts', group: 'Core' },
  { key: 'treatments', label: 'Treatments', group: 'Core' },
  { key: 'payments', label: 'Payments', group: 'Core' },
  { key: 'renewals', label: 'Renewals', group: 'Core' },
  { key: 'complaints', label: 'Complaints', group: 'Core' },
  { key: 'inspections', label: 'Inspections', group: 'Core' },
  { key: 'overdue', label: 'Overdue', group: 'Core' },
  { key: 'calendar', label: 'Calendar', group: 'Core' },
  { key: 'report-daily-schedule', label: 'Daily Schedule', group: 'Reports' },
  { key: 'report-service', label: 'Service Report', group: 'Reports' },
  { key: 'report-client-soa', label: 'Client SOA', group: 'Reports' },
  { key: 'report-monthly-collection', label: 'Monthly Collection', group: 'Reports' },
  { key: 'report-overdue-treatments', label: 'Overdue Treatments', group: 'Reports' },
  { key: 'admin', label: 'User Management', group: 'Admin' }
];

export const PERMISSION_MODULE_KEYS = new Set(PERMISSION_MODULES.map(m => m.key));

/* Preserves today's behavior as the shipped default — everything on
   for both roles, except User Management for plain Users (matches the
   "No, unless granted" default called for in the spec) — so nobody
   loses access the moment this ships. A super admin opts INTO
   restricting things from here, rather than everyone being locked out
   until the matrix is filled in. */
function defaultPermissions() {
  const perms = { admin: {}, user: {} };
  ROLES_WITH_MATRIX.forEach(role => {
    PERMISSION_MODULES.forEach(m => {
      perms[role][m.key] = m.key === 'admin' ? role === 'admin' : true;
    });
  });
  return perms;
}

let cached = null;

/** Loads config/permissions, merged over the defaults so any module
 *  added after a super admin last saved the matrix still has a sane
 *  default instead of being treated as unset/false. Cached in-memory
 *  for the session; pass force=true (or call clearPermissionsCache())
 *  after a save to pick up the change immediately. */
export async function loadPermissions(force = false) {
  if (cached && !force) return cached;
  const defaults = defaultPermissions();
  try {
    const snap = await getDoc(doc(db, 'config', PERMISSIONS_DOC_ID));
    const stored = snap.exists() ? snap.data() : {};
    cached = {
      admin: { ...defaults.admin, ...(stored.admin || {}) },
      user: { ...defaults.user, ...(stored.user || {}) }
    };
  } catch {
    cached = defaults; // if the read fails for any reason, fail open to today's behavior
  }
  return cached;
}

export function clearPermissionsCache() { cached = null; }

/** The one check both the route guard (index.html) and the sidebar
 *  filter (js/router.js) call. Super admin is always true. A route
 *  that isn't in the matrix at all (login/register/pending/forbidden/
 *  notfound/audit-log) is never gated here — audit-log has its own
 *  fixed superadmin-only rule, enforced by its own page/route branch. */
export function canAccess(role, permissions, routeName) {
  if (role === 'superadmin') return true;
  if (!PERMISSION_MODULE_KEYS.has(routeName)) return true;
  const rolePerms = (permissions && permissions[role]) || {};
  return rolePerms[routeName] !== false;
}
