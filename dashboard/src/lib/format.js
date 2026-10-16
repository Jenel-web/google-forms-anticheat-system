// Pure helpers (unit-tested in test/lib.test.mjs).

export const FINAL_STATUSES = ['submitted', 'abandoned', 'closed'];
export const NO_HEARTBEAT_MS = 15000; // FR-31

export function isFinal(status) {
  return FINAL_STATUSES.includes(status);
}

// FR-31: "No heartbeat" when now - last_heartbeat > 15 s, for attempts that are still supposed to be running.
export function noHeartbeat(attempt, now) {
  return !isFinal(attempt.status) && now - Date.parse(attempt.last_heartbeat) > NO_HEARTBEAT_MS;
}

export function timeAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// The chip a monitor row shows: the stored status, or "No heartbeat" overriding it.
export function rowStatus(attempt, now) {
  if (noHeartbeat(attempt, now)) return 'noheartbeat';
  return attempt.status;
}

export function countByFilter(attempts, now) {
  const c = { all: attempts.length, active: 0, away: 0, warned: 0, locked: 0, submitted: 0, closed: 0, noheartbeat: 0 };
  for (const a of attempts) {
    const k = rowStatus(a, now);
    if (k === 'abandoned') c.closed += 1;
    else if (k in c) c[k] += 1;
  }
  return c;
}

export function stillWorking(attempts) {
  return attempts.filter((a) => !isFinal(a.status)).length;
}

// "Flagged" attempts: at least one strike, or locked.
export function isFlagged(attempt) {
  return attempt.strikes > 0 || attempt.status === 'locked';
}

const REASON_TEXT = {
  tab_opened: 'opened a new tab',
  tab_switch: 'switched tabs',
  other_window: 'switched windows',
  left_browser: 'left the browser',
  navigated_away: 'left the exam page',
  exam_tab_closed: 'closed the exam tab',
  visibility_hidden: 'hid the exam tab',
  blocked_site_attempt: 'opened a blocked site',
  idle_idle: 'went idle',
  idle_locked: 'locked the screen',
};

// One alert-feed sentence per interesting event. Returns null for events the feed does not show.
export function describeEvent(ev, name) {
  const d = ev.data || {};
  switch (ev.type) {
    case 'strike': return { tone: 'warn', text: `${name} left the exam (${REASON_TEXT[d.reason] || 'left the exam tab'})` };
    case 'locked': return { tone: 'danger', text: `${name} reached ${d.strikes ?? 'the maximum'} strikes and is locked` };
    case 'unlocked': return { tone: 'ok', text: `${name} was unlocked` };
    case 'blocked_site_attempt': return { tone: 'warn', text: `${name} opened ${d.domain || 'a blocked site'}` };
    case 'left_browser': return { tone: 'warn', text: `${name} left the browser${d.seconds ? ` for ${d.seconds}s` : ''}` };
    case 'input_while_blocked': return { tone: 'danger', text: `${name} tried to use the page while it was locked` };
    case 'submit_while_blocked': return { tone: 'danger', text: `${name} tried to submit while locked` };
    case 'submitted': return { tone: 'ok', text: `${name} submitted` };
    case 'submitted_after_close': return { tone: 'danger', text: `${name} submitted after the test ended` };
    case 'closed': return { tone: 'info', text: `${name}'s exam was closed` };
    default: return null;
  }
}

export const ALERT_TYPES = ['strike', 'locked', 'unlocked', 'blocked_site_attempt', 'left_browser', 'input_while_blocked',
  'submit_while_blocked', 'submitted', 'submitted_after_close', 'closed'];

// Allow-list / block-list entries: "host" or "host/path". Returns the cleaned entry or null.
export function cleanSiteEntry(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  if (!v || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(\/[^\s]*)?$/.test(v) || !v.split('/')[0].includes('.')) return null;
  return v;
}
