// Offline backend on chrome.storage.local. Same interface as the Supabase backend (see CLAUDE.md).
// Not a security boundary: it only exists so the extension can be built and tested without a server.

const KEY = 'eg_mock';
const UNFINISHED = ['active', 'away', 'warned', 'locked'];

let chain = Promise.resolve();
const handlers = [];

function emptyDb() {
  return { uid: null, tests: {}, attempts: {}, events: [], commands: [], seq: 0 };
}

// Serialize every read-modify-write so concurrent calls don't lose updates.
function tx(fn) {
  const run = async () => {
    const stored = (await chrome.storage.local.get(KEY))[KEY];
    const db = { ...emptyDb(), ...(stored || {}) };
    const result = await fn(db);
    await chrome.storage.local.set({ [KEY]: db });
    return result;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

const newId = () => crypto.randomUUID();

// What this build talks to, for the popup's status line.
export function info() {
  return { backend: 'mock', server: null };
}

export async function getTestByFormId(formId) {
  return tx(async (db) => {
    const t = Object.values(db.tests).find((x) => x.formId === formId && x.status === 'live');
    return t ? { id: t.id, title: t.title, settings: t.settings } : null;
  });
}

// Idempotent per (anonymous uid, test): an unfinished attempt is returned instead of a new one (FR-26).
export async function createAttempt({ testId, formId, student }) {
  return tx(async (db) => {
    if (!db.uid) db.uid = newId();
    const existing = Object.values(db.attempts).find(
      (a) => a.testId === testId && a.studentUid === db.uid && UNFINISHED.includes(a.status),
    );
    if (existing) {
      existing.lastHeartbeat = Date.now();
      return { id: existing.id, strikes: existing.strikes, status: existing.status, resumed: true };
    }
    const a = {
      id: newId(), testId, formId, studentUid: db.uid, student, status: 'active', strikes: 0,
      currentQ: null, startedAt: new Date().toISOString(), endedAt: null, lastHeartbeat: Date.now(),
    };
    db.attempts[a.id] = a;
    return { id: a.id, strikes: 0, status: 'active', resumed: false };
  });
}

export async function patchAttempt(attemptId, patch) {
  return tx(async (db) => {
    const a = db.attempts[attemptId];
    if (a) Object.assign(a, patch);
  });
}

export async function appendEvent(event) {
  return tx(async (db) => {
    db.events.push({ ...event, seq: ++db.seq });
    if (db.events.length > 5000) db.events.splice(0, db.events.length - 5000);
  });
}

export function onCommand(handler) {
  handlers.push(handler);
}

// Claims pending commands and dispatches them to the registered handlers, like the Supabase RPC would.
export async function heartbeat(attemptId, info = {}) {
  const claimed = await tx(async (db) => {
    const a = db.attempts[attemptId];
    if (!a) return [];
    a.lastHeartbeat = Date.now();
    if (info.q !== undefined) a.currentQ = info.q;
    const now = Date.now();
    const mine = db.commands.filter((c) => c.attemptId === attemptId && !c.consumedAt);
    mine.forEach((c) => { c.consumedAt = now; });
    return mine.map((c) => ({ type: c.type, attemptId }));
  });
  for (const cmd of claimed) {
    for (const h of handlers) await h(cmd);
  }
}

// ---- dev-only (mock) ----
export async function saveTest(test) {
  return tx(async (db) => {
    const t = { id: test.id || newId(), status: 'live', ...test };
    // a form can be live in only one test at a time (PRD §8)
    for (const o of Object.values(db.tests)) {
      if (o.id !== t.id && o.formId === t.formId && o.status === 'live' && t.status === 'live') o.status = 'ended';
    }
    db.tests[t.id] = t;
    return t;
  });
}
export async function sendCommand(attemptId, type) {
  return tx(async (db) => {
    db.commands.push({ id: ++db.seq, attemptId, type, createdAt: Date.now(), consumedAt: null });
  });
}
export async function listTests() {
  return tx(async (db) => Object.values(db.tests));
}
export async function listAttempts() {
  return tx(async (db) => Object.values(db.attempts));
}
export async function listEvents(attemptId) {
  return tx(async (db) => db.events.filter((e) => !attemptId || e.attemptId === attemptId));
}
export async function reset() {
  return tx(async (db) => { Object.assign(db, emptyDb(), { uid: db.uid }); });
}
