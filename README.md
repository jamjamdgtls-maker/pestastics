# Pestastic — Access Control shell + lazy-loaded feature modules

A real single-page app, but not a single file. `index.html` is a thin shell
(auth screens + router only); every feature — Clients, Contracts, and
whatever gets built next — lives in its own HTML file, fetched once on
first visit and left mounted for the rest of the session. No page reloads
anywhere, ever.

## Files

- `index.html` — the shell: register/login/pending/admin/forbidden/notfound
  views, the router wiring, and `#view-mount` (where feature modules get
  injected).
- `clients.html` / `contracts.html` / `treatments.html` — self-contained feature modules. Each
  has its own `<style>` (scoped under `#view-clients` / `#view-contracts`
  so they can't clash with each other or the shell) and its own
  `<script type="module">`. Not meant to be opened directly in a browser —
  they're fragments the router assembles into the running app.
- `js/router.js` — fetches a module's HTML file the first time its route
  is visited, injects its styles into `<head>`, moves its own
  `[data-view]` element into `#view-mount`, and re-creates its `<script>`
  tag so it actually executes (script content set via `innerHTML` never
  runs — this is why a real router is needed instead of just concatenating
  HTML strings). Every visit after the first is instant: nothing is
  re-fetched, re-parsed, or re-executed.
- `js/firestore-cache.js` — shared in-memory read cache + "smart write"
  wrappers (`cachedGetDocs`, `smartUpdateDoc`, etc.), used by every module
  so a collection is read once per session, not once per page visit.
- `js/contract-sync.js` — keeps a contract's rollup fields
  (`completedSessions`, `totalPaid`, `balanceRemaining`, ...) in sync with
  its `treatments`/`payments` child records, and handles the two
  structural amendments (cancelling a session, adding an extra one) that
  change the contract's actual committed value, not just its status.
- `js/list-manager.js` — a shared, self-contained "manage this dropdown's
  options" modal for config/settings array fields (Contract Type,
  Treatment Method, Sales Agent, Communication Source, Cancel/Reschedule
  Reasons). Both Clients and Contracts open the same modal for Sales
  Agent/Comm. Source since they're the same shared list either way.
- `js/team-manager.js` — a separate manager for the `teams` collection
  specifically (name + technician roster) — not a config/settings array,
  since Treatments cascades a Technician dropdown from each team's
  roster. Shared by Contracts' "Assigned Team" and Treatments' team
  fields/Manage Teams button, so a team added from either place shows
  up in both.
- `firebase-config.js` — shared Firebase init.
- `firestore.rules` — security rules for every collection above.

## Adding a new module

1. Build `yourmodule.html` following the same shape as `clients.html`:
   one top-level `<div data-view="yourmodule" id="view-yourmodule">`,
   scope its `<style>` under that same id, and give it its own
   `<script type="module">` that reads `window.__pcProfile` (or listens
   for the `pc:profile` event) to know who's signed in — don't re-do auth.
2. Add one line to `LAZY_VIEWS` in `js/router.js`.
3. Add a nav link to `#yourmodule` wherever makes sense (dashboard/admin
   topbars, other modules' sidebars).

## How routing works

- The URL hash is the source of truth (`route()` in `index.html` reads
  `window.location.hash`).
- Built-in views (login/register/pending/admin/dashboard/forbidden) are
  already in `index.html`'s DOM — showing them is instant.
- Anything else registered in `js/router.js`'s `LAZY_VIEWS` gets
  fetched + mounted on first visit, then just shown/hidden after that.
- Anything not recognized falls back to the `notfound` view.
- On auth state change, the shell re-checks the user's Firestore profile
  and redirects: no profile → login, `status: "pending"` → pending
  screen, `status: "rejected"` → signed back out with a message,
  `status: "approved"` → dashboard or admin depending on `role`.
- Once approved, the shell broadcasts `{ uid, email, name, role }` via
  `window.__pcProfile` + a `pc:profile` event — every module (mounted or
  not yet mounted) picks this up instead of doing its own auth check.

## Setup

1. **Create a Firebase project** at console.firebase.google.com (or reuse
   an existing one).
2. **Enable Email/Password auth**: Authentication → Sign-in method →
   Email/Password → Enable.
3. **Enable Firestore**: Firestore Database → Create database (start in
   production mode).
4. **Copy your web app config** into `firebase-config.js`, replacing the
   placeholder values.
5. **Publish `firestore.rules`** — paste its contents into
   Firestore → Rules and publish. This is what actually enforces the
   approval gate and role checks; client-side checks alone aren't enough.
6. **Bootstrap your first super admin**: register a normal account
   through the app, then in the Firestore console open `users/{that-uid}`
   and change `role` to `"superadmin"` and `status` to `"approved"`.
   Every super admin after that can be promoted the same way, or add a
   promote button to the admin panel later.
7. Serve the folder over HTTP (not `file://` — the router uses `fetch()`,
   which needs a real origin) and open `index.html`.

## Data model (Clients + Contracts + Treatments)

- `clients/{id}` — `customerNo`, `clientName`, address fields, `salesAgent`,
  `communicationSource`, `documents[]`, etc.
- `contracts/{id}` — `contractNumber`, `customerNo`, dates, `totalAmount`,
  `noOfSessions`, `status`, plus rollup fields kept in sync by
  `js/contract-sync.js`: `totalSessions`, `completedSessions`,
  `nextTreatmentDate`, `totalPaid`, `balanceRemaining`, `lastPaymentDate`.
- `treatments/{id}` — one per session: `contractId`, `customerNo`,
  `sessionNo`, `treatmentDate`, `status` (`scheduled`/`need schedule`/
  `completed`/`cancelled`/`rescheduled`, lowercase — this is the
  Treatments module's vocabulary; Contracts' embedded treatments tab
  was reconciled to match it).
- `payments/{id}` — one per installment: `contractId`, `customerNo`,
  `sessionNo`, `amount`, `status` (`Pending`/`Received`/`Cancelled`,
  capitalized — a different, older vocabulary than treatments' own
  status field; the two were never unified and both modules agree on it).
- `teams/{id}` — `teamName` + a `members`/`technicians` roster. Kept as
  its own collection rather than folded into config/settings (unlike
  Contract Type, Sales Agent, etc.) because Treatments cascades a
  Technician dropdown from each team's roster — a flat settings array
  can't represent that relationship. Managed via `js/team-manager.js`,
  shared by both Contracts' "Assigned Team" and Treatments.
- `config/settings` — shared dropdown options: `salesAgents`,
  `commSources` (shared between Clients and Contracts), `contractTypesList`,
  `treatmentMethods` (shared between Contracts' "Treatment Method" and
  Treatments' "Treatment Type" — same underlying list, different label
  per module), `bookingStatuses`, `cancelReasons`, `rescheduleReasons`
  (Treatments' own).
- `config/counters` — `clientCounter`/`contractCounter`/`treatmentCounter`,
  incremented via Firestore transactions for auto-generated numbers.
- `audit_log/{id}` — append-only trail of creates/updates/deletes/
  amendments across every module.

Two tiers of contract update, by design:
- **Status-only** (mark a session completed, mark a payment received) →
  silent rollup recalculation, no change to what the contract is worth.
- **Structural** (cancel a session, add an extra one) → confirmed in the
  UI, adjusts `totalAmount`/`noOfSessions`, writes an audit log entry,
  then recalculates the rollup on top. Both Contracts' "Cancel Session"/
  "Add Extra Treatment" and Treatments' "Cancel"/"Add Extra Treatment"
  (the old "New Treatment" modal, now billable) go through this same path.

**Editing a contract's Start Date** doesn't automatically touch the
already-generated `treatments`/`payments` — those keep whatever dates
they were created with until told otherwise. If the Start Date actually
changes on save, Contracts asks whether to shift every not-yet-completed/
cancelled session (and its pending payment's due date) by the same
number of days; completed/cancelled sessions never move. Declining just
leaves the schedule as-is.

## Managed dropdown lists

Contract Type, Treatment Method, Assigned Team, Sales Agent, and
Communication Source all start **empty** — there's no seeded example
data baked into the code. Each has a "Manage list" link next to its
dropdown that opens `js/list-manager.js`'s modal to add/rename/delete
options, writing straight to `config/settings`. Sales Agent and
Communication Source are shared between Clients and Contracts (same
field on the same doc); add one from either module and it shows up in
both.

**Frequency is the one exception** — it stays a fixed system list
(Monthly/Bi-Monthly/Quarterly/Semi-Annual/Annual/One-Time) rather than
user-editable, because its value directly drives interval-month math in
`buildSchedule()`. A freeform value there could silently break schedule
generation instead of erroring, so it's intentionally not on the
"Manage list" pattern.

## Downpayment already collected at signing

The New Contract form has a "Downpayment Status" + "Downpayment Payment
Date" pair (New Contract only — Edit doesn't regenerate the schedule,
so an existing contract's payments are managed one at a time via the
Payments tab's "Mark Received" instead). If set to "Already Received",
the first session's payment is written as `status: "Received"` with the
given date, and the contract's initial `totalPaid`/`balanceRemaining`
rollup reflects it immediately — no separate "mark received" step
needed right after creating the contract.

## Things to adjust for production

- Add email notifications (e.g. via a Cloud Function) when a registration
  is approved/rejected, or when a contract amendment happens.
- Consider rate-limiting registration (e.g. App Check) since it's public.
- The read cache in `js/firestore-cache.js` is in-memory only — it resets
  on a full page reload. That's fine for a single-tab session; if you
  need it to survive reloads, layer in IndexedDB the way the real
  pestasticSys project's `firestoreCache.js` does.
- `teams` is currently a static list under `config/settings.teamsList`
  rather than its own collection — promote it to a real `teams` module
  the same way Clients/Contracts were built, once you need more than a
  flat list (schedules, load balancing, etc.).
