import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAttempt, findGaps, questionHeat, heatLevel, scoreBand } from '../src/shared/integrity.js';

const T0 = Date.parse('2026-10-15T09:00:00Z');
let id = 0;
const ev = (type, secs, extra = {}) => ({ id: ++id, t: new Date(T0 + secs * 1000).toISOString(), type, q: null, data: {}, ...extra });
const strike = (secs, q, n = 1) => ev('strike', secs, { q: { i: q, n: 10 }, data: { n, reason: 'tab_switch' } });
const returned = (secs, q, away) => ev('returned', secs, { q: { i: q, n: 10 }, data: { durationMs: away * 1000, reasons: ['tab_switch'], domains: [] } });
const qchange = (secs, q) => ev('question_changed', secs, { q: { i: q, n: 10 } });

test('PRD §6.8 hand example: 2 strikes and 30 s away = 100 - 20 - 15 = 65', () => {
  const r = analyzeAttempt([strike(10, 2), returned(20, 2, 10), strike(60, 3, 2), returned(80, 3, 20)]);
  assert.equal(r.strikes, 2);
  assert.equal(r.awaySeconds, 30);
  assert.equal(r.score, 65);
});

test('a clean attempt scores 100', () => {
  assert.equal(analyzeAttempt([ev('session_start', 0), qchange(5, 1)]).score, 100);
});

test('away time is capped at -30, clipboard at -10, and the score never goes below 0', () => {
  const longAway = analyzeAttempt([strike(0, 1), returned(1000, 1, 1000)]);
  assert.equal(longAway.penalties.away.points, 30);
  assert.equal(longAway.score, 60); // 100 - 10 - 30
  const clip = analyzeAttempt(Array.from({ length: 9 }, (_, i) => ev('paste_attempt', i)));
  assert.equal(clip.penalties.clipboard.points, 10);
  assert.equal(clip.score, 90);
  const awful = analyzeAttempt([
    ...Array.from({ length: 12 }, (_, i) => strike(i, 1, i + 1)),
    ...Array.from({ length: 5 }, (_, i) => ev('blocked_site_attempt', 100 + i)),
  ]);
  assert.equal(awful.score, 0);
});

test('blocked site -15, copy/cut/paste/contextmenu/shortcut -2 each', () => {
  const r = analyzeAttempt([ev('blocked_site_attempt', 1), ev('copy_attempt', 2), ev('cut_attempt', 3), ev('contextmenu_attempt', 4), ev('shortcut_blocked', 5)]);
  assert.equal(r.score, 100 - 15 - 8);
});

test('suspicious return: back and on another question within 10 s costs 5', () => {
  const quick = analyzeAttempt([strike(0, 4), returned(5, 4, 5), qchange(9, 5)]);
  assert.equal(quick.suspiciousReturns.length, 1);
  assert.equal(quick.score, 83); // 100 - 10 - 2.5 - 5 = 82.5, rounded up
  const slow = analyzeAttempt([strike(0, 4), returned(5, 4, 5), qchange(16, 5)]);
  assert.equal(slow.suspiciousReturns.length, 0);
  const same = analyzeAttempt([strike(0, 4), returned(5, 4, 5), qchange(7, 4)]);
  assert.equal(same.suspiciousReturns.length, 0);
});

test('D12: an offline gap is reported but never scored', () => {
  const gap = ev('connection_gap', 100, { data: { seconds: 60 } });
  const r = analyzeAttempt([ev('session_start', 0), gap, ev('submitted', 200)]);
  assert.equal(r.score, 100);
  assert.equal(r.gaps.length, 1);
  assert.equal(r.gaps[0].seconds, 60);
  assert.equal(r.gapFlag, false);
});

test('D12: late delivery (server arrival much later than the event time) is a gap, and is not counted twice', () => {
  const late = ev('question_changed', 10, { received_at: new Date(T0 + 100 * 1000).toISOString() });
  const gaps = findGaps([late, ev('connection_gap', 100, { data: { seconds: 90 } })]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].source, 'reported');
  assert.equal(findGaps([late]).length, 1);
  assert.equal(findGaps([ev('x', 10, { received_at: new Date(T0 + 20 * 1000).toISOString() })]).length, 0);
});

test('D12 flags: more than 2 minutes in total, or more than 3 gaps', () => {
  assert.equal(analyzeAttempt([ev('connection_gap', 200, { data: { seconds: 130 } })]).gapFlag, true);
  const four = [100, 300, 500, 700].map((s) => ev('connection_gap', s, { data: { seconds: 40 } }));
  assert.equal(analyzeAttempt(four).gapFlag, true);
  assert.equal(analyzeAttempt(four.slice(0, 3)).gapFlag, false);
});

test('events are analysed in time order even when they arrive out of order', () => {
  const r = analyzeAttempt([returned(20, 2, 10), strike(10, 2)]);
  assert.equal(r.episodes.length, 1);
  assert.equal(r.episodes[0].durationMs, 10000);
});

test('question heatmap counts episodes, seconds and distinct students per question', () => {
  const a = { id: 'a', events: [strike(0, 2), returned(10, 2, 10), strike(50, 2, 2), returned(55, 2, 5)] };
  const b = { id: 'b', events: [strike(0, 2), returned(8, 2, 8), strike(30, 4, 2)] };
  const { cells } = questionHeat([a, b]);
  assert.equal(cells.length, 10);
  assert.deepEqual(cells[1], { q: 2, episodes: 3, awaySeconds: 23, students: 2 });
  assert.deepEqual(cells[3], { q: 4, episodes: 1, awaySeconds: 0, students: 1 });
  assert.equal(cells[0].episodes, 0);
  assert.equal(heatLevel(0, 3), 0);
  assert.equal(heatLevel(3, 3), 4);
  assert.equal(heatLevel(1, 3), 2);
});

test('score bands', () => {
  assert.deepEqual([100, 85, 84, 60, 59, 0].map(scoreBand), ['ok', 'ok', 'mid', 'mid', 'low', 'low']);
});
