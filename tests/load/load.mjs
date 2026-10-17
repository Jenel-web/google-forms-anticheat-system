// Load test: N simulated students against a Supabase stack, using the same calls the extension makes
// (anonymous sign-in, get_live_test, start_attempt, heartbeat, log_events), and one teacher client that watches through
// Realtime and polling exactly like the dashboard. Phases: start storm, steady exam, every student locked at once,
// unlock-all, reconnect burst after an outage, End test, then a data-integrity check and report timing.
//
//   node tests/load/load.mjs                      # 60 students against the local stack (supabase start + db reset)
//   STUDENTS=30 STEADY_SECONDS=20 node tests/load/load.mjs
//   node tests/load/load.mjs --allow-hosted       # against SUPABASE_URL (hosted): see tests/load/README.md first
//
// Local defaults: teacher@example.com / password123 (the seed), anon key from `supabase status`.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createClient } from '../../extension/node_modules/@supabase/supabase-js/dist/index.mjs';
import { analyzeAttempt, questionHeat } from '../../extension/src/shared/integrity.js';

const args = new Set(process.argv.slice(2));
const URL_ = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_);
if (!LOCAL && !args.has('--allow-hosted')) {
  console.error('Refusing to load-test a non-local URL without --allow-hosted (it creates users and data there).');
  process.exit(2);
}
const N = Number(process.env.STUDENTS || 60);
const STEADY_S = Number(process.env.STEADY_SECONDS || 45);
const LABEL = process.env.LABEL || 'run';
const TEACHER_EMAIL = process.env.TEACHER_EMAIL || 'teacher@example.com';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'password123';
const MAX_STRIKES = 3;
// The dashboard's alert feed polls the database for these event types (it no longer streams events through Realtime).
const ALERT_TYPES = ['strike', 'locked', 'unlocked', 'blocked_site_attempt', 'left_browser', 'input_while_blocked',
  'submit_while_blocked', 'submitted', 'submitted_after_close', 'closed'];

function anonKey() {
  if (process.env.SUPABASE_ANON_KEY) return process.env.SUPABASE_ANON_KEY;
  let out = '';
  try {
    out = execSync('supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    out = String(e.stdout || ''); // exits non-zero when an unrelated container (for example vector) is stopped
  }
  const start = out.indexOf('{');
  if (start < 0) throw new Error('Could not read the anon key. Run `supabase start`, or set SUPABASE_ANON_KEY.');
  return JSON.parse(out.slice(start)).ANON_KEY;
}
const KEY = anonKey();
const clientOpts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

// ------------------------------------------------------------------ statistics
let phase = 'setup';
const stats = new Map(); // "phase|name" -> {ms: [], ok, err: {message: count}}
function record(name, ms, error) {
  const key = `${phase}|${name}`;
  const s = stats.get(key) || { ms: [], ok: 0, err: {} };
  if (error) {
    const m = String(error.message || error).slice(0, 80);
    s.err[m] = (s.err[m] || 0) + 1;
  } else {
    s.ok += 1;
    s.ms.push(ms);
  }
  stats.set(key, s);
}
async function timed(name, fn) {
  const t0 = now();
  const res = await fn();
  record(name, now() - t0, res && res.error);
  return res;
}
const pct = (arr, p) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];
};
const fmt = (v) => (v === null || v === undefined ? '-' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(0)} ms`);
const findings = [];
const note = (s) => { findings.push(s); console.log('  >', s); };
const log = (s) => console.log(s);

// ------------------------------------------------------------------ teacher (the dashboard)
const teacher = createClient(URL_, KEY, clientOpts);
const sentAt = new Map(); // marker -> performance.now() when the student created/sent it
const seen = new Set();
const rt = { attemptMsgs: 0, lockedSeen: new Map(), lockPhaseStart: null, status: 'new' };
const lastKnown = new Map(); // attempt id -> 'status|strikes', to notice changes like the dashboard does
const feedWatch = { ids: new Set(), since: null, timer: null, alertsCreated: 0 };

// The dashboard's alert feed (dashboard/src/lib/feed.js + api.js alertEvents): the first poll loads the most recent alerts,
// later polls read everything that arrived since a little before the last one. Polled every 5 s, and 700 ms after a
// status change arrives over Realtime.
async function pollFeed() {
  const since = feedWatch.since ? new Date(Date.parse(feedWatch.since) - 30000).toISOString() : null;
  const base = () => teacher.from('events').select('id, attempt_id, type, t, received_at, data, attempts!inner(test_id)')
    .eq('attempts.test_id', testId).in('type', ALERT_TYPES);
  const t0 = now();
  const r = since ? await base().gte('received_at', since).order('id') : await base().order('id', { ascending: false }).limit(40);
  record('dashboard poll: alert events', now() - t0, r.error);
  if (r.error) return;
  for (const row of r.data) {
    if (feedWatch.ids.has(row.id)) continue;
    feedWatch.ids.add(row.id);
    if (row.received_at && (!feedWatch.since || Date.parse(row.received_at) > Date.parse(feedWatch.since))) feedWatch.since = row.received_at;
    const mk = row.data && row.data.mk;
    if (mk && sentAt.has(mk) && !seen.has(mk)) { seen.add(mk); record('alert event -> dashboard feed', now() - sentAt.get(mk)); }
  }
}
function scheduleFeed() { clearTimeout(feedWatch.timer); feedWatch.timer = setTimeout(pollFeed, 700); }
let testId = null;

function onAttempt(p) {
  rt.attemptMsgs += 1;
  const row = p.new;
  if (!row || !row.id) return;
  const t = now();
  const mk = row.current_q && row.current_q.mk;
  if (mk && sentAt.has(mk) && !seen.has(mk)) {
    seen.add(mk);
    const old = phase;
    record('realtime: heartbeat -> dashboard', t - sentAt.get(mk));
    phase = old;
  }
  const sig = `${row.status}|${row.strikes}`;
  if (lastKnown.get(row.id) !== sig) { lastKnown.set(row.id, sig); scheduleFeed(); }
  if (row.status === 'locked' && rt.lockPhaseStart !== null && !rt.lockedSeen.has(row.id)) rt.lockedSeen.set(row.id, t - rt.lockPhaseStart);
}
// ------------------------------------------------------------------ simulated student (mirrors backend.supabase.js)
class Student {
  constructor(i) {
    this.i = i;
    this.client = createClient(URL_, KEY, clientOpts);
    this.seq = 0;
    this.hbn = 0;
    this.queue = [];
    this.created = 0;
    this.acked = 0;
    this.status = 'active';
    this.strikes = 0;
    this.qi = 1;
    this.flushing = false;
    this.closedAt = null;
    this.unlockedAt = null;
    this.firstBatch = null;
    this.ready = false;
  }

  async start() {
    const si = await timed('anonymous sign-in', () => this.client.auth.signInAnonymously());
    if (si.error) return false;
    this.uid = si.data.user.id;
    const t = await timed('get_live_test', () => this.client.rpc('get_live_test', { p_form_id: FORM_ID }));
    if (t.error) return false;
    const a = await timed('start_attempt', () => this.client.rpc('start_attempt', {
      p_form_id: FORM_ID, p_name: `Load Student ${String(this.i).padStart(2, '0')}`,
      p_email: `load${this.i}@school.edu`, p_chrome_email: `load${this.i}@school.edu`, p_ext_version: 'load',
    }));
    if (a.error) return false;
    this.id = a.data.id;
    this.ready = true;
    return true;
  }

  event(type, data = {}) {
    const seq = ++this.seq;
    const mk = `${this.id}:e${seq}`;
    sentAt.set(mk, now());
    this.created += 1;
    if (ALERT_TYPES.includes(type)) feedWatch.alertsCreated += 1;
    const row = { seq, t: new Date().toISOString(), type, q: { i: this.qi, n: 20 }, data: { ...data, mk } };
    this.queue.push(row);
    return row;
  }

  async flush() {
    if (this.flushing || !this.queue.length || !this.ready) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.slice(0, 50);
        if (!this.firstBatch) this.firstBatch = batch;
        const res = await timed('log_events', () => this.client.rpc('log_events', { p_attempt_id: this.id, p_events: batch }));
        if (res.error) {
          const transient = res.status === 0 || res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500;
          if (transient) break; // the extension keeps the queue and retries with backoff
          this.queue.splice(0, batch.length); // permanent rejection (for example the attempt is finished): drop it
        } else {
          this.queue.splice(0, batch.length);
          this.acked += res.data;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async hb() {
    if (!this.ready) return;
    const mk = `${this.id}:h${++this.hbn}`;
    sentAt.set(mk, now());
    const res = await timed('heartbeat', () => this.client.rpc('heartbeat', {
      p_attempt_id: this.id, p_status: this.status, p_strikes: this.strikes, p_q: { i: this.qi, n: 20, mk },
    }));
    if (res.error || !res.data) return;
    const d = res.data;
    if (d.closed && this.closedAt === null) this.closedAt = now();
    if ((d.commands || []).some((c) => c.type === 'unlock') && this.unlockedAt === null) this.unlockedAt = now();
    if (!d.finished) { this.status = d.status; this.strikes = d.strikes; }
  }

  loop() {
    this.hbTimer = setInterval(() => this.hb(), 5000);
    this.flushTimer = setInterval(() => this.flush(), 2000);
  }
  stop() { clearInterval(this.hbTimer); clearInterval(this.flushTimer); }
}

// ------------------------------------------------------------------ run
const FORM_ID = `load-${Date.now().toString(36)}`;
let students = [];
const startedAt = Date.now();

async function main() {
  log(`Load test: ${N} students, ${STEADY_S}s steady phase -> ${URL_} ${LOCAL ? '(local stack)' : '(HOSTED)'}`);

  // ---- setup: teacher signs in, creates and starts a test, subscribes like the dashboard
  const si = await teacher.auth.signInWithPassword({ email: TEACHER_EMAIL, password: TEACHER_PASSWORD });
  if (si.error) throw new Error(`teacher sign-in failed: ${si.error.message}`);
  const created = await teacher.from('tests').insert({
    title: `Load test ${LABEL}`, form_id: FORM_ID, form_url: `https://docs.google.com/forms/d/e/${FORM_ID}/viewform`,
    settings: { maxStrikes: MAX_STRIKES },
  }).select().single();
  if (created.error) throw new Error(`could not create test: ${created.error.message}`);
  testId = created.data.id;
  const live = await teacher.rpc('go_live', { p_test_id: testId, p_one_response: true, p_verified_email: true });
  if (live.error) throw new Error(`go_live failed: ${live.error.message}`);
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('realtime did not subscribe within 15 s')), 15000);
    teacher.channel(`load-${testId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempts', filter: `test_id=eq.${testId}` }, onAttempt)
      .subscribe((s) => { rt.status = s; if (s === 'SUBSCRIBED') { clearTimeout(to); resolve(); } });
  });

  feedWatch.timer = null;
  const feedPoll = setInterval(pollFeed, 5000);
  teacher.feedPoll = feedPoll;
  await pollFeed();

  // ---- A. start storm: everyone opens the exam at the same moment
  phase = 'A start storm';
  log(`\n[A] ${N} students start at the same moment`);
  students = Array.from({ length: N }, (_, i) => new Student(i + 1));
  const t0 = now();
  const started = await Promise.all(students.map((s) => s.start()));
  const okCount = started.filter(Boolean).length;
  log(`  ${okCount}/${N} students started in ${fmt(now() - t0)}`);
  if (okCount < N) {
    const errs = stats.get('A start storm|anonymous sign-in')?.err || {};
    note(`Only ${okCount} of ${N} students could start. Sign-in errors: ${JSON.stringify(errs)}. Anonymous sign-ins are rate limited per IP address (default 30 per hour), so a whole class behind one shared IP cannot all start. Raise it under Authentication -> Rate Limits.`);
  }
  students = students.filter((s) => s.ready);
  if (!students.length) return finish();
  const tCount = students.length;

  // ---- B. steady exam
  phase = 'B steady exam';
  log(`\n[B] steady exam for ${STEADY_S}s: heartbeat every 5 s, events every ~3 s, 20% of students leave once`);
  students.forEach((s) => { setTimeout(() => s.loop(), Math.random() * 5000); });
  const endB = Date.now() + STEADY_S * 1000;
  const eventTimers = students.map((s) => setInterval(() => {
    const k = Math.random();
    if (k < 0.4) { s.qi = Math.min(20, s.qi + 1); s.event('question_changed'); }
    else if (k < 0.7) s.event('copy_attempt');
    else s.event('paste_attempt');
  }, 2500 + Math.random() * 1500));
  const leavers = students.filter((_, i) => i % 5 === 0);
  leavers.forEach((s) => setTimeout(() => {
    s.strikes += 1; s.status = 'warned';
    s.event('tab_switch'); s.event('strike', { n: s.strikes, reason: 'tab_switch' });
    setTimeout(() => s.event('returned', { durationMs: 6000, reasons: ['tab_switch'], domains: [] }), 6000);
  }, Math.random() * STEADY_S * 600));
  const polls = [];
  const pollTimer = setInterval(async () => { // the dashboard's 5 s poll fallback
    const t = now();
    const r = await teacher.from('attempts').select('*').eq('test_id', testId).order('started_at');
    record('dashboard poll: list attempts', now() - t, r.error);
    if (!r.error) polls.push(r.data.length);
  }, 5000);
  while (Date.now() < endB) await sleep(500);
  eventTimers.forEach(clearInterval);
  await sleep(4000); // let the queues drain and realtime catch up
  log(`  dashboard so far: ${rt.attemptMsgs} live status updates, ${feedWatch.ids.size} of ${feedWatch.alertsCreated} alert events in the feed`);

  // ---- C. everyone is locked at the same moment
  phase = 'C all locked';
  log(`\n[C] all ${tCount} students reach the strike limit and lock at the same moment`);
  const attemptMsgs0 = rt.attemptMsgs;
  rt.lockPhaseStart = now(); rt.lockedSeen = new Map();
  const tC = now();
  await Promise.all(students.map(async (s) => {
    s.strikes = MAX_STRIKES; s.status = 'locked';
    s.event('strike', { n: MAX_STRIKES, reason: 'tab_opened' });
    s.event('returned', { durationMs: 8000, reasons: ['tab_opened'], domains: ['example.org'] });
    s.event('locked', { strikes: MAX_STRIKES });
    await Promise.all([s.flush(), s.hb()]);
  }));
  const writesDone = now() - tC;
  log(`  all ${tCount} lock writes completed in ${fmt(writesDone)}`);
  const pollT = now();
  const pollRes = await teacher.from('attempts').select('*').eq('test_id', testId);
  record('dashboard poll: list attempts', now() - pollT, pollRes.error);
  const lockedByPoll = (pollRes.data || []).filter((a) => a.status === 'locked').length;
  log(`  dashboard poll right after: ${lockedByPoll}/${tCount} locked (query ${fmt(now() - pollT)})`);
  const waitUntil = Date.now() + 15000;
  while (rt.lockedSeen.size < tCount && Date.now() < waitUntil) await sleep(100);
  await sleep(1500);
  const lockSeen = [...rt.lockedSeen.values()];
  log(`  realtime showed ${rt.lockedSeen.size}/${tCount} students locked; the last one after ${fmt(Math.max(0, ...lockSeen))}`);
  const dAttempts = rt.attemptMsgs - attemptMsgs0;
  log(`  live status updates for this burst: ${dAttempts}`);
  if (rt.lockedSeen.size < tCount) note(`Realtime delivered only ${rt.lockedSeen.size} of ${tCount} lock updates during the burst. The dashboard's 5 s poll still shows the right table (${lockedByPoll}/${tCount} locked).`);
  const feedWaitFrom = now(); const feedDeadline = Date.now() + 20000;
  while (feedWatch.ids.size < feedWatch.alertsCreated && Date.now() < feedDeadline) await sleep(100);
  const feedMs = now() - tC;
  log(`  alert feed: ${feedWatch.ids.size} of ${feedWatch.alertsCreated} alert events shown${feedWatch.ids.size >= feedWatch.alertsCreated ? `, complete ${fmt(feedMs)} after the burst started` : ' (incomplete after 20 s)'}`);
  record('alert feed complete after all-locked burst', feedMs);
  if (feedWatch.ids.size < feedWatch.alertsCreated) note(`The alert feed was missing ${feedWatch.alertsCreated - feedWatch.ids.size} alert events 20 s after the all-locked burst.`);
  rt.lockPhaseStart = null;

  // ---- D. unlock everyone at the same moment
  phase = 'D unlock all';
  log(`\n[D] teacher unlocks all ${tCount} students at the same moment (${tCount} rapid clicks)`);
  students.forEach((s) => { s.unlockedAt = null; });
  const tD = now();
  await Promise.all(students.map(async (s) => {
    const t = now();
    const r = await teacher.from('commands').insert({ attempt_id: s.id, type: 'unlock' });
    record('teacher: insert unlock command', now() - t, r.error);
  }));
  const dDeadline = Date.now() + 25000;
  while (students.some((s) => s.unlockedAt === null) && Date.now() < dDeadline) await sleep(100);
  const unlockLat = students.filter((s) => s.unlockedAt !== null).map((s) => s.unlockedAt - tD);
  log(`  ${unlockLat.length}/${tCount} students received the unlock; p50 ${fmt(pct(unlockLat, 50))}, p95 ${fmt(pct(unlockLat, 95))}, max ${fmt(pct(unlockLat, 100))}`);
  record('unlock click -> student unlocked', pct(unlockLat, 50)); // median shown in the summary table, spread above
  const cmds = await teacher.from('commands').select('attempt_id, consumed_at').in('attempt_id', students.map((s) => s.id));
  const consumed = (cmds.data || []).filter((c) => c.consumed_at).length;
  log(`  commands consumed exactly once: ${consumed}/${(cmds.data || []).length}`);
  if (unlockLat.length < tCount) note(`${tCount - unlockLat.length} unlock commands were not delivered within 25 s.`);
  if (consumed !== (cmds.data || []).length) note(`${(cmds.data || []).length - consumed} unlock commands were not consumed.`);
  const stillLocked = students.filter((s) => s.status === 'locked').length;
  log(`  students still locked afterwards: ${stillLocked}; strikes reset to ${students[0].strikes} (max ${MAX_STRIKES} -> ${MAX_STRIKES - 1})`);

  // ---- E. reconnect burst after an outage: everyone flushes a big queue at once
  phase = 'E reconnect burst';
  const PER = Number(process.env.BURST_PER || 100);
  log(`\n[E] outage ends: every student sends ${PER} queued events and a heartbeat at the same moment`);
  const bursts = students.map((s) => { for (let k = 0; k < PER; k++) s.event(k % 4 === 0 ? 'question_changed' : 'copy_attempt'); return s; });
  const tE = now();
  await Promise.all(bursts.map((s) => Promise.all([s.flush(), s.hb()])));
  log(`  ${tCount * PER} queued events from ${tCount} students written in ${fmt(now() - tE)}`);
  // Wait until every status update sent from the burst on has reached the dashboard.
  const pendingHb = () => [...sentAt].filter(([k, v]) => k.includes(':h') && v >= tE && !seen.has(k)).length;
  const catchStart = now(); let statusCaughtUp = null;
  while (now() - catchStart < 90000) {
    if (pendingHb() === 0) { statusCaughtUp = now() - tE; break; }
    await sleep(100);
  }
  log(`  status updates (heartbeats) from the burst fully caught up on the dashboard after ${fmt(statusCaughtUp)}`);
  record('status updates caught up after burst', statusCaughtUp);
  if (statusCaughtUp === null || statusCaughtUp > 5000) note(`After a reconnect burst of ${tCount * PER} events, the live monitor's status updates took ${statusCaughtUp === null ? 'more than 90 s' : fmt(statusCaughtUp)} to catch up.`);

  const dupe = await students[0].client.rpc('log_events', { p_attempt_id: students[0].id, p_events: students[0].firstBatch });
  log(`  replaying an already-sent batch inserted ${dupe.data} new rows (expected 0: retries are idempotent)`);
  if (dupe.data !== 0) note(`Replaying a batch inserted ${dupe.data} duplicate rows.`);

  // ---- F. teacher ends the test
  phase = 'F end test';
  log(`\n[F] teacher ends the test while all ${tCount} students are still working`);
  const tF = now();
  const ended = await teacher.rpc('end_test', { p_test_id: testId });
  record('teacher: end_test', now() - tF, ended.error);
  const fDeadline = Date.now() + 25000;
  while (students.some((s) => s.closedAt === null) && Date.now() < fDeadline) await sleep(100);
  const closeLat = students.filter((s) => s.closedAt !== null).map((s) => s.closedAt - tF);
  log(`  ${closeLat.length}/${tCount} students saw "closed"; p50 ${fmt(pct(closeLat, 50))}, p95 ${fmt(pct(closeLat, 95))}, max ${fmt(pct(closeLat, 100))}`);
  record('end_test -> student sees closed', pct(closeLat, 50));
  if (closeLat.length < tCount) note(`${tCount - closeLat.length} students had not seen the closed flag within 25 s.`);
  const late = students.slice(0, 5);
  late.forEach((s) => s.event('copy_attempt'));
  await Promise.all(late.map((s) => s.flush()));
  const rejected = Object.entries(stats.get('F end test|log_events')?.err || {}).map(([m, c]) => `${c} x "${m}"`).join(', ') || 'none';
  log(`  events sent after the test ended are rejected as designed: ${rejected}`);

  await finish();
}

async function finish() {
  students.forEach((s) => s.stop());
  clearInterval(teacher.feedPoll);
  await sleep(3000);

  // ---- G. integrity and report timing
  phase = 'G integrity + report';
  log('\n[G] data integrity and report load');
  const tG = now();
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const t = now();
    const r = await teacher.from('events').select('id, attempt_id, seq, t, type, q, data, received_at, attempts!inner(test_id)')
      .eq('attempts.test_id', testId).order('id').range(from, from + 999);
    record('report: events page (1000 rows)', now() - t, r.error);
    if (r.error) break;
    rows.push(...r.data);
    if (r.data.length < 1000) break;
  }
  log(`  report fetch: ${rows.length} events in ${fmt(now() - tG)}`);
  const per = new Map();
  for (const r of rows) per.set(r.attempt_id, (per.get(r.attempt_id) || 0) + 1);
  const acked = students.reduce((s, x) => s + x.acked, 0);
  const created = students.reduce((s, x) => s + x.created, 0);
  const mismatched = students.filter((s) => (per.get(s.id) || 0) !== s.acked).length;
  log(`  events created by students: ${created}; acknowledged by the server: ${acked}; stored: ${rows.length}`);
  await pollFeed();
  const alertRows = rows.filter((r) => ALERT_TYPES.includes(r.type)).length;
  log(`  alert events stored: ${alertRows}; shown in the dashboard feed: ${feedWatch.ids.size}`);
  if (feedWatch.ids.size < alertRows) note(`The dashboard feed showed ${feedWatch.ids.size} of ${alertRows} stored alert events (${alertRows - feedWatch.ids.size} missing).`);
  log(`  students whose stored count differs from what the server acknowledged: ${mismatched}`);
  if (mismatched) note(`${mismatched} students have a stored event count that differs from the number the server acknowledged.`);
  const rejectedAfterClose = created - acked;
  log(`  events never stored: ${rejectedAfterClose} (expected: the ${Math.min(5, students.length)} sent after End)`);
  if (rejectedAfterClose > Math.min(5, students.length)) note(`${rejectedAfterClose - Math.min(5, students.length)} events were created but never stored, beyond the ${Math.min(5, students.length)} sent after End.`);
  const byAttempt = new Map(students.map((s) => [s.id, []]));
  for (const r of rows) byAttempt.get(r.attempt_id)?.push(r);
  const tA = now();
  for (const evs of byAttempt.values()) analyzeAttempt(evs);
  questionHeat([...byAttempt].map(([id, events]) => ({ id, events })));
  record('report: score + heatmap for all students (in the browser)', now() - tA);
  const finalAttempts = await teacher.from('attempts').select('status').eq('test_id', testId);
  const closed = (finalAttempts.data || []).filter((a) => a.status === 'closed').length;
  log(`  attempts closed after End: ${closed}/${(finalAttempts.data || []).length}`);

  report();
  await cleanup();
}

function report() {
  const lines = [];
  lines.push(`# Load test report (${LABEL})`, '');
  lines.push(`- Target: ${URL_} ${LOCAL ? '(local Supabase stack on this PC)' : '(hosted)'}`);
  lines.push(`- Students: ${students.length} of ${N} requested, run on ${new Date(startedAt).toISOString()}`);
  lines.push(`- Live status updates (Realtime) received by the dashboard client: ${rt.attemptMsgs}; alert events shown by the polled feed: ${feedWatch.ids.size}`, '');
  lines.push('| Phase | Call | Count | Errors | p50 | p95 | p99 | Max |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [key, s] of stats) {
    const [ph, name] = key.split('|');
    const errs = Object.values(s.err).reduce((a, b) => a + b, 0);
    lines.push(`| ${ph} | ${name} | ${s.ok + errs} | ${errs} | ${fmt(pct(s.ms, 50))} | ${fmt(pct(s.ms, 95))} | ${fmt(pct(s.ms, 99))} | ${fmt(pct(s.ms, 100))} |`);
  }
  const errDetail = [...stats].filter(([, s]) => Object.keys(s.err).length).map(([k, s]) => `- ${k.replace('|', ' / ')}: ${JSON.stringify(s.err)}`);
  if (errDetail.length) lines.push('', '## Errors', ...errDetail);
  lines.push('', '## Findings', ...(findings.length ? findings.map((f) => `- ${f}`) : ['- No problems found in this run.']));
  const md = lines.join('\n') + '\n';
  writeFileSync(new URL(`./last_run_${LABEL}.md`, import.meta.url), md);
  console.log('\n' + md);
}

async function cleanup() {
  if (args.has('--keep')) return;
  try {
    await teacher.from('tests').delete().eq('id', testId); // cascades to attempts, events and commands
    if (LOCAL) {
      const ids = students.map((s) => `'${s.uid}'`).join(',');
      if (ids) {
        const db = execSync('docker ps --format {{.Names}} --filter name=supabase_db', { encoding: 'utf8' }).split(/\s+/)[0];
        execSync(`docker exec ${db} psql -U postgres -c "delete from auth.users where is_anonymous and id in (${ids})"`, { stdio: 'ignore' });
      }
    }
    console.log('Cleaned up: the load test and its simulated students were removed.');
  } catch (e) {
    console.log(`Cleanup skipped: ${e.message}`);
  }
  process.exit(0);
}

main().catch(async (e) => {
  console.error('Load test failed:', e.message);
  students.forEach((s) => s.stop());
  try { await cleanup(); } catch { /* ignore */ }
  process.exit(1);
});
