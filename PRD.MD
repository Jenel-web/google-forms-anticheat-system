# ExamGuard — Product Requirements Document

|                  |                                                        |
| ---------------- | ------------------------------------------------------ |
| **Product**      | ExamGuard: anti-cheat companion for Google Forms exams |
| **Owner**        | Jenel                                                  |
| **Status**       | v1.2 · Milestone 1 (extension skeleton) complete       |
| **Backend**      | Supabase (Postgres, Auth, Realtime)                    |
| **Last updated** | 2026-10-15                                             |

### Changelog

- **v1.2:**
  - Fixed two bugs found in M1: allowlisted sites counted as strikes (FR-16), and the lock could be removed with DevTools (FR-20).
  - Added decisions D7 to D14 (§13) and updated the requirements, schema, events, milestones and risks they affect.
- **v1.1:**
  - Switched the backend from Firebase to **Supabase**.
  - Removed Google sign-in. Teachers use email and password. Students type their name and email, with no account (anonymous auth behind the scenes).
  - Closed the open questions (§13).
- **v1.0:** Initial draft.

---

## 1. Summary

Teachers increasingly give exams through Google Forms, which has no built-in protection on personal or mixed devices (Google's "Locked mode" only works on managed Chromebooks). ExamGuard is a **Chrome extension + Supabase backend + teacher web dashboard** that:

1. **Deters** cheating: it snaps students back to the exam tab, closes stray tabs, blocks AI and answer sites, and requires fullscreen.
2. **Detects** cheating: it records every tab or window switch with the site visited, the duration, and the question the student was on.
3. **Escalates** fairly: a strike ladder (warn → final warning → lock until the teacher unlocks).
4. **Explains** what happened: a live monitor during the exam and an integrity report afterwards.

The teacher protects a test by pasting the Google Form link into the dashboard. Any student who opens that link with the extension installed is subject to the test's rules.

### What makes it different from a lockdown app

Lockdown apps (like a desktop Alt+Tab blocker) try to block everything at the OS level, need a separate install per OS, and give teachers no evidence. ExamGuard works inside Chrome on any OS. It treats tab-leaving as **evidence tied to specific questions**, not just a counter, and it gives the teacher a live, explainable timeline.

---

## 2. Goals and non-goals

### Goals

- G1. Make leaving a protected exam **visible, recorded and costly** for students.
- G2. Block the most common cheating destinations (AI chatbots, answer sites) during the exam.
- G3. Give teachers **real-time** visibility and control (unlock) during an exam.
- G4. Give teachers a **post-test report** with per-student timelines and a per-question heatmap.
- G5. Work on **mixed devices**: Chromebooks, Windows, macOS and Linux, on managed or personal machines.
- G6. Be transparent with students: explicit consent, clear rules, and no monitoring outside a protected exam.
- G7. **Low friction:** no accounts for students, and only email and password for teachers.

### Non-goals (v1)

- Blocking Alt+Tab to **other applications**, second devices or phones. This is impossible from a browser extension. We **detect and log** leaving the browser instead.
- **Messaging** between the teacher and students, in either direction (decision D1).
- **Exam time windows.** No start or end time is enforced by the extension (decision D4).
- **Google sign-in or OAuth**, and any **Google Forms API** integration or answer-correctness correlation (decision D3).
- Webcam or microphone proctoring, screen recording, or screenshots.
- Browsers other than Chrome and Chromium.
- Grading, or editing the Google Form itself.
- Mobile (phone or tablet) exam taking.

---

## 3. Users

| Persona                         | Needs                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Teacher** (primary)           | Protect a form in under a minute. See who is cheating live. Unlock locked students. Get defensible evidence afterwards. |
| **Student**                     | Understand the rules before starting. Not get falsely punished. No account needed.                                      |
| **School IT admin** (secondary) | Optionally force-install the extension on managed Chrome or Chromebooks.                                                |

---

## 4. User stories

### Teacher

- T1. As a teacher, I sign up and sign in to the dashboard with **email and password**.
- T2. As a teacher, I paste a Google Form link, give it a title, and choose settings, so the form becomes protected.
- T3. As a teacher, I choose **enforce** mode (block and lock) or **record-only** mode (silent logging).
- T4. As a teacher, I edit the blocklist and allow-list (for example to allow an online calculator).
- T5. As a teacher, during the exam I see each student's live status: active, away, warned, locked, submitted, or no heartbeat.
- T6. As a teacher, I see an alert when a student is locked, and I can **unlock** them.
- T7. As a teacher, after the exam I open a student's timeline and see when they left, where they went, for how long, and on which question.
- T8. As a teacher, I see a class report: integrity scores ranked, a question heatmap, and a CSV export.
- T9. As a teacher, I share an onboarding link so students can install the extension before exam day.

### Student

- S1. When I open a protected form, I see what is monitored and I must consent before the exam starts.
- S2. I type my **name and email**. If my Chrome profile has an email, it's pre-filled, and a matching email is marked **verified**.
- S3. If I accidentally leave, I get a warning that explains what happened and how many strikes I have left.
- S4. If I get locked, I see that my teacher has been notified, and the exam resumes when they unlock me.
- S5. If I reload, close the tab, or restart Chrome, my exam resumes with the same attempt (strikes are kept).
- S6. When I submit, monitoring stops immediately.

---

## 5. System overview

```
┌──────────────────────── Student's Chrome ────────────────────────┐
│  Content script (Google Form page)     Service worker            │
│  - consent + overlays (Shadow DOM)  ⇄  - sessions & strikes      │
│  - fullscreen, copy/paste, keys        - tabs/windows listeners  │
│  - question tracking, heartbeat        - snap-back, close tabs   │
│                                        - AI blocklist (DNR rules)│
└───────────────────────────────────────────────┬──────────────────┘
                     supabase-js (bundled), anonymous auth, RPC calls
                                     ┌──────────▼──────────┐
                                     │ Supabase            │
                                     │ - Postgres + RLS    │
                                     │ - RPC functions     │
                                     │ - Auth (email/anon) │
                                     │ - Realtime          │
                                     └──────────▲──────────┘
                                                │ Realtime subscriptions
                                     ┌──────────┴──────────┐
                                     │ Teacher dashboard   │
                                     │ Vite + React        │
                                     │ (Vercel/Netlify)    │
                                     └─────────────────────┘
```

**Key design choice:** the extension talks to Supabase **only through RPC functions** (`security definer`). It never writes to tables directly. This keeps Row Level Security (RLS) simple, and it means the student client can only do exactly what the RPCs allow. Teacher unlocks are delivered **in the heartbeat response**, so the extension needs no Realtime socket inside the service worker.

---

## 6. Functional requirements

### 6.1 Extension: activation

- **FR-1** The content script runs on `https://docs.google.com/forms/*`. It activates **only** on `/viewform` pages whose form ID belongs to a test with status `live`.
- **FR-2** The form ID is parsed from `/forms/[u/N/]d/[e/]<id>/viewform`. The `/d/e/` (published) ID is the canonical one.
- **FR-3** The extension stays inactive on every other page, and when no protected exam is in progress.
- **FR-4** Incognito windows: the exam refuses to start and shows the "private window" screen.

### 6.2 Extension: consent and identity

- **FR-5** The consent screen shows:
  - the test title;
  - a **name** field (required, up to 100 characters);
  - an **email** field (required, valid format, up to 200 characters), pre-filled from `chrome.identity.getProfileUserInfo` when available;
  - a list of active rules, a consent checkbox, and **Start exam**.
- **FR-6** Clicking **Start exam** enters fullscreen (when required) inside the user gesture, then starts the attempt.
- **FR-7** Student identity is `{ name, email, chromeEmail | null, verified }`, where `verified = chromeEmail === email` (case-insensitive). The dashboard shows a ✓ for verified students and "unverified" for the rest.
- **FR-7a** There are no student accounts. The extension signs in to Supabase **anonymously** once per Chrome profile, and keeps the session in `chrome.storage.local`. That anonymous uid owns the student's attempts.

### 6.3 Extension: detection (leave episodes)

- **FR-8** Each of the following opens a **leave episode**:
  - `tab_switch`: another tab is activated in the exam window.
  - `tab_opened`: a new tab is created.
  - `other_window`: another Chrome window is focused.
  - `left_browser`: Chrome loses OS focus.
  - `navigated_away`: the exam tab navigates off allowed hosts.
  - `exam_tab_closed`: the exam tab is closed.
  - `visibility_hidden`: the page becomes hidden (a fallback signal).
- **FR-9** **One episode = one strike**, however many signals fire during it. There is **no grace period** in v1 (decision D2): every focus loss counts, however short.
- **FR-10** An episode closes when the exam tab is active **and** its window is focused. The `returned` event records the duration, reasons and domains visited.
- **FR-11** During an episode, the domain of every tab visited or navigated is logged. Tab titles are logged only when `logTabTitles` is enabled.
- **FR-12** In-page signals are logged (and blocked in enforce mode):
  - copy, cut, paste and right-click;
  - F12 and Ctrl/Cmd+Shift+I/J/C;
  - Ctrl/Cmd+U/P/S;
  - PrintScreen (logged only);
  - fullscreen exit and enter;
  - idle and locked states (via `chrome.idle`, logged only).
- **FR-13** Current question tracking is best effort: the `div[role="listitem"]` nearest the viewport centre. It is stored as `{ i, n }` and attached to every event.
- **FR-14** A heartbeat is sent every 5 seconds while the exam is active. The `heartbeat` RPC updates the attempt and **returns any pending teacher commands** (see FR-21).

### 6.4 Extension: enforcement (enforce mode only)

- **FR-15** **Snap-back:** on a tab or window switch, refocus the exam window and tab (`drawAttention: true`).
- **FR-16** New tabs are **closed immediately** unless their URL is on the allowlist (§7). A tab with no URL yet is decided at its first navigation.
  - Allowlisted sites never open a leave episode, never count as a strike, and are never closed or snapped away from. They are logged as `allowed_tab_opened` or `allowed_site_viewed`.
  - Subdomains of an allowlisted domain are allowlisted too. An allowlisted domain is never redirected by the AI blocklist, even if it's also on that list.
  - Limitation: an allowlist entry can't carve a subdomain out of a blocked parent domain.
- **FR-17** The exam tab navigating off allowed hosts triggers `goBack()`.
- **FR-18** **AI and answer-site blocking:** while any protected session is live, `declarativeNetRequest` session rules redirect blocklisted domains (main_frame) to `blocked.html?site=<domain>`. The rules are removed when no live session remains.
- **FR-19** The strike ladder (`phaseForStrikes`), with the default `maxStrikes = 3`:
  - 1 → `warning` (the student acknowledges).
  - `max − 1` → `blurred`: the final warning, with the page blurred (the student acknowledges).
  - `max` → `locked`: waits for the teacher.
- **FR-20** **Lock enforcement.** While any overlay is showing, the lock must hold even if the page is tampered with (for example, DevTools removing the overlay or clearing `body.inert`):
  - `body.inert = true` is set, and a capture-phase input guard on `window` stops all input that doesn't come from the overlay itself: click, pointer, touch, key, submit, input, change, drag and drop. The guard doesn't depend on the page DOM.
  - A `submit` while an overlay is showing is blocked and logged as `submit_while_blocked`. Other blocked input is logged as `input_while_blocked`, at most once per second.
  - Focus is pulled back to the overlay if something outside it gains focus.
  - Every 250 ms the overlay is rebuilt if it was removed, unhidden, or `body.inert` was cleared.
  - The server can't block a Google Forms submission, so a blocked submit attempt is evidence. It appears in the timeline.
- **FR-21** Teacher unlock: the dashboard inserts an `unlock` row into `commands`. The next heartbeat (≤ 5 seconds later) returns it and marks it consumed. The extension then sets the phase to `active` and the strikes to `max − 1`, so the next violation locks again.
- **FR-22** Fullscreen required: if the student exits fullscreen, a blocking "Return to fullscreen" screen is shown.
- **FR-22a** The locked screen shows only status text. There is **no messaging UI** (D1).

### 6.5 Extension: session lifecycle

- **FR-23** A reload of the exam tab resumes the session without consent and logs `page_reload`.
- **FR-24** Closing the exam tab orphans the session. Re-opening the same form resumes it (strikes kept) and logs `tab_reopened`.
- **FR-25** Navigation to `/formResponse` ends the session with `submitted` (via the `finish_attempt` RPC), removes the DNR rules, and stops monitoring. If the teacher has ended the test (FR-30, D13), the session ends with `closed` instead, within about 5 seconds, when the heartbeat returns the `closed` flag. A submission after close is recorded and flagged `submitted_after_close`.
- **FR-26** Sessions survive a browser restart. `start_attempt` returns the existing **unfinished** attempt for (test, anonymous uid) instead of creating a new one. The extension restores the phase and strikes from the server's copy.

### 6.6 Record-only mode

- **FR-27** Everything is logged and strikes are counted, but nothing is blocked, closed, redirected or shown. There is no HUD and no overlays except consent.

### 6.7 Teacher dashboard

- **FR-28** **Auth:**
  - Supabase email and password: sign up with email confirmation, sign in, and "forgot password".
  - Only signed-in, **non-anonymous** users can create tests or read attempts.
- **FR-29** **Tests list:** title, status (`draft`, `live`, `ended`), number of students, flag count, created date.
- **FR-30** **Add/edit test:**
  - A form-link field, validated with the same parser as FR-2. Edit links (`/d/<id>/edit`) are rejected with "use the Send → link".
  - A title, and the settings in §7.
  - **Go live** requires two checkboxes: "Limit to 1 response is on" and "Collect email addresses (Verified) is on" (D7).
  - **End** follows D13. The dialog tells the teacher to stop accepting responses in Google Forms first, shows how many students are still working, and warns that unsubmitted answers will be lost.
- **FR-31** **Live monitor** (Supabase Realtime on `attempts`, filtered by `test_id`):
  - One row or card per attempt: name, email with ✓ or "unverified", status chip, strikes, current question, last seen.
  - "No heartbeat" when `now − last_heartbeat > 15s` (computed on the client every second).
  - An **Unlock** action, and an alert feed of strike and lock events.
- **FR-32** **Student timeline:** the chronological event list with icons, durations, domains and question numbers, plus the integrity score.
- **FR-33** **Post-test report:**
  - Integrity scores ranked.
  - A question heatmap: away-seconds and episode count per question.
  - Suspicious-return flags: the student returned and moved to the next question within 10 seconds.
  - CSV export of attempts and events.
- **FR-34** **Student onboarding page:** a public page with the install link, steps, and a self-check ("ExamGuard detected ✓").

### 6.8 Integrity score (v1 heuristic)

Start at 100 and subtract the following (the score can't go below 0):

| Signal                          | Penalty                             |
| ------------------------------- | ----------------------------------- |
| Each strike (leave episode)     | −10                                 |
| Each second away                | −0.5 (capped at −30 in total)       |
| Blocked-site attempt            | −15                                 |
| Suspicious return (FR-33)       | −5                                  |
| Copy, paste or devtools attempt | −2 (capped at −10 in total)         |
| Connection gap > 30s            | 0 (shown as "connection gap (unverified)", D12) |
| Unverified email                | 0 (shown as a badge, not a penalty) |

**Connection gaps (D12) are never subtracted.** An earlier draft of this table took −10 per heartbeat gap; D12 overrides it: offline time is shown, not penalized. A gap is recorded two ways, merged so it is never counted twice: the extension writes a `connection_gap` event (`seconds`, `from`) when its heartbeat is accepted again after more than 30 s of silence, and the dashboard also infers one from any event whose server arrival time (`received_at`) is more than 30 s after its own timestamp. A student is flagged when gaps add up to more than 2 minutes or there are more than 3. A suspicious return is a `returned` event followed by a `question_changed` to a different question within 10 s.

The score is computed in the dashboard from the events (a pure function in `extension/src/shared/` that is reused by the dashboard). It's a **signal for the teacher's judgement, not an automatic verdict**, and the UI must say so.

---

## 7. Test settings (`tests.settings` jsonb)

| Key                 | Type                    | Default             | Notes                                                                                                                                     |
| ------------------- | ----------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`              | `'enforce' \| 'record'` | `enforce`           |                                                                                                                                           |
| `maxStrikes`        | int 1–10                | 3                   |                                                                                                                                           |
| `snapBack`          | bool                    | true                | Also controls closing new tabs.                                                                                                           |
| `blockAiSites`      | bool                    | true                |                                                                                                                                           |
| `blocklist`         | string[]                | `DEFAULT_BLOCKLIST` | Domains; subdomains match.                                                                                                                |
| `allowlist`         | string[]                | `[]`                | Teacher-approved sites (for example, a calculator). Visiting them is not a strike and they are never closed (FR-16). Subdomains included. |
| `requireFullscreen` | bool                    | true                |                                                                                                                                           |
| `blockCopyPaste`    | bool                    | true                |                                                                                                                                           |
| `logTabTitles`      | bool                    | false               | Privacy: off by default.                                                                                                                  |

---

## 8. Data model (Supabase / Postgres)

The schema below is a **reference** for `supabase/migrations/0001_init.sql`. Claude Code should turn it into a real migration and test it locally with `supabase start`.

```sql
-- ============ tables ============
create table public.tests (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  form_id     text not null check (char_length(form_id) < 200),
  form_url    text not null,
  status      text not null default 'draft' check (status in ('draft','live','ended')),
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- a form can be live in only one test at a time
create unique index tests_one_live_per_form on public.tests (form_id) where status = 'live';

create table public.attempts (
  id               uuid primary key default gen_random_uuid(),
  test_id          uuid not null references public.tests on delete cascade,
  student_uid      uuid not null references auth.users on delete cascade,   -- anonymous user
  student_name     text not null check (char_length(student_name) between 1 and 100),
  student_email    text not null check (char_length(student_email) <= 200),
  chrome_email     text,
  verified         boolean not null default false,
  status           text not null default 'active'
                   check (status in ('active','away','warned','locked','submitted','abandoned','closed')),
  strikes          int  not null default 0 check (strikes between 0 and 100),
  current_q        jsonb,
  extension_version text,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  last_heartbeat   timestamptz not null default now()
);
create index on public.attempts (test_id);
create index on public.attempts (student_uid, test_id);

create table public.events (
  id          bigint generated always as identity primary key,
  attempt_id  uuid not null references public.attempts on delete cascade,
  t           timestamptz not null,
  type        text not null check (char_length(type) <= 40),
  q           jsonb,
  data        jsonb not null default '{}'::jsonb check (pg_column_size(data) < 2048)
);
create index on public.events (attempt_id, t);

create table public.commands (
  id          bigint generated always as identity primary key,
  attempt_id  uuid not null references public.attempts on delete cascade,
  type        text not null check (type in ('unlock')),
  created_by  uuid not null default auth.uid() references auth.users,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz
);
create index on public.commands (attempt_id) where consumed_at is null;
```

### Row Level Security (teacher side)

RLS is enabled on all four tables. Students get **no direct table policies**; they use only the RPCs below.

```sql
-- helper: true for real (non-anonymous) signed-in users
create function public.is_teacher() returns boolean language sql stable as $$
  select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

-- tests: owner-only, teachers only
create policy tests_owner_all on public.tests for all
  using (owner_id = auth.uid() and public.is_teacher())
  with check (owner_id = auth.uid() and public.is_teacher());

-- attempts / events / commands: readable by the owner of the parent test
create policy attempts_owner_read on public.attempts for select
  using (exists (select 1 from public.tests t where t.id = test_id and t.owner_id = auth.uid()));
create policy events_owner_read on public.events for select
  using (exists (select 1 from public.attempts a join public.tests t on t.id = a.test_id
                 where a.id = attempt_id and t.owner_id = auth.uid()));
create policy commands_owner_rw on public.commands for all
  using (exists (select 1 from public.attempts a join public.tests t on t.id = a.test_id
                 where a.id = attempt_id and t.owner_id = auth.uid()))
  with check (public.is_teacher());
```

### RPC functions (student side, `security definer`, `set search_path = public`)

Each one requires `auth.uid() is not null`, and checks that the attempt belongs to `auth.uid()`.

| Function                                                                                  | Purpose                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_live_test(p_form_id text) → (id, title, settings)`                                   | Look up a protected test by form ID (live tests only).                                                                                                                                                                                     |
| `start_attempt(p_form_id, p_name, p_email, p_chrome_email, p_ext_version) → attempts row` | Validate the test is live and the inputs are valid. **Return the existing unfinished attempt** for (test, uid) if there is one (FR-26), else insert a new one. `verified` is computed in SQL.                                              |
| `log_events(p_attempt_id uuid, p_events jsonb) → int`                                     | Bulk-insert up to 50 events from a JSON array. Rejected if the attempt is finished.                                                                                                                                                        |
| `heartbeat(p_attempt_id, p_status, p_strikes, p_q) → jsonb`                               | Update `last_heartbeat`, `status`, `strikes` and `current_q`. **Atomically claim and return unconsumed commands** (`update … set consumed_at = now() … returning`). The result includes `closed: true` when the test has been ended (D13). |
| `finish_attempt(p_attempt_id, p_status)`                                                  | Set `submitted`, `abandoned` or `closed`, and `ended_at`.                                                                                                                                                                                  |

Grant `execute` on these to `authenticated` (anonymous users have the `authenticated` role). Revoke it from `anon`.

### Realtime

Add `attempts` and `events` to the `supabase_realtime` publication. The dashboard subscribes with `postgres_changes`, filtered by `test_id=eq.<id>` (attempts) and by the attempt IDs (events). RLS applies to Realtime automatically.

### Event types

`session_start`, `consent_accepted`, `strike`, `returned`, `tab_switch`, `tab_opened`, `tab_navigated`, `other_window`, `left_browser`, `navigated_away`, `exam_tab_closed`, `tab_reopened`, `page_reload`, `visibility_hidden`, `visibility_visible`, `blocked_site_attempt`, `copy_attempt`, `cut_attempt`, `paste_attempt`, `contextmenu_attempt`, `shortcut_blocked`, `printscreen`, `fullscreen_exit`, `fullscreen_enter`, `idle_idle`, `idle_locked`, `idle_end`, `question_changed`, `ack`, `locked`, `unlocked`, `submitted`, `closed`, `submitted_after_close`, `connection_gap`, `allowed_tab_opened`, `allowed_site_viewed`, `input_while_blocked`, `submit_while_blocked`.

The client-side event `{attemptId, t, type, q, ...detail}` maps to the row `{attempt_id, t, type, q, data: detail}`.

---

## 9. Non-functional requirements

- **NFR-1 Privacy:**
  - Monitoring happens only during an active protected session.
  - The consent screen lists everything that is recorded.
  - Domains are logged, not full URLs. Titles are opt-in.
  - No keystroke content and no answer content is ever captured.
  - Students provide only a name and email.
- **NFR-2 Performance:** under 1% CPU on the Form page. Events are batched (flushed every 2 seconds or every 20 events, through `log_events`). The heartbeat is one RPC every 5 seconds.
- **NFR-3 Reliability:**
  - The extension works if the service worker is restarted (state lives in `chrome.storage.session` and Supabase).
  - Offline: events are queued in `chrome.storage.local` and flushed when the connection returns.
  - The unlock path doesn't depend on a WebSocket staying open in the service worker.
  - Connection gaps are shown as "connection gap (unverified)" and are not penalized (D12). Each event carries a sequence number and the server's arrival time, so gaps can be proven and a changed device clock can't hide events.
  - The lock is enforced by the extension's input guard (FR-20). The server records bypass attempts but can't block a Form submission itself.
- **NFR-4 Cost:**
  - Fits the Supabase free plan for a class of 40 (about 8 heartbeat requests per second at peak).
  - No Edge Functions in v1.
  - The dashboard is hosted on a free static host (Vercel or Netlify).
- **NFR-5 Compatibility:** Chrome 110+ on ChromeOS, Windows, macOS and Linux. Manifest V3.
- **NFR-6 Accessibility:** overlays are keyboard-operable, focus moves to the primary action, and contrast is AA.
- **NFR-7 Security:**
  - No remotely hosted code (an MV3 rule); `supabase-js` is bundled.
  - Only the Supabase **anon key** ships in the extension. The service-role key is never used client-side.
  - All student writes go through RPCs that validate ownership and sizes.
  - Enable rate limits and CAPTCHA (Turnstile) on anonymous sign-ins if abuse appears.

---

## 10. Milestones

| #   | Milestone          | Scope                                                                                                                                                                                                                                                                                                           | Status  |
| --- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| M1  | Extension skeleton | FR-1 to FR-25 and FR-27, against a mock backend, plus the dev popup and e2e test                                                                                                                                                                                                                                | ✅ Done |
| M2  | Supabase backend   | `supabase/` migration (§8), RLS and RPCs, database tests; esbuild bundling; `backend.supabase.js` with anonymous auth and a `chrome.storage` session adapter; event batching; heartbeat-delivered commands; FR-26 resume                                                                                        | ✅ Done |
| M3  | Dashboard: core    | Email/password auth, tests list, add/edit test, live monitor, unlock (FR-28 to FR-31), go-live checkboxes (D7), End flow (D13), data-retention setting (D14)                                                                                                                                                    | ✅ Done (retention setting: text only) |
| M4  | Dashboard: insight | Timeline, integrity score, report, heatmap, CSV (FR-32, FR-33, §6.8), responses reconciliation by CSV upload (D8), connection gap markers (D12)                                                                                                                                                                 | ✅ Done (CSV only; no PDF export) |
| M5  | Polish and ship    | Onboarding page (FR-34), the user's final designs, icons, Chrome Web Store listing, privacy policy, "Allow in incognito" install step (D9), alternate unprotected form guidance (D11), accessibility review of overlays (NFR-6), retention notice in consent and auto-deletion (D14), admin force-install guide |         |

---

## 11. Acceptance criteria (per milestone)

**M1 (passing in `tests/e2e`)**

- On a protected form, the consent screen appears. On an unprotected form, nothing appears. An invalid email is rejected.
- A new tab is closed and counts as one strike, and the warning is shown.
- A second leave shows the final warning (blur). A third locks the exam. Unlock restores the active state.
- DNR rules are present during the exam and removed after `/formResponse`.
- Switching to an allowlisted site is not a strike, and that tab is not closed. A non-allowlisted tab still is (FR-16).
- With the lock active, removing the overlay and clicking a control underneath does nothing, and the attempt is logged (FR-20).

**M2**

- Database tests (pgTAP via `supabase test db`, or a JS test against a local stack) prove:
  - An anonymous user can't read `tests`, `attempts` or `events` directly.
  - A student can't log events or heartbeat to another uid's attempt.
  - A teacher can't read another teacher's attempts.
  - `start_attempt` returns the same attempt on the second call.
- Two Chrome profiles taking the same test produce two attempts with different `student_uid`.
- After a teacher inserts `unlock`, the student unlocks within **6 seconds**, and the command is consumed exactly once.
- Killing the service worker mid-exam loses no strikes. Restarting Chrome and reopening the form resumes the same attempt.
- The e2e test still passes with the mock backend (build flag).

**M3**

- A teacher can go from pasting a link to having a live test in under 60 seconds.
- A live monitor status change appears within 2 seconds of the heartbeat that carries it.
- A "No heartbeat" badge appears within 20 seconds of disabling the extension.

**M4**

- A timeline renders 500 events smoothly.
- The CSV opens in Sheets and Excel.
- The heatmap matches the event data for a scripted test session.

---

## 12. Risks and mitigations

| Risk                                                                   | Impact                               | Mitigation                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A student doesn't install the extension, or disables it                | Unprotected attempt                  | No attempt row, or the heartbeat stops, so the dashboard shows "not detected" or "no heartbeat". Teacher policy: no attempt record means an invalid submission. |
| A student types someone else's name or email                           | Impersonation                        | The ✓ verified badge only appears when it matches the Chrome profile. The teacher compares the roster with the Form responses. Accepted for v1 (D3).            |
| Alt+Tab to another app or a phone                                      | Undetectable or unblockable cheating | Detect `left_browser` and log the duration. Be honest about the limit in the UI and docs.                                                                       |
| Google changes the Forms markup                                        | Question tracking breaks             | Isolate the selector in one function, fall back to null, and add an e2e test on a saved snapshot.                                                               |
| False positives with no grace period (OS notifications stealing focus) | Unfair strikes                       | The timeline shows durations, so the teacher judges. Revisit a grace period after classroom testing (D2).                                                       |
| A tampered client sends fake strike counts                             | Wrong numbers                        | Events are append-only. The dashboard can recompute strikes from events. The teacher sees the raw timeline.                                                     |
| A Supabase free project **pauses after 7 days of inactivity**          | Exam day outage                      | Open the dashboard before the exam (wakes the project), or upgrade to Pro for production. Show a clear "server unreachable" state in the extension.             |
| `<all_urls>` permission scares users or Web Store review               | Install friction                     | Justify it on the onboarding page and in the listing. Activate only during sessions.                                                                            |
| `supabase-js` in an MV3 service worker (no `localStorage`)             | Lost auth session                    | A custom `storage` adapter backed by `chrome.storage.local`, `persistSession: true`, and `detectSessionInUrl: false`.                                           |
| Two different form IDs (edit vs published)                             | Protection not applied               | The dashboard rejects edit links and explains how to copy the "Send" link.                                                                                      |
| Student skips the extension, or uses incognito                         | Unmonitored submission               | Reconcile responses against attempts (D8). Incognito is handled by the install guide (D9).                                                                      |
| Student removes the overlay or edits the DOM with DevTools             | Lock bypass                          | Window-level input guard, re-asserted every 250 ms, with blocked submits logged (FR-20).                                                                        |
| Student uses offline gaps to hide offline material                     | Missed cheating                      | Gaps are marked, and repeated or long gaps are flagged (D12). The web activity that matters needs the connection.                                               |
| Teacher ends the test while students are still working                 | Lost answers, confused students      | The End flow (D13): stop responses in Forms first, closed screen for students, and a warning about unsubmitted answers before End.                              |
| "Limit to 1 response" not enabled                                      | Duplicate submissions                | Go-live checkboxes (D7).                                                                                                                                        |

---

## 13. Decisions log

| #   | Question                                                             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Teacher ↔ student messaging?                                         | **No.** No messaging in either direction. The locked screen is status only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D2  | Grace period for very short focus losses?                            | **Off** in v1 (every loss counts). Revisit after classroom testing. If added, it becomes a `graceMs` setting, default 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D3  | Correlate with Form responses through the Google Forms API or OAuth? | **No.** No OAuth and no Forms API. Students enter name and email, and the teacher matches them manually if needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D4  | Exam time window enforced by the extension?                          | **No.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D5  | Backend?                                                             | **Supabase** (the team already knows it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D6  | Sign-in?                                                             | Teachers: **email and password** (Supabase Auth). Students: **no account**, just name and email, with anonymous Supabase auth behind the scenes. No Google sign-in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D7  | Should protected forms require "Limit to 1 response"?                | **Yes, required.** Every protected form needs "Limit to 1 response" on and "Collect email addresses" set to Verified. The dashboard requires the teacher to tick both before **Go live**. We can't verify this without the Forms API (D3), so it's a teacher attestation. Side effects: students sign in to Google inside the Form. That's a Form setting, not ExamGuard sign-in, so D3 and D6 still hold. The limit applies per Google account, so one student with two accounts could still submit twice.                                                                                                                                                                                                                                                                                                    |
| D8  | How do we find students who submitted without a monitored attempt?   | **Reconciliation.** After the test, the teacher uploads the Forms responses CSV. The dashboard matches emails in the browser and lists: submitted and monitored, submitted with no monitored attempt, and monitored but never submitted. Only the email column is read, and answers are never uploaded (NFR-1). No OAuth. Mismatches are flagged for review, not treated as cheating. This is the single mechanism for every "no attempt" case, including no extension, incognito and a disabled extension. Belongs in M4.                                                                                                                                                                                                                                                                                     |
| D9  | Incognito?                                                           | The install guide requires **"Allow in incognito"**. Without it Chrome won't run the extension in incognito, so nothing is monitored. With it on, the extension refuses to start in incognito (FR-4), and D8 flags the student.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D10 | What happens when a student refuses consent?                         | **Allowed, with no penalty.** Refusing is not a cheating signal. The consent screen gets an "I don't agree" button that tells the student to contact the teacher, and nothing is recorded on the server. The teacher handles the student through D11.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D11 | Accommodations and exemptions?                                       | **No per-student monitoring switch.** A typed email could be used to claim an exemption. Instead, the teacher creates a second, unprotected copy of the Form and sends it to students who need it. Those responses are reconciled separately and labelled "unmonitored by design". Overlays get an accessibility review (NFR-6) before M5, so screen reader users can read the warnings and understand the rules.                                                                                                                                                                                                                                                                                                                                                                                              |
| D12 | Should offline gaps be penalized?                                    | **No penalty, but visible.** Gaps appear as "connection gap (unverified)" in the timeline, separate from strikes. The teacher is flagged if the total gap exceeds 2 minutes or there are more than 3 gaps. Abuse is limited: the web activity that matters (AI sites, submitting) needs the connection, and events queue locally and arrive on reconnect. What a gap can hide is offline material such as notes or a downloaded PDF, which the repeat-gap flag addresses. Sequence numbers and server arrival times (NFR-3) stop clock changes from hiding events.                                                                                                                                                                                                                                             |
| D13 | What does "End test" do?                                             | **Two steps.** (1) Before ending, the teacher turns off "Accepting responses" in Google Forms. The dashboard links to that setting and asks the teacher to confirm. (2) In ExamGuard, End does the following. The test becomes ended, so new visitors aren't protected. In-progress attempts are marked `closed`. Within about 5 seconds, when the heartbeat returns the flag, the extension ends the session, removes the AI-site rules, stops blocking input, and shows "Your teacher has closed this exam." Students who already submitted are unaffected. Any later submission is flagged `submitted_after_close`. Google Forms doesn't save partial answers, so the End dialog warns that unsubmitted answers will be lost and shows how many students are still working. Immediate close is the default. |
| D14 | How long is student data kept?                                       | **180 days after the test ends, then deleted.** This is my proposed default, and you can change it. The teacher can shorten the period or delete a test's data at any time, which removes its attempts and events. The teacher can also delete one student's data on request. Automatic deletion runs as a scheduled job in M5; until then deletion is manual. The uploaded responses CSV is processed in the browser and never stored (D8). The consent screen must state the retention period (M5). Check this against your school's data protection rules. This isn't legal advice.                                                                                                                                                                                                                         |
