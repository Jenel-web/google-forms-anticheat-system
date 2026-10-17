import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPS, CAP_WINDOW_MS, allowEvent, endedSummaries } from '../src/shared/throttle.js';

const T0 = 1_000_000;

test('uncapped types always pass: strikes, returns, locks, blocked sites, submits', () => {
  const st = {};
  for (const kind of ['strike', 'returned', 'locked', 'unlocked', 'blocked_site_attempt', 'submitted', 'session_start']) {
    for (let i = 0; i < 100; i++) assert.equal(allowEvent(st, kind, T0 + i).allow, true);
  }
  assert.deepEqual(st, {}); // nothing was even tracked
});

test('a held Ctrl+C is logged 10 times and then counted, not stored', () => {
  const st = {};
  let logged = 0;
  for (let i = 0; i < 200; i++) if (allowEvent(st, 'copy_attempt', T0 + i * 10).allow) logged += 1;
  assert.equal(logged, CAPS.copy_attempt);
  assert.equal(st.copy_attempt.dropped, 190);
});

test('the window rolls: the next event after a minute is logged and the earlier drops are summarised', () => {
  const st = {};
  for (let i = 0; i < 25; i++) allowEvent(st, 'paste_attempt', T0 + i);
  const next = allowEvent(st, 'paste_attempt', T0 + CAP_WINDOW_MS + 5);
  assert.equal(next.allow, true);
  assert.deepEqual(next.summaries, [{ kind: 'paste_attempt', dropped: 15 }]);
  assert.equal(st.paste_attempt.n, 1);
});

test('types are capped independently, and each has its own limit', () => {
  const st = {};
  for (let i = 0; i < 30; i++) allowEvent(st, 'copy_attempt', T0 + i);
  assert.equal(allowEvent(st, 'paste_attempt', T0 + 31).allow, true);
  let q = 0;
  for (let i = 0; i < 100; i++) if (allowEvent(st, 'question_changed', T0 + i).allow) q += 1;
  assert.equal(q, CAPS.question_changed);
  assert.ok(CAPS.question_changed > CAPS.copy_attempt && CAPS.tab_switch > CAPS.copy_attempt);
});

test('a window that ends with no further event is summarised by the heartbeat, once', () => {
  const st = {};
  for (let i = 0; i < 14; i++) allowEvent(st, 'contextmenu_attempt', T0 + i);
  assert.deepEqual(endedSummaries(st, T0 + 30000), []); // still inside the minute
  assert.deepEqual(endedSummaries(st, T0 + CAP_WINDOW_MS + 1), [{ kind: 'contextmenu_attempt', dropped: 4 }]);
  assert.deepEqual(endedSummaries(st, T0 + CAP_WINDOW_MS + 2), []); // not repeated
});

test('at the end of the session everything pending is summarised, windows or not', () => {
  const st = {};
  for (let i = 0; i < 12; i++) allowEvent(st, 'copy_attempt', T0 + i);
  for (let i = 0; i < 3; i++) allowEvent(st, 'printscreen', T0 + i);
  assert.deepEqual(endedSummaries(st, T0 + 1000, true), [{ kind: 'copy_attempt', dropped: 2 }]);
  assert.deepEqual(st, {});
});

test('the score is unaffected: its clipboard penalty stops at 5 events and the cap is 10', () => {
  assert.ok(CAPS.copy_attempt >= 5);
});
