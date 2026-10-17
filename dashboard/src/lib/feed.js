// The live monitor's alert feed. Alert events are fetched from the database every few seconds (and right after a status
// change arrives over Realtime) instead of being streamed row by row: see supabase/migrations/*_events_feed_polling.sql.
// Pure logic, unit-tested in test/report.test.mjs.
import { describeEvent } from './format.js';

export const FEED_INITIAL = 40; // how many recent alerts the first load shows
export const FEED_OVERLAP_MS = 30000; // each poll re-reads this much history, so a late-committing row is never missed

export function newFeedState() {
  return { ids: new Set(), since: null };
}

// Where the next poll starts: null means "load the most recent alerts", otherwise an ISO time to read from.
export function feedSince(state) {
  return state.since ? new Date(Date.parse(state.since) - FEED_OVERLAP_MS).toISOString() : null;
}

// rows = alert events from the database. Returns the new feed entries, newest first, and remembers what it has shown.
export function mergeAlerts(rows, state, nameOf) {
  const entries = [];
  for (const ev of rows) {
    if (state.ids.has(ev.id)) continue;
    state.ids.add(ev.id);
    if (ev.received_at && (!state.since || Date.parse(ev.received_at) > Date.parse(state.since))) state.since = ev.received_at;
    const d = describeEvent(ev, nameOf(ev.attempt_id));
    if (d) entries.push({ id: ev.id, t: ev.t, ...d });
  }
  return entries.sort((a, b) => b.id - a.id);
}
