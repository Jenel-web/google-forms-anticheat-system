// Turns raw events into what the teacher reads: timeline items (FR-32) and the CSV rows (FR-33). Pure, unit-tested.
import { analyzeAttempt, sortEvents } from '../../../extension/src/shared/integrity.js';

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function clockTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

const REASON_TEXT = {
  tab_opened: 'opened a new tab',
  tab_switch: 'switched tabs',
  other_window: 'switched windows',
  left_browser: 'left the browser',
  navigated_away: 'left the exam page',
  exam_tab_closed: 'closed the exam tab',
  visibility_hidden: 'hid the exam tab',
  idle_idle: 'went idle',
  idle_locked: 'locked the screen',
};
// These are logged when an episode starts; the timeline folds them into the episode instead of listing them twice.
const REASON_TYPES = new Set(Object.keys(REASON_TEXT));

const CLIPBOARD_TITLE = {
  copy_attempt: 'Tried to copy',
  cut_attempt: 'Tried to cut',
  paste_attempt: 'Tried to paste',
  contextmenu_attempt: 'Tried to right-click',
};

// minor = hidden until "Show every event" is switched on.
function describe(e, maxStrikes) {
  const d = e.data || {};
  switch (e.type) {
    case 'session_start': return { tone: 'ok', icon: 'check', title: 'Started exam', detail: d.mode === 'record' ? 'Consent accepted · record only' : 'Consent accepted' };
    case 'consent_accepted': return null;
    case 'tab_reopened': return { tone: 'info', icon: 'refresh', title: d.afterRestart ? 'Came back after closing the browser' : 'Reopened the exam tab' };
    case 'page_reload': return { tone: 'info', icon: 'refresh', title: 'Reloaded the exam page' };
    case 'blocked_site_attempt': return { tone: 'danger', icon: 'alert', title: 'Opened a blocked site', domain: d.domain };
    case 'allowed_tab_opened': return { tone: 'info', icon: 'tab', title: 'Opened an allowed site', domain: d.domain, minor: true };
    case 'allowed_site_viewed': return { tone: 'info', icon: 'eye', title: 'Viewed an allowed site', domain: d.domain, minor: true };
    case 'copy_attempt': case 'cut_attempt': case 'paste_attempt': case 'contextmenu_attempt':
      return { tone: 'info', icon: 'copy-block', title: CLIPBOARD_TITLE[e.type], detail: 'Blocked, no strike' };
    case 'shortcut_blocked': return { tone: 'info', icon: 'copy-block', title: 'Used a blocked shortcut', detail: d.combo ? String(d.combo) : 'Blocked, no strike' };
    case 'printscreen': return { tone: 'info', icon: 'eye', title: 'Pressed Print Screen' };
    case 'fullscreen_exit': return { tone: 'info', icon: 'expand', title: 'Left fullscreen', detail: 'Recorded, no strike' };
    case 'fullscreen_enter': return { tone: 'info', icon: 'expand', title: 'Entered fullscreen', minor: true };
    case 'question_changed': return { tone: 'info', icon: 'list', title: e.q ? `Moved to question ${e.q.i}` : 'Moved to another question', minor: true };
    case 'visibility_hidden': case 'visibility_visible':
      return { tone: 'info', icon: 'eye', title: e.type === 'visibility_hidden' ? 'Page hidden' : 'Page visible again', minor: true };
    case 'ack': return { tone: 'info', icon: 'check', title: 'Acknowledged the warning' };
    case 'locked': return { tone: 'danger', icon: 'lock', title: `Locked at ${d.strikes ?? maxStrikes} strikes` };
    case 'unlocked': return { tone: 'ok', icon: 'unlock', title: 'Unlocked by the teacher' };
    case 'input_while_blocked': return { tone: 'danger', icon: 'lock', title: 'Tried to use the page while locked' };
    case 'submit_while_blocked': return { tone: 'danger', icon: 'lock', title: 'Tried to submit while locked' };
    case 'submitted': return { tone: 'ok', icon: 'check', title: 'Submitted' };
    case 'submitted_after_close': return { tone: 'danger', icon: 'alert', title: 'Submitted after the test ended' };
    case 'closed': return { tone: 'info', icon: 'x-circle', title: 'Exam closed by the teacher' };
    case 'idle_idle': case 'idle_locked': case 'idle_end':
      return { tone: 'info', icon: 'clock', title: e.type === 'idle_end' ? 'Back from idle' : 'Went idle', minor: true };
    case 'tab_switch': case 'tab_opened': case 'tab_navigated': case 'other_window': case 'left_browser':
    case 'navigated_away': case 'exam_tab_closed':
      return { tone: 'warn', icon: 'leave', title: REASON_TEXT[e.type] ? `Student ${REASON_TEXT[e.type]}` : e.type.replace(/_/g, ' '), minor: true };
    case 'events_capped': return { tone: 'info', icon: 'copy-block', title: 'Repeated events summarized',
      detail: `${d.dropped ?? '?'} more ${String(d.kind || 'similar').replace(/_/g, ' ')} events in that minute were counted, not listed` };
    case 'strike': case 'returned': case 'connection_gap': return null; // built from episodes and gaps below
    default: return { tone: 'info', icon: 'help', title: String(e.type).replace(/_/g, ' '), minor: true };
  }
}

// One item per thing that happened: {key, t, tone, icon, title, detail?, q?, domain?, domains?, minor?}.
export function buildTimeline(events, maxStrikes = 3) {
  const sorted = sortEvents(events);
  const analysis = analyzeAttempt(events);
  const items = [];

  // an episode covers the time from just before its strike to its return
  const windows = analysis.episodes.map((ep) => ({
    from: Date.parse(ep.t) - 100,
    to: ep.durationMs === null ? Infinity : Date.parse(ep.t) + ep.durationMs + 1000,
  }));
  const inEpisode = (e) => REASON_TYPES.has(e.type) && windows.some((w) => Date.parse(e.t) >= w.from && Date.parse(e.t) <= w.to);

  for (const e of sorted) {
    if (e.type === 'strike' || inEpisode(e)) continue;
    const d = describe(e, maxStrikes);
    if (!d) continue;
    items.push({ key: `e${e.id ?? e.seq ?? e.t}${e.type}`, t: e.t, q: e.q || null, ...d });
  }

  for (const ep of analysis.episodes) {
    const reasonText = REASON_TEXT[ep.reason];
    const blocked = ep.domains.length > 0 && sorted.some((e) => e.type === 'blocked_site_attempt'
      && Math.abs(Date.parse(e.t) - Date.parse(ep.t)) < 5000);
    items.push({
      key: `ep${ep.t}${ep.n}`,
      t: ep.t,
      q: ep.q,
      tone: blocked ? 'danger' : 'warn',
      icon: 'leave',
      title: ep.durationMs === null ? 'Left the exam tab' : `Left the exam tab for ${formatDuration(ep.durationMs / 1000)}`,
      detail: `Strike ${ep.n ?? '?'} of ${maxStrikes}${reasonText ? ` · ${reasonText}` : ''}${ep.durationMs === null ? ' · no return recorded' : ''}`,
      domains: ep.domains,
    });
  }

  for (const g of analysis.gaps) {
    items.push({
      key: `gap${g.from}`,
      t: g.from,
      q: null,
      tone: 'info',
      icon: 'wifi-off',
      title: 'Connection gap (unverified)',
      detail: `No contact for ${formatDuration(g.seconds)} · not counted in the score`,
    });
  }

  items.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return { items, analysis };
}

export const ATTEMPT_COLUMNS = [
  { key: 'student_name', label: 'Name' },
  { key: 'student_email', label: 'Email' },
  { key: 'verified', label: 'Email verified' },
  { key: 'status', label: 'Status' },
  { key: 'strikes', label: 'Strikes' },
  { key: 'score', label: 'Integrity score' },
  { key: 'away_seconds', label: 'Seconds away' },
  { key: 'blocked_sites', label: 'Blocked-site attempts' },
  { key: 'clipboard', label: 'Copy/paste/devtools attempts' },
  { key: 'suspicious_returns', label: 'Suspicious returns' },
  { key: 'gaps', label: 'Connection gaps (unverified)' },
  { key: 'gap_seconds', label: 'Seconds in gaps (unverified)' },
  { key: 'started_at', label: 'Started' },
  { key: 'ended_at', label: 'Ended' },
];

export function attemptRows(attempts, analyses) {
  return attempts.map((a) => {
    const r = analyses.get(a.id);
    return {
      student_name: a.student_name,
      student_email: a.student_email,
      verified: a.verified ? 'yes' : 'no',
      status: a.status,
      strikes: r.strikes,
      score: r.score,
      away_seconds: r.awaySeconds,
      blocked_sites: r.penalties.blockedSite.count,
      clipboard: r.penalties.clipboard.count,
      suspicious_returns: r.suspiciousReturns.length,
      gaps: r.gaps.length,
      gap_seconds: r.gapSeconds,
      started_at: a.started_at,
      ended_at: a.ended_at || '',
    };
  });
}

export const EVENT_COLUMNS = [
  { key: 'student_name', label: 'Name' },
  { key: 'student_email', label: 'Email' },
  { key: 'attempt_id', label: 'Attempt' },
  { key: 'seq', label: 'Seq' },
  { key: 't', label: 'Time (student clock)' },
  { key: 'received_at', label: 'Received (server)' },
  { key: 'type', label: 'Event' },
  { key: 'question', label: 'Question' },
  { key: 'data', label: 'Details' },
];

// One row per stored event, so the row count matches the events table for the test.
export function eventRows(attempts, eventsByAttempt) {
  const rows = [];
  for (const a of attempts) {
    for (const e of sortEvents(eventsByAttempt.get(a.id) || [])) {
      rows.push({
        student_name: a.student_name,
        student_email: a.student_email,
        attempt_id: a.id,
        seq: e.seq ?? '',
        t: e.t,
        received_at: e.received_at || '',
        type: e.type,
        question: e.q ? e.q.i : '',
        data: e.data && Object.keys(e.data).length ? JSON.stringify(e.data) : '',
      });
    }
  }
  return rows;
}

// The class summary shown above the ranked list.
export function classSummary(attempts, analyses, eventsByAttempt) {
  const scores = attempts.map((a) => analyses.get(a.id).score);
  const lockedThenUnlocked = attempts.filter((a) => {
    const types = new Set((eventsByAttempt.get(a.id) || []).map((e) => e.type));
    return types.has('locked') && types.has('unlocked');
  }).length;
  return {
    students: attempts.length,
    average: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
    flagged: scores.filter((s) => s < 85).length,
    lockedThenUnlocked,
  };
}

export function safeFilename(title) {
  return String(title || 'test').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'test';
}
