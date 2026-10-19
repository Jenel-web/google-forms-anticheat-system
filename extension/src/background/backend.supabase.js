// Supabase backend. Same interface as backend.mock.js (see CLAUDE.md). Bundled by esbuild into dist/.
// The MV3 worker can die at any time, so everything that must not be lost (the auth session, the event queue,
// per-attempt sequence numbers, a pending finish) lives in chrome.storage.local, never only in module variables.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../shared/supabaseConfig.js';
import { GAP_MIN_MS } from '../shared/integrity.js';

const STATE_KEY = 'eg_sb_state';
const FLUSH_MS = 2000;
const FLUSH_AT = 20;
const BATCH_MAX = 50;
const BATCH_PAUSE_MS = 150; // pause between consecutive batches (plus up to the same again, random)
const BACKOFF_MAX_MS = 30000;
const HEARTBEAT_DEBOUNCE_MS = 300;
const REQUEST_TIMEOUT_MS = 10000;

const chromeStorageAdapter = {
  getItem: async (key) => (await chrome.storage.local.get(key))[key] ?? null,
  setItem: (key, value) => chrome.storage.local.set({ [key]: value }),
  removeItem: (key) => chrome.storage.local.remove(key),
};

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: chromeStorageAdapter, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  // A paused or unreachable project must fail fast instead of hanging the consent screen.
  global: { fetch: (url, opts = {}) => fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS) }) },
});

// ------------------------------------------------------------------ auth + rpc

let sessionPromise = null;

function ensureSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) return data.session;
      const res = await supabase.auth.signInAnonymously();
      if (res.error) throw res.error;
      return res.data.session;
    })().catch((err) => { sessionPromise = null; throw err; });
  }
  return sessionPromise;
}

// Failures worth retrying: no response (offline, paused project, timeout), 5xx, 408, 429, and 401 (session not
// refreshed yet). Everything else is a permanent rejection by the RPC.
export function isTransient(status) {
  return status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;
}

async function rpc(name, args) {
  await ensureSession();
  let res = await supabase.rpc(name, args);
  if (res.status === 401) { // expired token that autoRefresh missed (worker was asleep)
    await supabase.auth.refreshSession().catch(() => {});
    res = await supabase.rpc(name, args);
  }
  if (res.error) {
    const err = new Error(res.error.message || 'rpc failed');
    err.code = res.error.code;
    err.status = res.status;
    err.transient = isTransient(res.status);
    throw err;
  }
  return res.data;
}

// ------------------------------------------------------------------ persisted state: event queue, seq, pending finish

let state = { queue: [], seq: {}, finish: {}, lastOk: {}, unlocksSeen: {} };
const loading = chrome.storage.local.get(STATE_KEY).then((res) => {
  const stored = res[STATE_KEY];
  if (stored) {
    state = {
      queue: stored.queue || [],
      seq: stored.seq || {},
      finish: stored.finish || {},
      lastOk: stored.lastOk || {}, // attemptId -> ms of the last heartbeat the server accepted (D12 gap detection)
      unlocksSeen: stored.unlocksSeen || {}, // attemptId -> how many unlocks this browser has been told about
    };
  }
  if (state.queue.length || Object.keys(state.finish).length) scheduleFlush(Math.random() * 2000); // not all at once
});

async function persist() {
  await loading; // never overwrite the stored queue before it has been read
  await chrome.storage.local.set({ [STATE_KEY]: state }).catch(() => {});
}

// ------------------------------------------------------------------ event batching

let flushTimer = null;
let flushing = null;
let backoff = FLUSH_MS;

function scheduleFlush(ms) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush().catch(() => {}); }, ms);
}

function toRow(event, seq) {
  const { attemptId, t, type, q, ...detail } = event;
  const data = JSON.stringify(detail).length < 1800 ? detail : { truncated: true };
  return { attemptId, row: { seq, t, type, q: q || null, data } };
}

export async function appendEvent(event) {
  await loading; // seq continues from the stored value; callers are resumed in call order
  const next = (state.seq[event.attemptId] || 0) + 1;
  state.seq[event.attemptId] = next;
  state.queue.push(toRow(event, next));
  if (state.queue.length >= FLUSH_AT) scheduleFlush(0); else scheduleFlush(FLUSH_MS);
  await persist();
}

async function flushOnce() {
  await loading;
  // finish first needs the queue empty for that attempt, so drain events, then settle finishes
  while (state.queue.length) {
    const attemptId = state.queue[0].attemptId;
    const batch = [];
    for (const item of state.queue) {
      if (item.attemptId !== attemptId) continue;
      batch.push(item);
      if (batch.length === BATCH_MAX) break;
    }
    try {
      await rpc('log_events', { p_attempt_id: attemptId, p_events: batch.map((b) => b.row) });
    } catch (err) {
      if (err.transient || err.status === undefined) throw err;
      // Permanent (finished attempt, bad shape...): retrying can never succeed, so drop the batch.
    }
    state.queue = state.queue.filter((item) => !batch.includes(item));
    await persist();
    // a long queue (after an outage) goes out as a paced trickle of batches, not one burst
    if (state.queue.length) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS + Math.random() * BATCH_PAUSE_MS));
  }
  for (const [attemptId, status] of Object.entries(state.finish)) {
    try {
      await rpc('finish_attempt', { p_attempt_id: attemptId, p_status: status });
    } catch (err) {
      if (err.transient || err.status === undefined) throw err;
    }
    delete state.finish[attemptId];
    delete state.seq[attemptId];
    delete state.lastOk[attemptId];
    delete state.unlocksSeen[attemptId];
    await persist();
  }
}

// Concurrent callers share one run. On failure the queue is kept and retried with exponential backoff.
export function flush() {
  if (!flushing) {
    flushing = flushOnce()
      .then(() => { backoff = FLUSH_MS; })
      .catch((err) => {
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        // jitter: after a shared outage every student's retry would otherwise land on the server together
        scheduleFlush(Math.round(backoff * (0.5 + Math.random())));
        throw err;
      })
      .finally(() => { flushing = null; });
  }
  return flushing;
}

// ------------------------------------------------------------------ interface

const handlers = [];
const latest = {}; // attemptId -> {status, strikes, q}: what the next heartbeat reports
let hbTimer = null;
const hbPending = new Set();

export function onCommand(handler) {
  handlers.push(handler);
}

// What this build talks to, for the popup's status line.
export function info() {
  return { backend: 'supabase', server: SUPABASE_URL };
}

export async function getTestByFormId(formId) {
  const rows = await rpc('get_live_test', { p_form_id: formId });
  const t = Array.isArray(rows) ? rows[0] : null;
  return t ? { id: t.id, title: t.title, settings: t.settings || {} } : null;
}

// start_attempt returns the existing unfinished attempt (FR-26). A fresh row has last_heartbeat === started_at.
export async function createAttempt({ formId, student }) {
  const row = await rpc('start_attempt', {
    p_form_id: formId,
    p_name: student.name,
    p_email: student.email,
    p_chrome_email: student.chromeEmail || null,
    p_ext_version: chrome.runtime.getManifest().version,
  });
  latest[row.id] = { status: row.status, strikes: row.strikes, q: null };
  await loading;
  state.unlocksSeen[row.id] = row.unlocked_seq ?? 0; // the server's count is what this browser starts from, also on resume
  await persist();
  return { id: row.id, strikes: row.strikes, status: row.status, resumed: row.last_heartbeat !== row.started_at };
}

const FINAL = ['submitted', 'abandoned', 'closed'];

// Status/strikes changes ride on the next heartbeat; a final status is sent via finish_attempt after the queue drains
// (the events before it are flushed first, because the server rejects events for a finished attempt).
export async function patchAttempt(attemptId, patch) {
  if (FINAL.includes(patch.status)) {
    await loading;
    delete latest[attemptId];
    hbPending.delete(attemptId);
    state.finish[attemptId] = patch.status;
    await persist();
    scheduleFlush(0); // not awaited: the caller holds the session lock and the network may be slow
    return;
  }
  latest[attemptId] = { ...(latest[attemptId] || { q: null }), status: patch.status, strikes: patch.strikes };
  hbPending.add(attemptId);
  if (!hbTimer) {
    hbTimer = setTimeout(() => {
      hbTimer = null;
      const ids = [...hbPending];
      hbPending.clear();
      ids.forEach((id) => sendHeartbeat(id).catch(() => {}));
    }, HEARTBEAT_DEBOUNCE_MS);
  }
}

// D12: the server accepted a heartbeat. If the one before it was more than GAP_MIN_MS ago the student was offline (or the
// machine slept, or Chrome was closed): record a gap. It is shown to the teacher as unverified and never scored.
async function noteHeartbeatOk(attemptId, q) {
  await loading;
  const now = Date.now();
  const before = state.lastOk[attemptId];
  state.lastOk[attemptId] = now;
  if (before && now - before > GAP_MIN_MS) {
    await appendEvent({
      attemptId, t: new Date(now).toISOString(), type: 'connection_gap', q: q || null,
      seconds: Math.round((now - before) / 1000), from: new Date(before).toISOString(),
    });
  } else {
    await persist();
  }
}

async function sendHeartbeat(attemptId) {
  const cur = latest[attemptId];
  if (!cur) return;
  await loading;
  const res = await rpc('heartbeat', {
    p_attempt_id: attemptId, p_status: cur.status, p_strikes: cur.strikes, p_q: cur.q || null,
    p_unlocks_seen: state.unlocksSeen[attemptId] ?? null, // null = unknown: the server then never repeats an unlock
  });
  await noteHeartbeatOk(attemptId, cur.q);
  if (!res) return;
  // An unlock arrives as a command, or as `unlock: true` when this browser missed the response that carried it.
  // The background handler ignores it unless the exam is locked, so a repeat is harmless.
  if (res.unlock === true || (res.commands || []).some((c) => c.type === 'unlock')) {
    for (const h of handlers) await h({ type: 'unlock', attemptId });
  }
  if (typeof res.unlocks === 'number' && state.unlocksSeen[attemptId] !== res.unlocks) {
    state.unlocksSeen[attemptId] = res.unlocks; // only after the unlock was applied, so a worker crash in between repeats it
    await persist();
  }
  if (res.closed) {
    for (const h of handlers) await h({ type: 'closed', attemptId });
  }
}

// Never call this inside withSessions: the command handlers take that lock.
export async function heartbeat(attemptId, info = {}) {
  latest[attemptId] = {
    status: info.status ?? latest[attemptId]?.status ?? 'active',
    strikes: info.strikes ?? latest[attemptId]?.strikes ?? 0,
    q: info.q !== undefined ? info.q : latest[attemptId]?.q ?? null,
  };
  if (state.queue.length) flush().catch(() => {}); // opportunistic: also wakes a backed-off queue
  await sendHeartbeat(attemptId);
}

// ---- dev panel (mock-only features): inert here; tests are managed from the dashboard (M3) or SQL.
export async function saveTest() { throw new Error('Protect forms from the dashboard (or SQL) when using the Supabase backend.'); }
export async function sendCommand() { throw new Error('Unlock from the dashboard (or SQL) when using the Supabase backend.'); }
export async function listTests() { return []; }
export async function listAttempts() { return []; }
export async function listEvents() { return []; }
export async function reset() {}
