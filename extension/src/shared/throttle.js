// Caps on noisy events (load test finding, tests/load/README.md). A student holding Ctrl+C, a locked student clicking
// everywhere, or a tab that flickers can produce thousands of rows that tell the teacher nothing more than the first few.
// Per attempt and per event type, only the first N events of each minute are logged; the rest are counted and summarised
// as one `events_capped` event. Never capped: strikes, returns, locks, unlocks, blocked sites, submits, session events.
// Pure functions over a plain object, so the state lives in the session and survives a service worker restart.

export const CAP_WINDOW_MS = 60000;

const CLICK_SPAM = ['copy_attempt', 'cut_attempt', 'paste_attempt', 'contextmenu_attempt', 'shortcut_blocked', 'printscreen',
  'input_while_blocked', 'submit_while_blocked'];
const FLICKER = ['tab_switch', 'tab_opened', 'tab_navigated', 'other_window', 'left_browser', 'navigated_away',
  'exam_tab_closed', 'visibility_hidden', 'visibility_visible', 'allowed_tab_opened', 'allowed_site_viewed'];

export const CAPS = {
  ...Object.fromEntries(CLICK_SPAM.map((k) => [k, 10])), // the score's clipboard penalty stops at 5 events anyway
  ...Object.fromEntries(FLICKER.map((k) => [k, 30])), // a strike is logged separately and is never capped
  question_changed: 60,
};

const expired = (e, now) => now - e.t0 >= CAP_WINDOW_MS;

// Decide whether to log an event now. Also returns summaries of earlier windows that just ended: {kind, dropped}.
export function allowEvent(state, kind, now) {
  const cap = CAPS[kind];
  if (!cap) return { allow: true, summaries: [] };
  const summaries = [];
  let e = state[kind];
  if (e && expired(e, now)) {
    if (e.dropped) summaries.push({ kind, dropped: e.dropped });
    e = null;
  }
  if (!e) e = state[kind] = { t0: now, n: 0, dropped: 0 };
  if (e.n < cap) { e.n += 1; return { allow: true, summaries }; }
  e.dropped += 1;
  return { allow: false, summaries };
}

// Summaries for windows that ended without another event arriving (call this from the heartbeat), or all of them at the
// end of the session (force). Clears what it returns.
export function endedSummaries(state, now, force = false) {
  const out = [];
  for (const [kind, e] of Object.entries(state)) {
    if (!force && !expired(e, now)) continue;
    if (e.dropped) out.push({ kind, dropped: e.dropped });
    delete state[kind];
  }
  return out;
}
