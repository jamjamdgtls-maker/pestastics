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
- `clients.html` / `contracts.html` / `treatments.html` / `payments.html` /
  `renewals.html` / `complaints.html` / `inspections.html` / `overdue.html` /
  `calendar.html` / `report-daily-schedule.html` /
  `report-monthly-collection.html` / `report-service.html` /
  `report-overdue-treatments.html` / `report-client-soa.html` — the full
  set of 5 report pages originally referenced in the earliest
  dashboard.html upload is now complete.
  self-contained feature modules. Each has its own `<style>` (scoped
  under `#view-clients` / `#view-contracts` / etc. so they can't clash
  with each other or the shell) and its own `<script type="module">`.
  Not meant to be opened directly in a browser — they're fragments the
  router assembles into the running app.

  **Cross-module ID collision — now fixed everywhere.** Every module
  reuses the same element IDs (`sidebar`, `btn-signout`, `search-input`,
  `form-status`, `btn-clear-filters`, and many others). Since the
  router leaves every visited module mounted forever (just hidden), all
  of them can be in the DOM at once — and plain `document.getElementById()`
  returns the *first* match in the whole document, not necessarily the
  one belonging to whichever module the code actually lives in. This
  caused two confirmed, real bugs: Payments' own "Status" dropdown
  rendering *contract* statuses after visiting Contracts (both used
  `id="form-status"`), and Treatments' "Clear filters" button silently
  touching Payments' inputs instead of its own (both share `search-input`,
  `filter-date-from`, `filter-date-to`, `btn-clear-filters`, and more).

  All four modules now scope every lookup to their own `#view-{name}`
  root instead of the whole document: `const VIEW_ROOT =
  document.getElementById('view-{name}'); const $ = id =>
  VIEW_ROOT.querySelector('#' + id);`, with every other
  `document.querySelectorAll(...)` call similarly prefixed with its own
  `#view-{name}` selector. None of the four can reach into another
  module's elements anymore, in either direction. If a fifth module
  gets added later, it needs the same pattern from the start — it's not
  automatic just from following the file-structure convention above.
- `index.html` — the shell: auth screens (login/register/pending/
  forbidden/notfound), the hash router wiring, the Admin ("Review
  Requests") view, and the **Dashboard**. Dashboard is the one feature
  view that lives here instead of being lazy-loaded — it's the default
  landing view after sign-in, so there's no reason to pay a fetch delay
  for the first thing anyone sees. Its elements all use a hardcoded
  `dash-` ID prefix (`dash-sidebar`, `dash-btn-refresh`, etc.) instead
  of the `VIEW_ROOT`-scoped-query pattern the lazy modules use — since
  this markup is one-off and never re-mounted, a unique prefix is
  simpler and just as collision-proof against the lazy modules' own
  (often-reused) IDs. Its KPIs deliberately diverge from the original
  source file's logic in a few places to match what this system
  actually does: "Confirmed This Month" counts `status === 'scheduled'`
  treatments (this system has no `'confirmed'` status), renewals-due
  excludes `'cancelled'` contracts too (matching Renewals' own
  exclusion exactly, not just `'renewed'`), and "Upcoming Treatments"
  shows every upcoming session rather than filtering to a specific
  `contractType === 'GT'` value that isn't guaranteed to exist in a
  fully custom, list-manager-driven set of contract types anymore.
  KPI cards and nav links point at real in-app routes (`#treatments`,
  `#payments`, etc.) rather than the standalone report/overdue/audit-log
  pages the original file linked to, none of which exist in this build.
- `js/router.js` — fetches a module's HTML file the first time its route
  is visited, injects its styles into `<head>`, moves its own
  `[data-view]` element into `#view-mount`, and re-creates its `<script>`
  tag so it actually executes (script content set via `innerHTML` never
  runs — this is why a real router is needed instead of just concatenating
  HTML strings). Every visit after the first is instant: nothing is
  re-fetched, re-parsed, or re-executed. Also dispatches a
  `router:view-shown` event after every navigation, which is what the
  cross-module bridges below wait on.
- **Print CSS must be scoped too, same as everything else.**
  `report-daily-schedule.html` was the first module with a `@media
  print` block, and it matters more there than the usual ID-collision
  gotcha: the original standalone pages hid shell chrome with plain,
  unscoped selectors (`.sidebar`, `.topbar`, `#app-shell`,
  `.page-content > *:not(#report-area)`), which only worked because
  nothing else was ever loaded into that page. In this SPA every module
  stays permanently mounted (just hidden), so an unscoped print rule
  written for one module's report would apply globally the moment
  someone printed from a *different* page — e.g. `.page-content > *
  :not(#report-area){display:none}` would hide Treatments' own content
  when printing from Treatments, since Treatments' content doesn't have
  `id="report-area"` either. Every print selector in both
  `report-daily-schedule.html` and `report-monthly-collection.html` is
  scoped under their own `#view-report-...` root, which works correctly
  because the base `[data-view]:not(.active){display:none}` rule
  already keeps a module's entire subtree invisible whenever it isn't
  the active view — an ancestor's `display:none` wins regardless of any
  `!important` on descendant print rules trying to override their own
  display. Any future report page needs the same scoping from the
  start, not retrofitted after the fact — and should drop the original
  files' `beforeprint`/`afterprint` JS handlers entirely rather than
  port them: those queried `.main-wrapper`/`.page-content` with plain
  `document.querySelector()`, which grabs whichever module's element
  happens to be first in the whole DOM, not necessarily this module's
  own — the exact same collision class fixed everywhere else, just in
  JS form instead of CSS. The scoped print CSS alone is sufficient.
  `report-service.html` and `report-overdue-treatments.html` follow
  the exact same pattern for their own `@media print` blocks.
- **A report's own definition of "overdue" needs to match the live
  page's, not be reinvented.** `report-overdue-treatments.html` shares
  the same `RESOLVED_TREATMENT_STATUSES` exclusion (`completed`,
  `cancelled`) as `overdue.html` itself, on purpose — the original
  source file queried `status:'scheduled'` only, which would silently
  disagree with what the live Overdue page shows the moment a
  rescheduled treatment's new date also passed (Overdue counts that as
  overdue; the narrower query wouldn't). Two views computing the same
  concept from the same data should use the same rule, not two
  independently-drifting ones.
- `report-service.html`'s client info box is a good example of the
  address/field-name class of bug worth checking for on every new
  report, not assuming away: the source file read `clientData.address`
  and `clientData.emailAddress` directly, neither of which exists on a
  client doc — address is structured (`addressLine1`/`barangay`/`city`/
  `province`/`postalCode`), and the email field is just `email`. Fixed
  to match Clients' actual schema, same as every other module that
  displays a client's address.
- **Cross-module bridges** — modules jump into each other and act on a
  specific record via `window` custom events rather than any direct
  reference (they're independently loaded and don't import each other).
  Pattern: navigate to the target route by hash, wait for
  `router:view-shown` to confirm it's mounted (or skip the wait if
  already on that route), then dispatch the actual request event; the
  receiving module listens for it, waits for its own data to finish
  loading if it was just mounted for the first time, then acts.
  `pc:open-contract` / `pc:open-client` / `pc:open-complaint` /
  `pc:open-inspection` / `pc:open-client-soa` (open a specific record's
  detail view — used by Payments/Renewals/Complaints/Calendar/Clients to
  link out to each other; `pc:open-client-soa` is Clients' own detail
  modal jumping into a pre-selected, pre-generated Statement of Account,
  replacing the original standalone app's `?customer=XXX` URL param
  approach — this SPA doesn't use query params for cross-view navigation)
  and `pc:renew-contract` / `pc:book-treatment-from-complaint` /
  `pc:new-client-from-inspection` / `pc:create-contract-from-inspection`
  (open another module's own creation form pre-filled with context) all
  follow this same shape.
- `js/firestore-cache.js` — shared in-memory read cache + "smart write"
  wrappers (`cachedGetDocs`, `smartUpdateDoc`, etc.), used by every module
  so a collection is read once per session, not once per page visit.
- `js/contract-sync.js` — keeps a contract's rollup fields
  (`completedSessions`, `totalPaid`, `balanceRemaining`, ...) in sync with
  its `treatments`/`payments` child records, and handles the two
  structural amendments (cancelling a session, adding an extra one) that
  change the contract's actual committed value, not just its status.
- `js/treatment-actions.js` / `js/payment-actions.js` — the actual
  Firestore-mutation logic behind Complete/Reschedule/Cancel-a-treatment
  and Update-a-payment, factored out so more than one module can call
  the same correct implementation instead of each keeping its own copy.
  Treatments' and Payments' own modals call these; so does Overdue's —
  Overdue has no local mutation logic of its own at all, on purpose.
  This is what closes a real gap the original standalone Overdue page
  had: its own "Cancel" only flipped the treatment's status, never
  touching the paired payment or the contract's committed total the way
  Treatments' own Cancel does — a second, drifted copy of that logic
  would have reintroduced exactly that gap. Neither module handles
  toasts, audit-log writes, or modal-closing here — those stay with
  whichever page's UI triggered the call, since each wants slightly
  different wording/behavior around the same underlying mutation.
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
  A renewed contract gets `renewedToContractId` (pointing at its
  replacement); the new contract gets `renewedFromContractId` pointing
  back — the link is written on both sides, not just one.
- `treatments/{id}` — one per session: `contractId`, `sessionNo`,
  `treatmentDate`, `status` (`scheduled`/`need schedule`/`completed`/
  `cancelled`/`rescheduled`, lowercase). Deliberately does **not** store
  `customerNo` or `contractType` — those are contract facts, resolved
  live via `contractId → contracts/{contractId}` every time they're
  displayed (see `tCustomerNo()`/`tContractType()`/`tClientName()` in
  treatments.html), so an edit to the contract is reflected everywhere
  instantly with nothing to go stale. Contract Type shows as read-only
  in the Treatments Edit modal for the same reason — it isn't this
  module's data to change.
- `payments/{id}` — one per installment: `contractId`, `customerNo`
  (payments *do* keep this copy, following Contracts' own original
  convention — only the Treatments-side duplication was the problem),
  `sessionNo`, `amount`, `status` (`Pending`/`Received`/`Cancelled`,
  capitalized — a different, older vocabulary than treatments' own
  status field; the two were never unified and both modules agree on it).
  `isAdditional` marks a payment as an ad-hoc extra charge outside the
  original installment plan (set automatically by "Add Extra Treatment"
  in both Contracts and Treatments — `payments.html` itself is edit-only
  now, it doesn't create new payments) — display/reporting only, doesn't
  change rollup math. `notes` is an array of `{text, author, timestamp}`,
  managed from `payments.html`'s own notes thread.
- `renewals/{id}` — one per contract being tracked for renewal:
  `contractId` (the *old* contract), `status` (`pending`/`proposal-sent`/
  `awaiting-response`/`renewed`/`declined`, lowercase), `proposalAmount`,
  `notes`. `status` can only ever become `'renewed'` as a side effect of
  an actual new contract being created — `renewals.html` never writes
  that value directly; picking "Renewed" from its own Update Status
  modal redirects into Contracts' creation flow instead (see below).
  Once a renewal completes, gets `newContractId` pointing at the
  contract that replaced it.
- `complaints/{id}` — `customerNo`, `contractType` (a plain reported
  category, independent of `contractId`), `contractId` (nullable —
  deliberately optional; a complaint can be logged before the specific
  contract has been verified, then attached later via the Detail view's
  "Connect Contract" action), `priority` (lowercase), `status`
  (`Open`/`In Progress`/`Scheduled`/`Completed`/`Closed`), `assignedTo`,
  `description`, `dateReported` (string, same convention as everywhere
  else), `comments` (array of `{text, author, type, createdAt}` — `type`
  is `comment`/`status_change`/`treatment`/`contract_link`, driving the
  small colored tag shown on each entry). Deliberately does **not**
  store `clientName` — resolved live via `cClientName()`, same principle
  as Treatments' `tClientName()`. "Book Treatment" doesn't create a
  treatment record itself; it hands off to Treatments' own "Add Extra
  Treatment" flow via `pc:book-treatment-from-complaint`, pre-filled
  from the complaint, so the one correct implementation of
  session-numbering + paired payment + rollup update stays the only one.
- `inspections/{id}` — a pre-client prospect record: `clientName`,
  `contactNumber`, `address` (one combined string — not the structured
  `addressLine1`/`barangay`/`city`/`province` Clients uses, since that
  breakdown doesn't exist yet at inspection time), `inspectedBy`,
  `assignedTeam`, `pestProblems` (array, checkbox grid built from the
  managed `pestProblems` settings list — never hardcoded), `status`
  (`Scheduled`/`Completed`/`Converted`/`Cancelled`/`No Show`/`Lost`),
  `comments`. Unlike every other module, storing the prospect's own
  name/contact/address directly here is *correct*, not a duplication
  bug — there's no client record yet for it to duplicate. Conversion
  to an actual client and contract is two explicit steps, not one: the
  Detail view's "Save as Client" hands off to Clients' own New Client
  form via `pc:new-client-from-inspection` (Clients marks the
  inspection `status: 'Converted'` + `convertedToClientNo` once the
  client is actually created — Inspections never assigns a customerNo
  itself); only once that's set does a second "Create Contract" action
  appear, handing off to Contracts' New Contract form via
  `pc:create-contract-from-inspection` with a suggested Contract Type
  inferred from the observed pests. Both steps go through the module
  that actually owns that kind of record, same reasoning as every
  other cross-module handoff in this app.
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
  (Treatments' own), `pestProblems` (Inspections), `complaintStatuses` /
  `complaintPriorities` (Complaints), `paymentModes` (Payments). Also
  `companyName` / `companyAddress` / `companyPhone`, used on Daily
  Schedule Report's letterhead — these have no Settings-page UI to edit
  them yet in this build (there is no Settings module at all so far),
  so for now they default sensibly and can only be changed via a direct
  Firestore edit to this document.
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

**Editing a contract's Start Date** automatically shifts every
not-yet-completed/cancelled treatment's date (and its pending payment's
due date) by the same number of days — no confirmation prompt, since
Contracts is the source of truth and Treatments has no independent copy
of these dates to protect. Completed/cancelled sessions never move.

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
