# ElderWatch

Daily wellness check-in for frail-care homes and retirement villages. Each resident taps one
button on their own phone once a morning; staff see live status for the whole village; anyone who
has not checked in by the home's cutoff time is flagged for a visit.

- **Live app:** https://elderwatch3.vercel.app
- **Marketing page:** https://elderwatch3.vercel.app/marketing
- **Resident terminal:** `https://elderwatch3.vercel.app/checkin/<residentId>`
- **Staff portal:** `https://elderwatch3.vercel.app/admin`
- **Device pairing:** `https://elderwatch3.vercel.app/link`

Owned by Shaun Gordon. Copyright and patent notice: see [Legal](#legal).

---

## Contents

- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [The two runtimes (read this first)](#the-two-runtimes-read-this-first)
- [Data model](#data-model)
- [Authentication](#authentication)
- [Scheduled jobs and crons](#scheduled-jobs-and-crons)
- [Features](#features)
- [Reminder notifications](#reminder-notifications)
- [PDF reports](#pdf-reports)
- [Marketing pages and the interactive demo](#marketing-pages-and-the-interactive-demo)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Deployment](#deployment)
- [Development scripts](#development-scripts)
- [Checks before you push](#checks-before-you-push)
- [Known issues and gotchas](#known-issues-and-gotchas)
- [Not built (things earlier docs claimed)](#not-built-things-earlier-docs-claimed)
- [Legal](#legal)

---

## Tech stack

| Layer | Choice |
|---|---|
| UI | React 19 + TypeScript 5.8, Tailwind CSS v4, lucide-react icons |
| Build | Vite 6 (`npm run build` also bundles the dev server to `dist/server.cjs` with esbuild) |
| Data | Firebase Firestore, accessed **two different ways** (see below) |
| Auth | Firebase Auth in production; Base64 staff tokens in the local dev server |
| Local server | Express 4 (`server.ts`) + `firebase-admin` |
| Serverless | Vercel functions in `api/**/*.js` (Firestore REST + `google-auth-library`) |
| Reports | jsPDF + jspdf-autotable |
| Reminders | Web Push (VAPID) via `web-push`, delivered by a Vercel cron |
| Hosting | Vercel (auto-deploy on push to `main`), 2 cron jobs |
| PWA | Hand-written service worker `public/sw.js`, registered from `index.html`, installable on Android and iOS |

No test framework is installed. Verification is done with `tsc`, the production build, live-data
probe scripts, and a jsdom harness for the marketing demo (see [Checks](#checks-before-you-push)).

---

## Repository layout

```
├── api/                            Vercel serverless functions (production only)
│   ├── cron/
│   │   ├── daily-reset.js          00:00 SAST — resets today's check-ins to "awaiting"
│   │   └── reminder-push.js        08:00 SAST — sends the web-push reminders (VAPID)
│   ├── residents/
│   │   ├── index.js                create a resident
│   │   └── [id].js                 update / delete a resident
│   ├── create-home.js  delete-home.js
│   ├── create-staff.js update-staff.js delete-staff.js
│   └── reset-password.js
├── functions/                      LEGACY — Firebase Cloud Functions, not deployed (see Known issues)
├── lib/
│   └── firebase-admin.ts           Admin SDK bootstrap + collection refs (used by server.ts)
├── public/                         served verbatim by Vite
│   ├── sw.js                       service worker (offline shell + the push handler)
│   ├── manifest.json               PWA manifest (standalone, portrait)
│   ├── marketing.html              the marketing page as deployed (copy of the file below)
│   └── *.png / *.svg               app icons and logo
├── scripts/                        one-off maintenance scripts (see Development scripts)
├── src/
│   ├── App.tsx                     router: /admin, /checkin/:id, /link + PWA URL restore
│   ├── components/
│   │   ├── StaffLoginScreen.tsx    staff sign-in (server auth, Firebase Auth fallback)
│   │   ├── AdminPanel.tsx          staff dashboard (~1.9k lines, the bulk of the UI)
│   │   ├── ResidentCheckInScreen.tsx  the resident terminal
│   │   ├── DeviceLinkScreen.tsx    manual pairing screen (/link)
│   │   ├── DeviceLinkQRModal.tsx   admin QR code + pairing URL modal
│   │   ├── ResidentDetailModal.tsx per-resident detail, history and staff override
│   │   ├── AddEditResidentModal.tsx
│   │   ├── MarkAwayModal.tsx       mark a resident away / on leave
│   │   ├── AdminOverviewView.tsx   multi-village overview (admin role)
│   │   ├── LegalFooter.tsx         the copyright / patent notice
│   │   ├── ThemeToggle.tsx         `useAppTheme()` — use this for dark/light, never raw colours
│   │   ├── PWAInstallButton.tsx    install prompt + offline indicator
│   │   └── BackendEvaluationModal.tsx
│   ├── lib/
│   │   ├── firebase.ts             client SDK: app per tab, auth, Firestore helpers, listeners
│   │   ├── firebase-api.ts         higher-level CRUD used by the admin panel
│   │   ├── push.ts                 web-push subscribe / unsubscribe / re-assert
│   │   └── checkInReport.ts        shared PDF renderer for both reports
│   ├── hooks/usePWAInstall.ts
│   ├── types.ts
│   └── index.css
├── server.ts                       local dev server (Express + Vite middleware) — NOT deployed
├── index.html                      app shell; registers public/sw.js
├── ElderWatch_marketing.html       marketing page source of truth (self-contained)
├── ElderWatch_mobile_marketing.html / …marketing2.html  earlier marketing designs (superseded)
├── firestore.rules                 Firestore security rules
├── firebase.json                   points at functions/ (legacy)
├── vercel.json                     rewrites, functions config, cron schedule
├── .env.example                    every variable, with notes
└── package.json
```

---

## The two runtimes (read this first)

This is the single biggest source of bugs. The app runs in two very different environments and the
same screen can take a different code path in each.

### 1. Local development — `npx tsx server.ts` (Express, port 3000)

- `server.ts` owns everything: auth, CRUD routes, the scheduled jobs, and the API the admin panel
  calls over `fetch('/api/...')`.
- Data access goes through the **Firebase Admin SDK** (`lib/firebase-admin.ts`) using
  `service-account.json`.
- Auth is a **Base64 token**, not a Firebase JWT:
  `Buffer.from(JSON.stringify({ staffId, homeId, role, time })).toString('base64')`, sent as
  `Authorization: Bearer <token>`.
- It also serves the React app through Vite middleware (HMR works).
- It writes to the **same live Firestore database as production** — there is no emulator here.

### 2. Production — Vercel (static build + client SDK)

- `npm run build` produces a static SPA. `server.ts` is **never deployed**.
- The React app talks **directly to Firestore** with the client SDK and authenticates with
  **Firebase Auth** (`signInWithEmailAndPassword`), reading `staff/{uid}` for role and home.
- Anything that needs a server runs as a Vercel function under `api/**/*.js`, using the Firestore
  REST API with credentials from environment variables (the same pattern as `api/cron/daily-reset.js`).

**When you add a feature:** give it a server route for local dev **and** a client-side Firestore
path for production, or make sure it only ever touches Firestore from the client. The resident
terminal is a good model — it writes check-ins straight to Firestore in both environments, so it
behaves identically everywhere. The reminder sender is the other model: one shared function used by
both the cron and the dev server, so the two cannot drift.

---

## Data model

Firestore collections: `homes`, `staff`, `residents`, `checkins`, `jobLogs`, `pushLogs`
(the rules also allow `device_bindings`, which is unused).

### `homes/{homeId}`

```json
{ "id": "home-1788787242830-y5lf", "name": "Arbor Village",
  "cutoffTime": "09:15", "timezone": "Africa/Johannesburg", "createdAt": "2026-09-07T..." }
```

### `staff/{staffId}`

```json
{ "id": "<firebase auth uid>", "homeId": "home-...", "name": "Shaun Gordon",
  "email": "…", "role": "admin" }
```

`role` is one of `admin`, `home_admin`, or `nurse` in live data. The TypeScript type says
`'admin' | 'home_admin'`, so the `nurse` value is effectively untyped — worth fixing.

### `residents/{residentId}`

```json
{ "id": "res-1788803416495-d1ek", "homeId": "home-...", "name": "Sarah van der Merwe",
  "phone": "", "roomNumber": "1", "unitNumber": "", "isDeviceLinked": true,
  "linkedAt": "2026-09-07T...", "oneTimeLinkCode": "LINK-1-ABCD", "linkCodeGeneratedAt": "…",
  "pushToken": null, "pushSubscription": { "endpoint": "…", "keys": { "p256dh": "…", "auth": "…" } },
  "language": "en", "isAway": false, "awayStartDate": null, "awayEndDate": null, "awayNote": "",
  "emergencyContactName": "…", "emergencyContactRelation": "…", "emergencyContactNumber": "…",
  "notes": "…", "createdAt": "2026-09-07T..." }
```

Only a handful of residents have a `unitNumber`; `roomNumber` is the reliable identifier, which is
why the reports label the column "Room / Unit".

### `checkins/{homeId}_{residentId}_{YYYY-MM-DD}`

Document IDs are deterministic, so there is exactly one check-in per resident per day:

```json
{ "id": "home-..._res-..._2026-09-14", "homeId": "home-...", "residentId": "res-...",
  "date": "2026-09-14", "status": "awaiting", "timestamp": "2026-09-14T…",
  "updatedBy": "morning_job", "notes": "" }
```

- `status`: `awaiting` | `ok` | `not_ok` | `no_response`
- `updatedBy`: `resident` | `staff_override` | `cutoff_job` | `morning_job` | `auto_away`
- `jobLogs/{id}` and `pushLogs/{id}` are write-only audit trails shown in the admin panel.

---

## Authentication

**Production.** `StaffLoginScreen` tries the server route first and falls back to Firebase Auth.
Each browser tab gets its own Firebase app instance using `inMemoryPersistence`, and the session is
mirrored into `sessionStorage`, so several staff can be signed in side by side in different tabs
without clobbering each other.

**Local dev.** `POST /api/auth/login` with `{ email, password }` returns the Base64 token;
`authenticateStaff()` decodes it and looks the staff member up in Firestore. An `admin` may target
another home by sending an `X-Home-Id` header or `?homeId=`.

**Security rules — important.** `firestore.rules` currently allows `read, write: if true` on every
collection. Anyone holding the public client config (it ships in the bundle) can read and write the
whole database. This is the top item to fix before real resident data is used in production.

---

## Scheduled jobs and crons

| Job | SAST time | What it does | Trigger |
|---|---|---|---|
| Morning reset | 07:00 | Sets every resident back to `awaiting` (away residents are auto-marked `ok` with `updatedBy: auto_away`) | **Dev only** (`server.ts` interval). In production the equivalent runs at 00:00 SAST from `/api/cron/daily-reset` |
| Reminder push | 08:00 | Sends the web-push reminder to residents still `awaiting` | Vercel cron `/api/cron/reminder-push` — `0 6 * * *` UTC |
| Cutoff sweep | per home `cutoffTime`, 09:15 by default | Marks anything still `awaiting` as `no_response` | **Dev only — there is no production cron for this** (see Known issues) |

- In production, `/api/cron/daily-reset` runs at `0 22 * * *` UTC (00:00 SAST) and both resets
  today's records and creates today's document for every resident.
- The Vercel crons are declared in `vercel.json`; the plan is Hobby, where scheduling precision is
  **±59 minutes**. That is why the reminder is scheduled at 08:00 and not 08:55 — a 08:55 job could
  fire after the 09:15 cutoff it is meant to prevent.
- `api/cron/*.js` accept a manual trigger: `?key=$CRON_SECRET`, plus `&dry=1` on the reminder
  endpoint to see who would be messaged without sending anything.
- **Running the dev server overnight duplicates the jobs** against the live database.

---

## Features

### Resident terminal (`ResidentCheckInScreen.tsx`, reachable at `/checkin/:residentId`)

- Starts with language selection — English or Afrikaans (saved to `localStorage` and to the resident
  document). Every later string comes from the same dictionary.
- Two large buttons: green **I'm OK** and red **I need help**, with a full-screen colour flash, a
  WebAudio chime, and haptic vibration.
- Confirmations: "Thank you, … checked in at HH:MM" and "Help is on its way", the latter offering
  **I'm fine after all** to turn a help request back into a check-in.
- Writes `checkins/{homeId}_{residentId}_{date}` directly to Firestore from the client, in both
  environments, with `updatedBy: 'resident'`.
- Live listener on that one document: when the morning reset returns it to `awaiting`, or a nurse
  overrides it, the phone updates itself with no action from the resident.
- Unpaired screen: clears the local binding and shows a short "this phone has been unpaired" notice
  when an admin rotates the pairing code. Checked on load and every 60 seconds.
- Installed as a PWA it remembers its `/checkin/...` URL, so the home-screen icon opens straight to
  the resident screen and the shortcut is titled "<First name> - Room N".
- Optional daily reminders: a bell in the header plus a one-tap banner that requests notification
  permission and registers a push subscription.

### Staff portal (`AdminPanel.tsx`)

- **Live Status Dashboard** — residents grouped into needs attention, awaiting (past cutoff),
  awaiting (on time), checked in, and away; live via a Firestore `onSnapshot` listener; optional
  sound alert and an urgent banner when someone taps "I need help".
- **Resident Management** — add/edit/delete residents, CSV import (with a downloadable template),
  per-resident QR pairing, rotate pairing URL (kills old QR codes and unlinks the device), mark a
  resident away/on leave, staff override of a status, and an export of all pairing QR data as CSV.
- **Home Settings & Daily Cycle** — home name and cutoff time, timezone.
- **Reports & Exports** — the daily report and the 7/30-day export (below).
- **All Homes & Staff Overview** — admin only: create/delete villages, create/reassign staff, reset
  passwords.
- Dark and light themes via `useAppTheme()`.

### Device pairing

1. Admin opens a resident and shows the QR code (or the `/link` screen for a typed code).
2. The resident's phone opens `/checkin/<residentId>?pair=<code>`; the code is validated against
   `residents.oneTimeLinkCode`, then the device is bound in `localStorage` and the code is cleared.
3. Rotating the code invalidates older QR codes immediately and unpairs the phone.

---

## Reminder notifications

One sender, two callers — the Vercel cron in production and `server.ts` locally — so what you test
locally is what runs in production.

1. The resident taps the reminder banner: `src/lib/push.ts` asks for permission, subscribes with the
   VAPID public key, and stores `pushSubscription` on the resident document.
2. At 08:00 SAST `api/cron/reminder-push.js` builds the target list: today's check-ins that are
   still `awaiting`, minus residents who are away, minus anyone without a subscription.
3. It sends in batches, writes a row to `pushLogs` for every attempt, and clears subscriptions the
   push service reports as dead (404/410) so they stop being retried.
4. `public/sw.js` receives the push and shows the notification; tapping it opens that resident's
   check-in screen.

Notes: on iPhone this only works from the app added to the Home Screen (an Apple rule, iOS 16.4+),
and the sender needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` set in the project
environment. Escaped `\n` sequences inside `FIREBASE_PRIVATE_KEY` are handled by the sender, so the
key can be pasted into the dashboard as one line.

---

## PDF reports

Both reports are rendered by one module, `src/lib/checkInReport.ts`, so their format stays identical:
emerald header band with the title and home name, a large date-or-period heading, a summary line, a
grid table whose verdict cell is filled green (Yes) or red (No), page numbers on every page, and a
legend.

| Report | Producer | Rows |
|---|---|---|
| Daily Check-In Report | `buildDailyReportPdf()` | one row per resident, today only — Name, Room / Unit, Checked in |
| 7 / 30 Day Check-In Report | `buildPeriodReportPdf()` | one row per check-in — Name, Room / Unit, Date, Checked in |

"Yes" means the status is `ok`; `awaiting`, `no_response` and `not_ok` all print "No" in red. Away
residents are auto-marked `ok` by the morning reset, so they read as Yes.

---

## Marketing pages and the interactive demo

`ElderWatch_marketing.html` is a single self-contained page: the full pitch, an **interactive demo**
of the resident screen (language selection, green/red taps, confirmations, the 08:00 reminder
notification, a step rail and a "play the whole flow" button), both contact links, and the logo
inlined as a data URI. Nothing is persisted, so it always restarts from the language selection.

- It is served at `/marketing` from `public/marketing.html` — the repo root files are **not** part of
  the Vite build, so editing the root file alone changes nothing on the live site.
- The demo lives in one block between the `EW-DEMO:START` / `EW-DEMO:END` markers. Keep it that way
  so the copies cannot drift.
- `ElderWatch_mobile_marketing.html` (dark design) and `ElderWatch_mobile_marketing2.html` are
  earlier designs kept for reference; both also carry the demo and the legal footer.

---

## Local development

### Prerequisites

- Node 20+ (developed on Node 26)
- `service-account.json` for the Firebase project **`elderwatch-14712`** in the project root — the
  server refuses to start without it. It is gitignored; never commit it.
- Network access to Firestore.

### First run

```bash
npm install
cp /path/to/service-account.json .            # Firebase Admin credentials (project elderwatch-14712)
npx tsx server.ts                             # Express + Vite on http://localhost:3000
```

Then open http://localhost:3000 and sign in with any staff account that exists in Firestore for that
home. There is no seeded password in this repository — staff records and passwords live in the
database (`SEED_ADMIN_PASSWORD` / `SEED_NURSE_PASSWORD` exist as Vercel variables for the seeding
path).

Reminders and the cron triggers additionally need `.env.local` (see below); without it the server
still runs, the reminder sender just reports that the VAPID keys are missing.

### What "working" looks like

```bash
curl localhost:3000/api/health        # {"status":"ok","homesCount":…,"residentsCount":…}
```

---

## Environment variables

### Local (`.env.local`, gitignored — see `.env.example`)

| Variable | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web-push sender credentials |
| `VITE_VAPID_PUBLIC_KEY` | Same public key for the client bundle (optional; `src/lib/push.ts` has a fallback) |
| `CRON_SECRET` | Manual cron triggering (`?key=…`); the endpoint also accepts Vercel's own cron header |
| `REMINDER_DRY_RUN` | `1` makes the local reminder job log its targets without sending |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Filled in automatically from `service-account.json` at boot |

### Vercel (project settings)

`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`,
`FIREBASE_SERVICE_ACCOUNT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
`CRON_SECRET`, `VITE_FIREBASE_*` (project id, API key, auth domain, sender id, app id),
`SEED_ADMIN_PASSWORD`, `SEED_NURSE_PASSWORD`, `APP_URL`, `GEMINI_API_KEY` (legacy).

The client Firebase config is compiled into `src/lib/firebase.ts` with `VITE_*` overrides, so the
app works even with none of the `VITE_*` variables set.

---

## Deployment

```bash
git push origin main        # Vercel auto-deploys production from main
```

- Project: `shauns-projects-d6724177/elderwatch3` → https://elderwatch3.vercel.app
- Two cron jobs from `vercel.json`: `daily-reset` at 22:00 UTC and `reminder-push` at 06:00 UTC.
- `api/cron/*.js` get `maxDuration: 60`.
- Changing an environment variable needs a redeploy to take effect.
- The service worker caches assets stale-while-revalidate, so a phone may show the previous bundle
  for one load after a deploy — refresh twice if something looks stale.

---

## Development scripts

`scripts/` holds one-off TypeScript utilities run with `npx tsx scripts/<name>.ts`:

| Script | Purpose |
|---|---|
| `setup-auth.ts` | Wire up staff auth records |
| `add-staff.ts`, `add-user.ts` | Create staff accounts |
| `check-staff.ts`, `check-checkins.ts` | Inspect staff and check-in state |
| `cleanup-staff.ts` | Remove duplicate/stale staff |
| `fix-auth.ts`, `fix-neeri.ts`, `reset-vaughn-jay.ts` | Data repairs for specific accounts |
| `generate-icons.js` | Regenerate PWA icon sizes |

`data/elderwatch-data.json`, `bun.lock`, `metadata.json`, `logo.jpeg` and `firebase-blueprint.json`
are leftovers from earlier iterations.

---

## Checks before you push

```bash
npx tsc --noEmit      # see Known issues — currently fails only in the legacy functions/ folder
npm run build         # client bundle + dist/server.cjs
```

Beyond that: run the app locally against the live database and click through the flow you changed.
For the marketing demo there is a jsdom harness covering every screen, both languages, both buttons,
the reminder notification, the play-through and the reload reset.

---

## Known issues and gotchas

1. **Firestore rules are wide open** (`allow read, write: if true`). Fix before real data.
2. **The cutoff sweep never runs in production.** `runCutoffSweepJob()` exists only in `server.ts`,
   which is not deployed, and neither Vercel cron calls it — so in production a resident who never
   checks in stays `awaiting` instead of becoming `no_response`. The dashboard still groups them as
   "past cutoff" client-side (it compares the clock), so the board looks right, but the stored
   status and anything derived from it are not. Add an `/api/cron/cutoff-sweep` endpoint if the
   stored status matters for reporting.
3. **Local dev writes to the live database.** Nothing is sandboxed; test writes are visible to real
   users, and the dev server also runs the scheduled jobs.
4. **`npx tsc --noEmit` fails** on `functions/src/index.ts` (firebase-admin v14 namespace imports).
   Pre-existing, unrelated to the app, and `functions/` is not deployed — either fix or delete it.
5. **`api/cron/daily-reset.js` only reads the first page of `checkins`** (`pageSize=300`, no
   pagination). The collection is already past 1,000 documents and only ~38 of a day's 131 records
   fall inside that page, so the "reset existing check-ins" pass silently misses most of them. The
   create-if-missing pass covers the gap, which is why mornings still look right. The reminder job
   avoids this by using a date-filtered `runQuery`.
6. **Cutoff mismatch:** the resident screen warns at a hard-coded `9:00` while homes default to
   `09:15`.
7. **No offline queue.** The banner promises that taps "sync automatically", but the Firestore write
   is fire-and-forget with no retry, so a tap made offline is lost.
8. **"Call Sister" never renders** — it only appears when a resident's phone number is set, and the
   profile hard-codes it to an empty string.
9. **No undo after "I'm OK"** — the `undo` string exists but no control uses it; only the help screen
   can be reversed.
10. **The SSE stream in `server.ts` is unused.** The React app never opens an `EventSource`; real-time
    updates come from Firestore `onSnapshot`.
11. **Marketing pages are invisible to the Vite build.** Only `public/marketing.html` is served; the
    root HTML files are the source, not the deployment.
12. **The `nurse` role is untyped** (`'admin' | 'home_admin'` in `types.ts`, `nurse` in the database).
13. **No LICENSE file.** See below.

---

## Not built (things earlier docs claimed)

An earlier README described features that do not exist in this codebase. For accuracy:

- "Offline-First Queue … automatically synced" — not implemented; there is no IndexedDB queue.
- "7-Day Status History" week strip on the resident screen — not implemented.
- "Exportable Audit Logs (CSV/JSON)" per check-in — the app has CSV **import**, a pairing-CSV export,
  and the PDF reports, but no per-check-in CSV/JSON export.
- "Live SSE Broadcasts" for the admin board — the board uses Firestore listeners instead.

---

## Legal

© 2026 Shaun Gordon · ElderWatch. All rights reserved. Patent Pending.

ElderWatch and its software, design and content are protected by copyright law. Unauthorised copying,
modification or distribution is prohibited.

No open-source licence is granted for this repository; the notice above is the governing statement.
