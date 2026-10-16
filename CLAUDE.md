# CLAUDE.md — CheatNoNO

Anti-cheat companion for **Google Forms** exams: a Chrome MV3 extension + **Supabase** backend + teacher dashboard.
Full requirements live in **`docs/PRD.md`** — read it before starting a milestone. FR-/NFR-/D- numbers below refer to it.

# Project Guidelines & Design System Enforcement

## CRITICAL: Frontend & Design System Rule

Before writing any code, creating components, or building frontend screens, you MUST read and follow the specifications inside the `CheatNoNo` directory:

- **Design Tokens & Styles:** Review `CheatNoNo/tokens.json` and `CheatNoNo/tokens.css` for colors, typography, spacing, and styling tokens. Do not hardcode arbitrary values.
- **Screen Specifications:** Review `CheatNoNo/screens.md` and the relevant subdirectories in `CheatNoNo/components/` for screen layout, functional logic, and expected component structures.

## Workflow Rule

1. Always check `CheatNoNo/screens.md` to understand the layout requirements for the screen you are building.
2. Always apply the styling rules and design tokens from `CheatNoNo/tokens.css` or `tokens.json`.
3. Reuse existing component blueprints found within the `CheatNoNo/components/` folder structure rather than inventing new styles from scratch.

## Current status

- **M1 done:** extension skeleton with a mock backend (`chrome.storage`), dev popup, passing e2e test
  (rebuilt in this folder on 2026-10-15; includes the D10 "I don't agree" button, the FR-20 input guard and the
  FR-16 allowlist). Manual gate and known limits: `README.md`.
- **M2 done:** Supabase migration + seed + pgTAP + `anon_isolation.py`, esbuild bundling (`extension/build.mjs`),
  `backend.supabase.js`, FR-26 resume, and `tests/e2e/run_e2e_supabase.py` covering the PRD §11 M2 acceptance
  (unlock within 6 s and consumed once, worker kill loses nothing, browser restart resumes, test end closes attempts).
- **M3 done (Phase 4):** `dashboard/` (Vite + React): email/password sign-up with email confirmation, tests list, test
  editor, Go live with the D7 checkboxes, live monitor (Realtime + 5 s poll fallback), Unlock, End flow (D13), delete data.
  Migration `teacher_lifecycle` adds `go_live`, `end_test`, the `submitted_after_close` flag (in `finish_attempt`) and
  column-level grants: teachers edit DRAFT tests only, and status changes only through the RPCs. Covered by
  `tests/e2e/run_e2e_dashboard.py` (two teachers + one live student). Not built yet: the data-retention setting (D14,
  shown as text only), timeline/report/heatmap/CSV/reconciliation (M4), onboarding page (FR-34).
- **M4 done (Phase 5):** `dashboard/` adds the class report (`/tests/:id/report`: ranked integrity scores, question heatmap, CSV of
  attempts and events, reconciliation upload per D8) and the student timeline (`/tests/:id/attempts/:attemptId`: ring, score
  breakdown, event list, connection-gap markers per D12). Scoring is the pure `extension/src/shared/integrity.js` (§6.8); CSV and
  reconciliation are `dashboard/src/lib/{csv,reconcile,report}.js`. The extension now writes a `connection_gap` event when a
  heartbeat is accepted after more than 30 s of silence (`backend.supabase.js`); gaps are shown, never scored. Covered by
  `tests/e2e/run_e2e_reports.py` (headless, seeds data by SQL) plus unit tests. Not built: PDF export, answer-correlation (needs
  answer data, which D6/NFR-1 rule out), data-retention setting (D14), onboarding page (FR-34).
- **Local auth config:** `supabase/config.toml` has `enable_confirmations = true`; confirmation emails are read from Mailpit
  (http://127.0.0.1:54324). After changing config.toml run `supabase stop && supabase start`.
- The Supabase build is `extension/dist/` (load that unpacked). `extension/` itself still runs with the mock backend.
- Schema deviations from PRD §8: `events` has `seq` (unique per attempt, makes retried batches idempotent) and
  `received_at`; `commands` insert policy also checks test ownership; one open attempt per student per test is enforced
  by a unique index. `heartbeat` returns `{status, strikes, commands:[{id,type}], closed, finished}`; an unlock applies
  only to a locked attempt and sets `strikes = least(reported, maxStrikes - 1)`.

## Product decisions you must respect (PRD §13)

- **No messaging** between teacher and students (D1). Don't add chat/message UI or tables.
- **No grace period** for short focus losses in v1 (D2). Every leave episode is a strike.
- **No Google sign-in, no OAuth, no Google Forms API** (D3, D6). Students type name + email; teachers use
  Supabase email/password. Students are Supabase **anonymous** users behind the scenes.
- **No exam time windows** (D4).
- **Limit to 1 response** is required on protected forms, with a dashboard attestation before Go live (D7).
- **Reconciliation** of responses against attempts is how unmonitored submissions are found (D8). No per-student
  monitoring switch (D11). Refusing consent is not a strike (D10).
- **Install guide requires "Allow in incognito"** (D9). Offline gaps are shown, not penalized (D12).
- **End test** follows D13: stop responses in Forms first. Data is kept 180 days by default (D14).
- If a task seems to need one of these, stop and ask instead of building it.

## Repo layout

```
CLAUDE.md
PRD.MD                              product requirements (source of truth for scope; this file is at the repo root,
                                    not docs/PRD.md as written elsewhere in this file)
README.md                           install, manual test checklist, known limits
DEPLOY.md                           hosted Supabase + dashboard hosting + student install steps
extension/                          Chrome extension (load this folder unpacked)
  manifest.json
  src/shared/integrity.js           integrity score (PRD §6.8), leave episodes, gaps, question heatmap (pure; dashboard reuses it)
  src/shared/constants.js           DEFAULT_SETTINGS, DEFAULT_BLOCKLIST, parseFormId, hostOf, domainMatches, phaseForStrikes
  src/background/background.js      service worker: sessions, leave episodes, snap-back, DNR blocklist, messages
  src/background/backend.js         re-exports the active backend — the ONLY import site for data access
  src/background/backend.mock.js    offline backend on chrome.storage.local (used by e2e)
  src/background/backend.supabase.js  Supabase backend (anonymous auth, event queue, heartbeat commands); bundled only
  src/shared/supabaseConfig.js      SUPABASE_URL + anon key (public by design; local defaults)
  build.mjs, package.json           esbuild: `node build.mjs [supabase|mock]` -> extension/dist/
  src/content/styles.js             EG_CSS string — all overlay styling, theme tokens at top
  src/content/ui.js                 EG_UI — student screens in a closed Shadow DOM
  src/content/content.js            page monitoring + boot flow
  src/blocked/                      page shown when a blocklisted site is hit
  src/popup/                        DEV panel (protect a form, simulate unlock, view events) — temporary
supabase/                           (M2) config.toml, migrations/, tests/ (supabase CLI project)
dashboard/                          Vite + React teacher dashboard (supabase-js): src/pages, src/lib/api.js, src/lib/format.js
tests/e2e/run_e2e.py                Playwright e2e for the extension (mock backend)
tests/e2e/run_e2e_supabase.py       Playwright e2e against the local Supabase stack (M2 acceptance)
tests/e2e/run_e2e_dashboard.py      Phase 4 gate: two teachers + one live student
tests/e2e/run_e2e_reports.py        Phase 5 gate: score, timeline, gaps, CSV, reconciliation, 500 events (headless)
```

## Commands

```bash
# Load the extension: chrome://extensions → Developer mode → Load unpacked → extension/
# After editing: click reload on the extension card, then reload the Form tab.

# Syntax check every extension file
for f in $(find extension/src -name '*.js'); do node --input-type=module --check < "$f" || echo "FAIL $f"; done

# End-to-end test (must pass before any commit touching extension/)
pip install playwright && python -m playwright install chromium && python tests/e2e/run_e2e.py
# Uses Playwright's "chromium" channel; override with CHROME_PATH=/path/to/chrome (branded Chrome 137+ ignores
# --load-extension). Headed: it takes over a window for ~2 minutes, don't touch the keyboard while it runs.
```

M2 database commands (run from the repo root, where `supabase/config.toml` is; Docker Desktop must be running):

```bash
supabase start                 # local Postgres/Auth/Realtime (needs Docker)
supabase db reset              # apply migrations + seed (teacher@example.com / password123, live form seed-form-id-local-dev)
supabase test db               # pgTAP tests in supabase/tests/database/
export SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<ANON_KEY from `supabase status`>
python supabase/tests/anon_isolation.py   # HTTP-level isolation check; every line must say PASS (use `python`, not `python3`, on Windows)
```

Extension build and Supabase e2e:

```bash
npm --prefix extension install                 # once: esbuild + @supabase/supabase-js
npm --prefix extension run build               # esbuild -> extension/dist/ with the supabase backend (load dist/ unpacked)
npm --prefix extension run build:mock          # same bundle with the mock backend
python tests/e2e/run_e2e_supabase.py           # needs `supabase start` + `supabase db reset`; builds dist itself, ~7 min
# Hosted build (see DEPLOY.md): SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon key> npm --prefix extension run build
npm --prefix extension test                    # unit tests for the shared helpers (parseFormId, formLinkIssue, integrity score)
```

Dashboard:

```bash
npm --prefix dashboard install                 # once
npm --prefix dashboard run dev                 # http://127.0.0.1:3000 (port matches site_url so email links land here)
npm --prefix dashboard run build               # production bundle in dashboard/dist (needs SPA rewrites on a static host)
npm --prefix dashboard test                    # unit tests (heartbeat rule, filters, feed text, CSV, reconciliation, timeline)
python tests/e2e/run_e2e_dashboard.py          # the Phase 4 gate: starts the dev server itself, headed student window, ~4 min
python tests/e2e/run_e2e_reports.py            # the Phase 5 gate: starts the dev server itself, headless, ~1 min; needs `supabase start`
```

The dashboard imports `parseFormId`/`formLinkIssue`/`mergeSettings` straight from `extension/src/shared/` (Vite alias
`@shared`) and the design tokens/CSS from `CheatNoNo/` (alias `@design`). Teacher data access goes through
`dashboard/src/lib/api.js` only.

The Supabase e2e (about 7 min) also stops the API gateway container for 60 s (outage), relaunches Chrome without the
extension (disabled mid-exam), closes an attempt via SQL (closed screen) and uses a second profile. Its output is kept in
`tests/e2e/last_run_supabase.log`. It leaves `E2E Student` rows in the local database; `supabase db reset` clears them. The dev popup is
mock-only: with the Supabase build it shows nothing; protect forms and unlock from the dashboard.

## Architecture — how it works

1. Content script runs on `https://docs.google.com/forms/*`, sends `PAGE_LOADED {url}`.
2. Service worker parses the form ID (`parseFormId`), looks up the test via `backend.getTestByFormId`
   (Supabase: RPC `get_live_test`). Not protected → content script exits silently.
3. Consent screen (name + email) → `START_EXAM {url, name, email}` → `backend.createAttempt`
   (Supabase: RPC `start_attempt`, which **returns the existing unfinished attempt** for resume) →
   session stored in `chrome.storage.session`.
4. Browser events (tabs/windows/idle) and content `EVENT`s feed **leave episodes**:
   any leave signal opens ONE episode = ONE strike; it closes when the exam tab is active AND its window focused.
5. On episode close, `phaseForStrikes` sets `warning` → `blurred` → `locked`; worker pushes `STATE` to the tab.
6. Heartbeat every 5 s (Supabase: RPC `heartbeat`) **returns pending teacher commands**; `unlock` → phase
   `active`, strikes `max-1`. No WebSocket needed in the service worker.
7. `/formResponse` URL → `endSession('submitted')` (Supabase: RPC `finish_attempt`) → DNR rules removed.

### Message protocol (content/popup → worker)

| type                                                      | payload            | returns                                                                                               |
| --------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `PAGE_LOADED`                                             | `url`              | `{protected, resume, state?, test?, identity?, incognito?}`                                           |
| `START_EXAM`                                              | `url, name, email` | `{state}` or `{error: 'INCOGNITO'\|'NAME_REQUIRED'\|'EMAIL_REQUIRED'\|'NOT_PROTECTED'\|'NOT_A_FORM'}` |
| `EVENT`                                                   | `kind, detail?`    | `{ok}`                                                                                                |
| `QUESTION`                                                | `q: {i, n}`        | `{ok}`                                                                                                |
| `HEARTBEAT`                                               | `fullscreen`       | `{ok}`                                                                                                |
| `ACK`                                                     | —                  | `{ok, state}`                                                                                         |
| `BLOCKED_INFO` (blocked page)                             | —                  | `{hasSession, mode?, strikes?, max?}`                                                                 |
| `BLOCKED_BACK` (blocked page)                             | —                  | `{ok}`; goes back (exam tab) or closes the tab and refocuses the exam                                 |
| `DEV_STATE` / `DEV_ADD_TEST` / `DEV_UNLOCK` / `DEV_RESET` | dev only           |                                                                                                       |

Worker → content: `{type: 'STATE', state: publicState(session)}` (or `{ended: true, closed: bool}` when the session ends;
`closed: true` shows the "Your teacher has ended this exam" screen, D13).
If you add a message type, add it to this table. Declining consent (D10) sends **no message at all**: the content
script just shows the "declined" screen, so nothing can be recorded.

### Backend interface (`backend.js`) — every backend implements exactly this

```
getTestByFormId(formId)                    -> {id, title, settings} | null      (live tests only)
createAttempt({testId, formId, student})   -> {id, strikes, status, resumed}      (idempotent per uid+test in Supabase)
patchAttempt(attemptId, patch)             -> void
appendEvent(event)                         -> void   (Supabase impl batches; flush every 2 s or 20 events)
heartbeat(attemptId, {status, strikes, q}) -> void   (Supabase impl dispatches returned commands to onCommand handlers;
                                                      never call it inside withSessions: handlers take that lock)
onCommand(handler)                         -> void   handler({type:'unlock'|'closed', attemptId})
                                                     'closed' = the teacher ended the test (D13); background ends the session
dev-only (mock): saveTest, sendCommand, listAttempts, listEvents, listTests, reset
```

`student` = `{name, email, chromeEmail, verified}`; `verified` = typed email === Chrome profile email.

## Invariants — do not break these

- **All session mutations go through `withSessions(fn)`** (mutex + load/save of `chrome.storage.session`).
  Never keep session state only in module variables: the MV3 worker can die at any time.
- **Register every `chrome.*` event listener synchronously at top level** of `background.js`
  (including `backend.onCommand`). Listeners added inside async code are lost when the worker restarts.
- **No dynamic `import()` in the service worker** (Chrome forbids it). Static imports only.
- **No remotely hosted code** (MV3). `supabase-js` must be bundled with esbuild, never loaded from a CDN.
- **`backend.js` is the only data-access seam.** Background code calls `backend.*`; never `chrome.storage.local`
  or Supabase directly.
- **Students write only through RPCs.** No student-facing RLS insert/update policies on tables. RPCs are
  `security definer`, `set search_path = public`, check `auth.uid()` owns the attempt, validate sizes.
- **Only the anon key ships in the extension/dashboard.** Never the service-role key, anywhere client-side.
- **Teacher-only access uses `public.is_teacher()`** (signed in AND not anonymous). Anonymous users are also
  in the `authenticated` role — never treat "authenticated" as "teacher".
- **One episode = one strike.** New leave signals call `startEpisode(s, reason, detail)`; never increment
  `s.strikes` directly elsewhere.
- **Record mode must never block, close, redirect or show overlays** (FR-27). Gate on `settings.mode === 'enforce'`.
- **Lock enforcement is the window-level input guard** in `content.js` (FR-20), not DOM state. Don't move blocking
  into DOM-only mechanisms, and don't remove the guard's `enforce()` interval.
- **Allowlist has one check:** `allowlisted(s, url)` in `background.js`. Allowlisted tabs never open an episode
  or get closed (FR-16). Don't add a second allowlist check elsewhere.
- **Privacy (NFR-1):** log domains via `hostOf()`, never full URLs; titles only when `logTabTitles`; never capture
  keystroke or answer content. Monitoring only during an active protected session.
- **Content scripts are classic scripts** sharing one isolated world, loaded in manifest order:
  `styles.js` (EG_CSS) → `ui.js` (EG_UI) → `content.js`. No `import`/`export` there.
- **Overlay shadow root stays `mode: 'closed'`** in source. The e2e test patches a temp copy to `open`.
- **User-gesture rule:** `requestFullscreen()` must be called synchronously inside the click handler, before any `await`.
- Build overlay DOM with the `h()` helper (child strings → text nodes). Never `innerHTML` with dynamic values.

## Known gotchas

- Event ordering race: `tabs.onCreated` → we close the tab → a late `tabs.onActivated` for the closed tab would
  cost a second strike. Guarded by `s.closedTabs` and by `chrome.tabs.get` failing for missing tabs. Keep both.
- New tabs with a blank or `about:blank` URL are held in `s.pendingTabs` and decided at their first navigation
  (`onUpdated`). Deciding on `about:blank` would close allowlisted tabs before they load.
- `windows.onFocusChanged(WINDOW_ID_NONE)` fires when Chrome loses OS focus and sometimes transiently between
  Chrome windows. Both count as a leave (intentional).
- Opening the extension popup can register as a window switch during manual testing.
- Playwright `ctx.new_page()` may throw because the extension closes the tab — expected.
- Published (`/d/e/<id>/viewform`) and edit (`/d/<id>/viewform`) links have different IDs; `/d/e/` is canonical.
- `chrome.storage.session` is cleared when Chrome quits; resume relies on `start_attempt` returning the open attempt.
- Google Forms DOM is unofficial; question tracking uses `div[role="listitem"]`. Keep that selector in one place.
- **supabase-js in a service worker:** no `localStorage`. Create the client with
  `auth: { storage: chromeStorageAdapter, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }`.
- Supabase free projects **pause after 7 days idle**; surface a clear "server unreachable" state, don't hang.
- Anonymous sign-ins must be **enabled** in the Supabase dashboard (Auth → Providers / Settings).

## Conventions

- Extension: plain modern JavaScript (ES2022), no framework. 2-space indent, single quotes, semicolons.
- Dashboard (M3): Vite + React + supabase-js; same style rules.
- SQL: lowercase keywords, `snake_case`, one migration per change (`supabase migration new <name>`), never edit an
  applied migration.
- DB columns are `snake_case`; JS objects are `camelCase`. Map at the backend boundary only.
- Small pure helpers go in `extension/src/shared/` so the dashboard can reuse them (form parsing, scoring, ladder).
- Event names are `snake_case` and must be listed in PRD §8 "Event types". Client event
  `{attemptId, t, type, q, ...detail}` → row `{attempt_id, t, type, q, data: detail}`; `data` < 2 KB.
  Detail keys must never be `type`, `t`, `q` or `attemptId`: the spread would overwrite the event's own field
  (this bit us once: a `type` detail key logged `input_while_blocked` as `click`).
- UI copy is student-friendly, short, non-accusatory ("You left the exam", not "Cheating detected").
- Styling changes go in `styles.js` (theme tokens at the top); markup in `ui.js` `screens`.
- Don't add permissions to `manifest.json` without explaining why in the commit message.
- Update `docs/PRD.md` milestone status and this file when a milestone finishes.

## Definition of done (any change)

1. Syntax check passes. 2. `python tests/e2e/run_e2e.py` passes. 3. DB changes: `supabase db reset` +
   `supabase test db` pass. 4. New behaviour has a test where feasible. 5. Record mode still silent.
2. Docs (this file / PRD) updated if behaviour, protocol or schema changed.

## Milestone 2 plan (Supabase) — done, kept for reference

1. **Supabase project** in `supabase/` (`supabase init`). Migration `0001_init.sql` from PRD §8: tables,
   indexes, `is_teacher()`, RLS policies, RPCs (`get_live_test`, `start_attempt`, `log_events`, `heartbeat`,
   `finish_attempt`), grants (`execute` to `authenticated`, revoke from `anon`), realtime publication for
   `attempts` and `events`. Seed: one teacher + one live test for local dev.
2. **DB tests** (`supabase/tests/*.sql`, pgTAP) covering PRD §11 M2 security cases.
3. **Bundling:** `extension/package.json` with esbuild: bundle `src/background/background.js` (ESM) → `dist/`,
   copy manifest + static files; content scripts copied as-is. Build flag `BACKEND=mock|supabase`
   (e2e uses mock). Update Commands.
4. **`src/background/backend.supabase.js`:** same interface as the mock.
   - `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storage: chromeStorageAdapter, … } })`.
   - Lazily `signInAnonymously()` once; reuse the stored session.
   - `getTestByFormId` → `rpc('get_live_test')`; `createAttempt` → `rpc('start_attempt')` (returns row incl.
     status/strikes so background can restore the phase).
   - `appendEvent` → queue in memory + `chrome.storage.local`; flush via `rpc('log_events')` every 2 s / 20 events;
     retry with backoff when offline.
   - `heartbeat` → `rpc('heartbeat')`; for each returned command call registered `onCommand` handlers.
   - `patchAttempt` → piggyback status/strikes on the next heartbeat (or `heartbeat` immediately on lock).
5. Config in `src/shared/supabaseConfig.js` (URL + anon key; public by design, security is RLS + RPCs).
6. Background: on resume from `start_attempt`, restore `strikes`/phase from the returned row (FR-26).
7. Acceptance: PRD §11 M2.
