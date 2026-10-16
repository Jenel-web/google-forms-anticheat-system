# CheatNoNo (ExamGuard)

Anti-cheat companion for Google Forms exams: a Chrome extension (MV3), a Supabase backend (M2) and a teacher dashboard (M3).
Scope and decisions: `PRD.MD`. Working rules for contributors: `CLAUDE.md`.

**Status: Phase 1.** The extension works on its own against a mock backend (`chrome.storage.local`). There is no server yet,
so a teacher "protects" a form from the dev popup and "unlocks" students from the same popup.

## Install the extension (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and pick the `extension/` folder.
3. After editing code, click reload on the extension card, then reload the Form tab.

## Automated check

```bash
pip install playwright
python -m playwright install chromium
python tests/e2e/run_e2e.py
```

It opens a real Chromium window for about two minutes. Don't click or switch windows while it runs: the extension counts
focus changes as leaving the exam. Google Forms is faked locally, so no network or real form is needed. Branded Chrome 137+
ignores `--load-extension`, which is why the test uses Playwright's Chromium (override with `CHROME_PATH`).

## Manual test on a real form (Phase 1 gate)

Use a Form you own. Get its **published link** (Form → **Send** → link icon). It looks like
`https://docs.google.com/forms/d/e/…/viewform`. The edit link has a different ID and won't match.

**Set up**

1. Click the CheatNoNo icon. The dev panel opens. If the Form is your active tab, its link is filled in.
2. Set a title, leave **Mode = Enforce**, set **Max strikes = 10** for part A, and put a domain you will use in
   **Allowlist** (for example `example.com`). Click **Protect this form**.
3. Open the Form link in a normal window. You should see **Before you begin**.
4. Type a name and email, tick the checkbox, click **Start exam**. The page goes fullscreen and a "Protected, Strikes 0/10"
   badge appears top right.

**Part A: one behaviour at a time** (the dev panel's *Event log* shows each result; opening the panel while the exam
runs can count as a window switch, which is expected)

| # | Do this | Expect |
|---|---|---|
| 1 | Press `Ctrl+T` | The new tab closes at once. A warning appears: "You left the exam tab". Click **Continue exam**. |
| 2 | `Alt+Tab` to another app and back | A warning appears when you return. The log shows `left_browser`. The extension can only log this, not block it. |
| 3 | Press `Esc` to leave fullscreen | A "Return to fullscreen to continue" screen hides the exam. No strike. Click **Return to fullscreen**. |
| 4 | Click the address bar (`Ctrl+L`), type `chatgpt.com`, Enter | The blocked page appears, saying a strike was added. Click **Back to exam**. |
| 5 | Add a link to an allowlisted site in a Form question description (for example `https://example.com`), then click it | It opens in a new tab and stays open. No strike. The log shows `allowed_tab_opened`. |
| 6 | Click the dev panel's **Reset all data** and re-protect the Form with **Max strikes = 3** | Starts a clean run for part B. Reopen the Form and start the exam again. |

**Part B: lock, tamper, reload, unlock**

1. Press `Ctrl+T` three times (acknowledge the first two warnings). The third strike shows **Your exam is paused**.
2. Open DevTools from the menu (⋮ → More tools → Developer tools). In **Elements**, delete `<div id="eg-host">`, and
   remove the `inert` attribute from `<body>`. Then click **Submit** on the Form. **Nothing should happen**, and the
   overlay should reappear. The dev panel log shows `input_while_blocked`.
3. Press `F5`. There is **no second consent screen**, the locked screen returns and the strikes stay at 3.
4. In the dev panel, click **Unlock** next to the attempt. Within about 5 seconds the exam opens again with strikes at 2.

**Part C: consent and incognito**

- On a fresh load of the Form, click **I don't agree**. You see "You chose not to agree… contact your teacher". In the dev
  panel, **Attempts** shows "No attempts" and the log is empty. Nothing is recorded.
- Go to `chrome://extensions` → CheatNoNo → **Details**. With **Allow in Incognito** off, open the Form in an incognito
  window: **no consent screen appears** (expected, D9). Turn it on and reload: you get "Exam can't start in this mode".

## Known limits

- **Other apps and devices.** A browser extension can't stop `Alt+Tab` to another app, a second monitor or a phone. It
  logs `left_browser` with the duration and counts one strike.
- **Incognito.** Chrome runs extensions in incognito only if **Allow in Incognito** is on. If it's off, nothing is
  monitored; the plan is to catch these students by reconciling Form responses against attempts (D8, M4). If it's on,
  the exam refuses to start (FR-4).
- **The lock is enforced by the extension, not the server.** The input guard blocks clicks, keys and submits on the page,
  and rebuilds the overlay if it is deleted. It can't stop someone who disables or removes the extension. A blocked submit
  attempt is logged as evidence (FR-20).
- **DevTools can still be opened** from the browser menu. `F12` and `Ctrl+Shift+I/J/C` are blocked and logged in enforce
  mode, but the browser decides whether to honour the block.
- **Focus changes count, however short.** There is no grace period (D2). OS notifications that steal focus can cost a
  strike. Chrome also reports a brief "no window focused" between its own windows, which counts as a leave.
- **Reloading drops fullscreen.** After a reload the student must click **Return to fullscreen** (a browser rule needs a
  click to enter fullscreen).
- **Mock backend only (this unpacked `extension/` folder).** Data lives in this Chrome profile's extension storage, with no
  teacher dashboard and no sync. Unlock goes through the dev panel. The real backend is the `extension/dist` build plus
  the `dashboard/` app; see CLAUDE.md for the commands.
- **Allowlist.** An allowlisted domain can't carve a subdomain out of a blocked parent domain (FR-16).
- **Google Forms markup is unofficial.** The current-question number uses `div[role="listitem"]` and is best effort.
- **Page titles** of other tabs are not logged unless `logTabTitles` is on (off by default, NFR-1).
