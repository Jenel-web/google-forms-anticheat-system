CheatNoNo keeps Google Form exams fair without making students feel watched. It is a Chrome extension (student overlays) plus a web app (teacher dashboard) that works on laptops and phones. The look is light blue and white, calm and clear: the product should feel like a steady hand, never an alarm.

Load `tokens.css`, `components/bundle.css` and this font link, and set `class="cn"` on the page root. Wrap each app root in `class="cn-root"` so the container-query layouts work.

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Sora:wght@600;700&display=swap">
```

## Content fundamentals

Write like a fair teacher: plain, short, kind, and specific. Say what happened and what happens next, never who is guilty.

- Address the student as "you" and the teacher as "you" too. Refer to the exam owner by name when known ("Waiting for Mr. Reyes").
- State the event, then the consequence. "You left the exam tab for 8s" then "2 strikes remaining". Never "cheating", "violation" or "suspicious" in student copy.
- Strikes are "strikes", the third one "locks" (teacher view) or "pauses" (student view). Use those words every time.
- Teacher-facing flags are prompts to review, not verdicts: "A prompt to review, not proof of anything."
- Sentence case everywhere. Buttons are verbs: "Start exam", "Return to exam", "Unlock". No exclamation marks, no emoji.
- Show domains only, in `data` style, never page content: `chatgpt.com`.
- The product name is one word, CheatNoNo, capital C, N, N. The tagline is "Fair exams, calmly kept."

Real examples live in `copy.md`.

## Visual foundations

**Color.** White `surface` is the default ground. `surface-tint` sits behind cards, `surface-sky` marks panels, the sidebar and the locked screen. `brand` (light blue) is for the logo, large display accents, icons and charts; `brand-strong` fills primary buttons and link text because white on it reaches 6.1:1. `ink` (navy) carries all text; `ink-muted` is secondary text. `amber` means "a strike was added", `danger` means locked or blocked, `success` (a teal, off the red-green axis) means active or detected. `aqua` is decoration only. Never use `brand` as a fill for small white text, and never use `amber` as text.

**Status is never color alone.** Every state pairs a word and an icon: Active (dot), Away (clock), Warned (triangle), Locked (lock), Submitted (check), Extension missing (puzzle, dashed outline). Strike pips always sit beside a printed count like `1/3`.

**Type.** Sora (`display-*`, `heading-*`) for headlines and numbers, DM Sans (`body*`, `label`, `caption`) for everything you read, DM Mono (`data`) for domains, times, question numbers and the exam timer. Inputs are always 16px so phones do not zoom. Headlines drop one step on phones (`display-xl` 56px to 36px, `heading-1` 28px to 24px).

**Shape.** Soft and rounded, echoing the shield: `radius-md` buttons and inputs, `radius-lg` cards and overlays, `radius-xl` hero panels, `radius-pill` chips, the HUD and pips. Decorative blocks are arches, pills, discs and half-rounds cut from these radii; no sharp corners, no left-border accent cards.

**Elevation.** `shadow-sm` for resting cards, `shadow-md` for the HUD and sticky bars, `shadow-lg` for student overlay cards and the extension popup. Overlays sit on `scrim` (78% navy) and the exam page behind a warning is blurred 7px (`cn-blur`).

**Focus.** A solid 3px `focus` ring with 2px offset on every interactive element, 6.1:1 on white and 5.3:1 on `surface-sky`.

**Spacing.** 4px steps (`space-1` to `space-8`). Cards pad `space-5` on desktop and `space-4` on phones; page gutters `space-6` and `space-4`. Touch targets are at least 44px tall (buttons, tab bar items, pills 40px).

**Motion.** None required. Do not animate warnings or the lock status; calm beats attention-grabbing.

## Iconography

One in-house line set: 24px grid, 1.75px stroke, round caps and joins, `currentColor` (see the Icons card for every glyph). Use an icon with every status chip, detection row and list item that names an event. Do not use emoji or filled glyphs, except the small filled dot in the Active and Live chips. The sign-in button uses a plain letter "G" as a placeholder: replace it with Google's official sign-in button asset before shipping.

## Logo

The mark is a shield with a check and one amber dot (the strike signal). Assets: `assets/Logos/cheatnono-mark.svg` (the mark) and `assets/Logos/cheatnono-app-icon.svg` (the mark on a light-blue rounded square, for the Chrome extension and web app icons). The wordmark is live type, not an image: Sora Bold with "Cheat" in `ink` and "NoNo" in `brand`, or all white on navy (`cn-logo` and `cn-logo--on-ink` in the Logo card). Keep clear space equal to the check's height; minimum 96px wide for the full logo, 16px for the mark. Do not recolor the amber dot, stretch the mark or add effects.

## Layout and responsive behavior

Everything is designed phone first and scales up. Layouts respond to the width of the app container (`cn-root`), with breakpoints at 760px, 1180px and 1360px; production code can mirror them with media queries.

- Under 760px the sidebar becomes a top bar plus a four-item bottom tab bar (Tests, Live, Reports, Student), tables become labelled cards (`data-label` on each cell), forms get a sticky action bar, and filter chips scroll sideways.
- From 760px the sidebar (248px) returns and tables show real columns.
- The two-column layouts (editor with checklist, live monitor with alerts) split only from 1180px and 1360px; below that the side panel stacks under the main content.
- Student overlays are fluid cards, max 560px (780px for consent), centered on `scrim`, and keep working in a half-width browser window. The extension itself runs on desktop Chrome or Edge only; the student onboarding page is the one student screen that must work on a phone, so a student can read the steps there.

## Screens

All 16 requested screens and the empty and error states are components in this system, with the exact states and copy listed in `screens.md`. Student screens 1 to 9 are overlays on top of the Google Form (the form itself is shown only as grey placeholder bars). Teacher screens 10 to 16 are the web app on Firebase Hosting.

## Do and don't

- Do put the count next to every pip row, and the word next to every status color.
- Do keep student overlays to one message, one detail row and one action.
- Don't show a student's score, flags or other students anywhere in student overlays.
- Don't use red for a first warning: strike 1 is `amber`, strike 2 and locked are `danger`.
