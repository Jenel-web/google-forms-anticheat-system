import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEED_OVERLAP_MS, feedSince, mergeAlerts, newFeedState } from '../src/lib/feed.js';

const T = Date.parse('2026-10-17T09:00:00Z');
const iso = (secs) => new Date(T + secs * 1000).toISOString();
const ev = (id, type, secs, extra = {}) => ({ id, attempt_id: 'a1', type, t: iso(secs), received_at: iso(secs + 1), data: {}, ...extra });
const name = () => 'Ana';

test('first load: shows alerts newest first and remembers where it got to', () => {
  const st = newFeedState();
  assert.equal(feedSince(st), null); // null = load the most recent alerts
  const entries = mergeAlerts([ev(3, 'locked', 30, { data: { strikes: 3 } }), ev(2, 'strike', 20, { data: { reason: 'tab_switch' } })], st, name);
  assert.deepEqual(entries.map((e) => e.id), [3, 2]);
  assert.match(entries[0].text, /Ana reached 3 strikes/);
  assert.equal(st.since, iso(31));
});

test('later polls start a little before the last arrival, and already-shown rows are skipped', () => {
  const st = newFeedState();
  mergeAlerts([ev(1, 'strike', 10)], st, name);
  assert.equal(feedSince(st), new Date(T + 11000 - FEED_OVERLAP_MS).toISOString());
  const again = mergeAlerts([ev(1, 'strike', 10), ev(2, 'locked', 40)], st, name);
  assert.deepEqual(again.map((e) => e.id), [2]); // row 1 came back because of the overlap and is not shown twice
});

test('a row that commits late with a lower id than one already shown is still picked up', () => {
  const st = newFeedState();
  mergeAlerts([ev(101, 'strike', 10)], st, name);
  const late = mergeAlerts([ev(100, 'blocked_site_attempt', 9, { received_at: iso(10), data: { domain: 'chatgpt.com' } }), ev(101, 'strike', 10)], st, name);
  assert.deepEqual(late.map((e) => e.id), [100]);
  assert.match(late[0].text, /chatgpt\.com/);
});

test('events that are not alerts add nothing, but still move the poll window', () => {
  const st = newFeedState();
  const entries = mergeAlerts([ev(5, 'question_changed', 50)], st, name);
  assert.deepEqual(entries, []);
  assert.equal(st.since, iso(51));
});

test('an empty feed keeps asking for the most recent alerts', () => {
  const st = newFeedState();
  mergeAlerts([], st, name);
  assert.equal(feedSince(st), null);
});
