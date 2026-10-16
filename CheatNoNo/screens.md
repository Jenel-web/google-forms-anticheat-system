# Screens

Each screen is a component card with a desktop (or desktop browser) version and a mobile or narrow-window version, built from the same markup. Numbers match the original brief.

## A. Student side: overlays on the Google Form

| # | Screen | Card | Key states shown | Built from |
| --- | --- | --- | --- | --- |
| 1 | Consent and start | `ConsentStart` | Signed in with detected email; not signed in (banner, Start disabled) | `cn-modal--wide`, `cn-detect`, `cn-list`, `cn-checkbox`, `cn-btn--lg` |
| 2 | Unsupported browser or incognito | `UnsupportedMode` | Incognito with two fixes; unsupported browser | `cn-modal__icon--warn`, `cn-steps` |
| 3 | Exam HUD | `ExamHud` | 0, 1, 2 strikes; record-only; collapsed icon | `cn-hud`, `cn-hud--warn`, `cn-hud--danger`, `cn-hud--mini` |
| 4 | Strike 1 warning | `StrikeWarning` | What was detected, 2 strikes remaining, Continue | `cn-modal`, `cn-detect`, `cn-pips` |
| 5 | Strike 2 blur screen | `StrikeBlur` | Questions blurred, firmer message, Return to exam | `cn-blur`, `cn-pips--danger` |
| 6 | Locked screen | `LockedScreen` | Waiting status, strike summary, message to teacher | `cn-fullscreen`, `cn-status`, textarea |
| 7 | Fullscreen required | `FullscreenRequired` | Return to fullscreen, Esc note | `cn-modal--center`, `cn-kbd` |
| 8 | Blocked site page | `BlockedSite` | Enforce (strike added); record-only (no strike) | `cn-fullscreen`, `cn-chip--missing` |
| 9 | Extension popup | `ExtensionPopup` | Not on an exam; exam active; locked | `cn-popup` |

## B. Teacher dashboard: web app

| # | Screen | Card | Key states shown | Built from |
| --- | --- | --- | --- | --- |
| 10 | Sign in with Google | `SignIn` | Split brand panel on desktop, stacked on mobile | `cn-auth`, `cn-auth__deco` |
| 11 | Tests list (home) | `TestsList` | Name, status chip, students, flag count; draft, live, ended | `cn-app`, `cn-grow`, `cn-stats` |
| 12 | Add / edit test | `TestEditor` | Form link found; strikes, mode, snap-back, categories, sites, allow-list, fullscreen, copy/paste, page titles | `cn-card`, `cn-setting`, `cn-switch`, `cn-seg`, `cn-stepper`, `cn-tag` |
| 13 | Live monitor | `LiveMonitor` | Status filter chips, student table or cards, Unlock, live alert feed | `cn-grow`, `cn-chip--*`, `cn-feed`, `cn-split--lg` |
| 14 | Student timeline | `StudentTimeline` | Integrity ring, answer-correlation flag, vertical event timeline | `cn-tl`, `cn-ring`, `cn-domain`, `cn-q` |
| 15 | Post-test report | `PostTestReport` | Class summary, ranked integrity list, question heatmap, CSV and PDF export | `cn-stats`, `cn-bar`, `cn-heat` |
| 16 | Student onboarding page | `StudentOnboarding` | Three steps, self-check (pass), share link | `cn-pagewrap`, `cn-steps`, `cn-check-item` |

## C. Empty and error states

`EmptyStates` shows no tests yet, no students joined, extension not detected (with the failing self-check row on the onboarding page copy) and offline.

## Behavior notes for builders

- Strike 1 uses `amber` and `warning-*`; strike 2 and locked use `danger`. Record-only mode shows the same events but never adds strikes, and the HUD reads "Recording".
- The HUD and all overlays render in a shadow root with the highest z-index and `cn-root` as container.
- Table rows (`cn-grow`) need a `--cols` custom property for desktop columns and `data-label` on each cell for the mobile card layout.
- A locked row in the live monitor uses `is-attn` and shows the Unlock button; the alert feed lists the newest first.
- Integrity score bands in the report: 85 and above uses `success`, 60 to 84 amber with a dark outline, below 60 `danger`.
