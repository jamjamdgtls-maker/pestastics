# Access Control — registration + login with super admin approval (SPA)

Single-page app. Everything lives in one `index.html` — register, login, pending,
dashboard, and the admin panel are all `<div data-view="...">` blocks toggled by
a small hash router (`#login`, `#register`, `#pending`, `#dashboard`, `#admin`).
No page reloads between screens.

Files:
- `index.html` — the whole app: all views + routing + Firebase logic
- `firebase-config.js` — shared Firebase init, fill in your project's keys
- `style.css` — shared design tokens/styles
- `firestore.rules` — security rules that actually enforce the approval gate

## How routing works

- The URL hash is the source of truth for which view is showing (`route()` reads `window.location.hash`).
- On auth state change, the app re-checks the user's Firestore profile and redirects: no profile → login, `status: "pending"` → pending screen, `status: "rejected"` → signed back out with a message, `status: "approved"` → dashboard or admin depending on `role`.
- Trying to hit `#admin` without `role: "superadmin"` lands on a "not your page" view instead of the panel.

## Setup

1. **Create a Firebase project** at console.firebase.google.com (or reuse an existing one).
2. **Enable Email/Password auth**: Authentication → Sign-in method → Email/Password → Enable.
3. **Enable Firestore**: Firestore Database → Create database (start in production mode).
4. **Copy your web app config** (Project settings → Your apps → SDK setup and configuration) into `firebase-config.js`, replacing the placeholder values.
5. **Publish the security rules**: paste the contents of `firestore.rules` into Firestore → Rules, and publish. This is what actually stops a user from approving themselves — the client-side checks alone aren't enough.
6. **Bootstrap your first super admin**: register a normal account through `register.html`, then in the Firestore console open `users/{that-uid}` and manually change `role` from `"user"` to `"superadmin"` and `status` from `"pending"` to `"approved"`. Every super admin after that can be promoted the same way, or you can add a "make super admin" button to `admin.html` later.
7. Open `index.html` (`#register`) to try the flow end to end.

## How the gate works

- `users/{uid}` holds `{ name, email, status, role, createdAt }`.
- `status` starts at `"pending"` and only a super admin can move it to `"approved"` or `"rejected"` (enforced in `firestore.rules`, not just in the UI).
- After sign-in, the app checks this document and immediately signs the user back out if they're not `"approved"` — so a pending/rejected user is authenticated for a split second but never reaches a real view.
- The `#admin` view is gated the same way, checking `role == "superadmin"` before rendering anything.

## Clients module (integrated from clients.html)

`index.html` now has a fifth view, `#clients`, reachable once you're signed in and
approved (same gate as `#dashboard`). It reuses this project's Firebase config and
auth/approval flow — no separate login screen, no Google sign-in, no extra files.

- Full client CRUD: add/edit/delete, search, column sort + filter, pagination.
- Client detail modal with Info / Contracts / Complaints / Documents tabs
  (Contracts and Complaints just query `contracts`/`complaints` by `customerNo` —
  they'll show real data once those collections exist).
- CSV import/export/template, audit log writes to `audit_log`.
- Delete is restricted to `role: "superadmin"` (same role used by the `#admin`
  panel) — everyone approved can view/add/edit.
- Its CSS is scoped under `#view-clients` so it can't collide with the
  access-control screens' own styles.
- Publish the updated `firestore.rules` (adds rules for `clients`, `contracts`,
  `complaints`, `payments`, `treatments`, `renewals`, `inspections`, `config`,
  `audit_log`) or the Clients page will get permission-denied errors.

Nav: "Clients" link on the dashboard and admin topbars; "Dashboard" and
(for super admins) "Admin" links in the Clients sidebar.

## Things to adjust for production


- Add email notifications (e.g. via a Cloud Function) when a request is approved/rejected, since nothing currently pings the user.
- If you want multiple roles beyond `user`/`superadmin`, extend the `role` field and the rules accordingly.
- Consider rate-limiting registration (e.g. App Check) since `register.html` is public.
