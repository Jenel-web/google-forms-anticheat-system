// Integrity score and per-attempt analysis (PRD §6.8, FR-32, FR-33, D12). Pure functions: the dashboard imports
// this file, and it never touches the network, so it is unit-tested in test/integrity.test.mjs.
//
// The score is a signal for the teacher's judgement, not a verdict. Connection gaps are shown but never scored (D12).

export const SCORE = {
  start: 100,
  strike: 10,
  awayPerSecond: 0.5,
  awayCap: 30,
  blockedSite: 15,
  suspiciousReturn: 5,
  clipboard: 2,
  clipboardCap: 10,
};

export const SUSPICIOUS_RETURN_MS = 10000; // FR-33: returned, then moved to another question within 10 s
export const GAP_MIN_MS = 30000; // a connection gap is a silence (or late delivery) of more than 30 s
export const GAP_FLAG_TOTAL_MS = 120000; // D12: flag when the gaps add up to more than 2 minutes...
export const GAP_FLAG_COUNT = 3; // ...or there are more than 3 of them

// Events that count as a copy, paste or devtools attempt. Blocked shortcuts include F12 and the devtools combos.
export const CLIPBOARD_TYPES = ['copy_attempt', 'cut_attempt', 'paste_attempt', 'contextmenu_attempt', 'shortcut_blocked'];

const ms = (iso) => Date.parse(iso);

// Chronological order by the student's clock, then by sequence number, then by insertion order.
export function sortEvents(events) {
  return [...events].sort((a, b) =>
    ms(a.t) - ms(b.t) || (a.seq ?? 0) - (b.seq ?? 0) || (a.id ?? 0) - (b.id ?? 0));
}

// Connection gaps (D12). Two sources, merged so a gap is never counted twice:
//   - 'connection_gap' events, which the extension writes when its heartbeat comes back after a silence;
//   - late delivery: events whose server arrival time (received_at, which a changed device clock cannot fake)
//     is more than GAP_MIN_MS after their own timestamp were queued while the student was offline.
export function findGaps(events) {
  const spans = [];
  for (const e of events) {
    if (e.type === 'connection_gap') {
      const seconds = Number(e.data?.seconds) || 0;
      const to = ms(e.t);
      if (seconds * 1000 > GAP_MIN_MS) spans.push({ from: to - seconds * 1000, to, source: 'reported' });
    } else if (e.received_at && ms(e.received_at) - ms(e.t) > GAP_MIN_MS) {
      spans.push({ from: ms(e.t), to: ms(e.received_at), source: 'late' });
    }
  }
  spans.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.from <= last.to) {
      last.to = Math.max(last.to, s.to);
      if (s.source === 'reported') last.source = 'reported';
    } else {
      merged.push({ ...s });
    }
  }
  return merged.map((g) => ({
    from: new Date(g.from).toISOString(),
    to: new Date(g.to).toISOString(),
    seconds: Math.round((g.to - g.from) / 1000),
    source: g.source,
  }));
}

// Leave episodes in order: each `strike` event opens one, the next `returned` closes it. The question is the one
// the student was on when they left. durationMs is null while the student never came back.
export function findEpisodes(sorted) {
  const out = [];
  let open = null;
  for (const e of sorted) {
    if (e.type === 'strike') {
      if (open) out.push(open); // a strike with no return (lock, close, restart)
      open = { t: e.t, q: e.q || null, reason: e.data?.reason || null, n: e.data?.n ?? null, durationMs: null, domains: [] };
    } else if (e.type === 'returned' && open) {
      open.durationMs = Number(e.data?.durationMs) || 0;
      open.domains = Array.isArray(e.data?.domains) ? e.data.domains : [];
      out.push(open);
      open = null;
    }
  }
  if (open) out.push(open);
  return out;
}

// FR-33: the student came back and moved to a different question within 10 seconds.
export function findSuspiciousReturns(sorted) {
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.type !== 'returned') continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const n = sorted[j];
      if (ms(n.t) - ms(r.t) > SUSPICIOUS_RETURN_MS) break;
      if (n.type !== 'question_changed') continue;
      if (!r.q || !n.q || r.q.i !== n.q.i) out.push({ t: n.t, fromQ: r.q?.i ?? null, toQ: n.q?.i ?? null });
      break;
    }
  }
  return out;
}

export function analyzeAttempt(events) {
  const sorted = sortEvents(events);
  const strikes = sorted.filter((e) => e.type === 'strike').length;
  const awayMs = sorted.filter((e) => e.type === 'returned').reduce((sum, e) => sum + (Number(e.data?.durationMs) || 0), 0);
  const awaySeconds = Math.round(awayMs / 1000);
  const blocked = sorted.filter((e) => e.type === 'blocked_site_attempt').length;
  const clipboard = sorted.filter((e) => CLIPBOARD_TYPES.includes(e.type)).length;
  const suspicious = findSuspiciousReturns(sorted);
  const gaps = findGaps(sorted);
  const gapSeconds = gaps.reduce((sum, g) => sum + g.seconds, 0);

  const penalties = {
    strikes: { count: strikes, points: strikes * SCORE.strike },
    away: { seconds: awaySeconds, points: Math.min(SCORE.awayCap, (awayMs / 1000) * SCORE.awayPerSecond) },
    blockedSite: { count: blocked, points: blocked * SCORE.blockedSite },
    suspiciousReturn: { count: suspicious.length, points: suspicious.length * SCORE.suspiciousReturn },
    clipboard: { count: clipboard, points: Math.min(SCORE.clipboardCap, clipboard * SCORE.clipboard) },
  };
  const total = Object.values(penalties).reduce((sum, p) => sum + p.points, 0);
  const raw = Math.max(0, SCORE.start - total);

  return {
    score: Math.round(raw),
    rawScore: raw,
    penalties,
    strikes,
    awaySeconds,
    suspiciousReturns: suspicious,
    gaps,
    gapSeconds,
    gapFlag: gapSeconds * 1000 > GAP_FLAG_TOTAL_MS || gaps.length > GAP_FLAG_COUNT,
    episodes: findEpisodes(sorted),
  };
}

// 85 and above is fine, 60 to 84 is worth a look, below 60 needs review (CheatNoNo/screens.md).
export function scoreBand(score) {
  if (score >= 85) return 'ok';
  if (score >= 60) return 'mid';
  return 'low';
}

// Question heatmap (FR-33): per question, how many leave episodes started there, how many seconds they added up to,
// and how many different students left on it. attempts = [{id, events}].
export function questionHeat(attempts) {
  const byQ = new Map();
  let total = 0;
  let unknown = 0;
  for (const a of attempts) {
    for (const q of a.events) if (q.q && Number.isInteger(q.q.n)) total = Math.max(total, q.q.n);
    for (const ep of findEpisodes(sortEvents(a.events))) {
      if (!ep.q || !Number.isInteger(ep.q.i)) { unknown += 1; continue; }
      const cell = byQ.get(ep.q.i) || { q: ep.q.i, episodes: 0, awaySeconds: 0, students: new Set() };
      cell.episodes += 1;
      cell.awaySeconds += (ep.durationMs || 0) / 1000;
      cell.students.add(a.id);
      byQ.set(ep.q.i, cell);
      total = Math.max(total, ep.q.i);
    }
  }
  const cells = [];
  for (let i = 1; i <= total; i++) {
    const c = byQ.get(i);
    cells.push({ q: i, episodes: c ? c.episodes : 0, awaySeconds: c ? Math.round(c.awaySeconds) : 0, students: c ? c.students.size : 0 });
  }
  return { cells, unknown };
}

// Colour level 0-4 for a cell, scaled to the busiest question.
export function heatLevel(episodes, max) {
  if (!episodes || !max) return 0;
  return Math.max(1, Math.min(4, Math.ceil((4 * episodes) / max)));
}
