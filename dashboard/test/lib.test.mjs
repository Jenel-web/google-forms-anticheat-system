import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noHeartbeat, timeAgo, initials, rowStatus, countByFilter, stillWorking, cleanSiteEntry, describeEvent, isFlagged } from '../src/lib/format.js';

const NOW = 1_000_000;
const at = (status, agoMs) => ({ status, strikes: 0, last_heartbeat: new Date(NOW - agoMs).toISOString() });

test('FR-31: no heartbeat after 15 s, never for finished attempts', () => {
  assert.equal(noHeartbeat(at('active', 14000), NOW), false);
  assert.equal(noHeartbeat(at('active', 16000), NOW), true);
  assert.equal(noHeartbeat(at('locked', 60000), NOW), true);
  assert.equal(noHeartbeat(at('submitted', 600000), NOW), false);
  assert.equal(noHeartbeat(at('closed', 600000), NOW), false);
});

test('rowStatus lets "no heartbeat" override the stored status', () => {
  assert.equal(rowStatus(at('active', 20000), NOW), 'noheartbeat');
  assert.equal(rowStatus(at('active', 2000), NOW), 'active');
});

test('filter counts and still-working count', () => {
  const list = [at('active', 1000), at('locked', 2000), at('active', 40000), at('submitted', 99999), at('closed', 99999)];
  const c = countByFilter(list, NOW);
  assert.deepEqual([c.all, c.active, c.locked, c.noheartbeat, c.submitted, c.closed], [5, 1, 1, 1, 1, 1]);
  assert.equal(stillWorking(list), 3);
});

test('timeAgo and initials', () => {
  assert.equal(timeAgo(2000), 'now');
  assert.equal(timeAgo(12000), '12s ago');
  assert.equal(timeAgo(125000), '2m ago');
  assert.equal(initials('Maria Santos'), 'MS');
  assert.equal(initials('  ana '), 'A');
});

test('site entries are cleaned and validated', () => {
  assert.equal(cleanSiteEntry('https://www.Desmos.com/'), 'desmos.com');
  assert.equal(cleanSiteEntry('google.com/search'), 'google.com/search');
  assert.equal(cleanSiteEntry('localhost'), null);
  assert.equal(cleanSiteEntry('bad site.com'), null);
  assert.equal(cleanSiteEntry(''), null);
});

test('feed sentences', () => {
  assert.match(describeEvent({ type: 'locked', data: { strikes: 3 } }, 'Ben').text, /Ben reached 3 strikes/);
  assert.match(describeEvent({ type: 'submitted_after_close' }, 'Ann').text, /after the test ended/);
  assert.equal(describeEvent({ type: 'question_changed' }, 'Ann'), null);
  assert.equal(isFlagged({ strikes: 0, status: 'active' }), false);
  assert.equal(isFlagged({ strikes: 1, status: 'active' }), true);
});
