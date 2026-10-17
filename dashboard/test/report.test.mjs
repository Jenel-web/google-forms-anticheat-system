import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, readCsvColumn } from '../src/lib/csv.js';
import { readResponseEmails, reconcile } from '../src/lib/reconcile.js';
import { buildTimeline, eventRows, attemptRows, ATTEMPT_COLUMNS, formatDuration, classSummary } from '../src/lib/report.js';
import { analyzeAttempt } from '../../extension/src/shared/integrity.js';

const T0 = Date.parse('2026-10-15T09:00:00Z');
let id = 0;
const ev = (type, secs, extra = {}) => ({ id: ++id, t: new Date(T0 + secs * 1000).toISOString(), type, q: null, data: {}, ...extra });

test('CSV: quotes, commas, line breaks, CRLF, and formulas are defused', () => {
  const text = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [
    { a: 'plain', b: 'has,comma' }, { a: 'say "hi"', b: 'two\nlines' }, { a: '=SUM(A1)', b: '-5 apples' }, { a: 12, b: -3 },
  ]);
  assert.equal(text, 'A,B\r\nplain,"has,comma"\r\n"say ""hi""","two\nlines"\r\n\'=SUM(A1),\'-5 apples\r\n12,-3\r\n');
});

test('CSV export: one event row per stored event, one attempt row per attempt', () => {
  const a = { id: 'a1', student_name: 'Ana', student_email: 'ana@x.edu', verified: true, status: 'submitted', started_at: 's' };
  const events = [ev('session_start', 0), ev('strike', 5, { data: { n: 1, reason: 'tab_switch' } }), ev('returned', 15, { data: { durationMs: 10000 } })];
  const rows = eventRows([a], new Map([['a1', events]]));
  assert.equal(rows.length, 3);
  const analyses = new Map([['a1', analyzeAttempt(events)]]);
  const att = attemptRows([a], analyses);
  assert.equal(att[0].score, 85);
  assert.equal(toCsv(ATTEMPT_COLUMNS, att).split('\r\n').length, 3); // header + 1 row + trailing newline
});

test('readCsvColumn keeps only the chosen column and handles quoted multi-line answers', () => {
  const csv = '﻿Timestamp,Email Address,Q1\r\n2026/10/15 9:01,ana@x.edu,"a long, answer\nwith ""quotes"""\r\n2026/10/15 9:02,Ben@X.edu,B\r\n';
  const r = readCsvColumn(csv, (h) => h.indexOf('Email Address'));
  assert.deepEqual(r, { found: true, values: ['ana@x.edu', 'Ben@X.edu'], rows: 2 });
  assert.equal(JSON.stringify(r).includes('answer'), false);
});

test('readResponseEmails: finds the email column, or says it is missing', () => {
  assert.deepEqual(readResponseEmails('Timestamp,Email Address,Score\n1,A@x.edu,3\n2,b@x.edu,4').emails, ['a@x.edu', 'b@x.edu']);
  assert.equal(readResponseEmails('Timestamp,Name,Q1\n1,Ana,x').found, false);
  assert.equal(readResponseEmails('').found, false);
});

test('D8 sample: matched, submission with no attempt, attempt with no submission', () => {
  const attempts = [
    { id: 'a1', student_name: 'Ana', student_email: 'ana@x.edu', chrome_email: 'ana@x.edu', status: 'submitted' },
    { id: 'a2', student_name: 'Cara', student_email: 'cara@x.edu', chrome_email: null, status: 'locked' },
  ];
  const csv = 'Timestamp,Email Address,Q1\n1,ANA@x.edu,secret answer\n2,ben@x.edu,another answer\n';
  const res = reconcile(attempts, readResponseEmails(csv).emails);
  assert.deepEqual(res.matched.map((m) => m.attempt.id), ['a1']);
  assert.deepEqual(res.noAttempt.map((m) => m.email), ['ben@x.edu']);
  assert.deepEqual(res.noSubmission.map((m) => m.attempt.id), ['a2']);
  assert.equal(JSON.stringify(res).includes('answer'), false); // no answer text survives parsing
});

test('reconcile also matches the Chrome profile email, and reports duplicate responses', () => {
  const attempts = [{ id: 'a1', student_name: 'Ana', student_email: 'typed@x.edu', chrome_email: 'real@x.edu', status: 'submitted' }];
  const res = reconcile(attempts, ['real@x.edu', 'real@x.edu']);
  assert.equal(res.matched[0].responses, 2);
  assert.equal(res.noAttempt.length, 0);
});

test('timeline folds an episode into one item and keeps minor events separate', () => {
  const events = [
    ev('session_start', 0, { data: { mode: 'enforce' } }), ev('consent_accepted', 0),
    ev('question_changed', 5, { q: { i: 6, n: 10 } }),
    ev('tab_switch', 20, { q: { i: 6, n: 10 } }),
    ev('strike', 20, { q: { i: 6, n: 10 }, data: { n: 1, reason: 'tab_switch' } }),
    ev('returned', 28, { q: { i: 6, n: 10 }, data: { durationMs: 8000, reasons: ['tab_switch'], domains: [] } }),
    ev('paste_attempt', 40, { q: { i: 6, n: 10 } }),
    ev('submitted', 90),
  ];
  const { items, analysis } = buildTimeline(events, 3);
  assert.deepEqual(items.map((i) => i.title), ['Started exam', 'Moved to question 6', 'Left the exam tab for 8s', 'Tried to paste', 'Submitted']);
  assert.equal(items[2].detail, 'Strike 1 of 3 · switched tabs');
  assert.equal(items.filter((i) => !i.minor).length, 4);
  assert.equal(analysis.score, 100 - 10 - 4 - 2);
});

test('timeline shows a connection gap at its start, labelled unverified', () => {
  const events = [ev('session_start', 0), ev('connection_gap', 100, { data: { seconds: 60 } }), ev('submitted', 120)];
  const { items, analysis } = buildTimeline(events);
  const gap = items.find((i) => i.title.startsWith('Connection gap'));
  assert.equal(gap.title, 'Connection gap (unverified)');
  assert.equal(gap.t, new Date(T0 + 40 * 1000).toISOString());
  assert.equal(analysis.score, 100);
});

test('class summary and duration text', () => {
  const attempts = [{ id: 'a' }, { id: 'b' }];
  const analyses = new Map([['a', { score: 100 }], ['b', { score: 60 }]]);
  const byAttempt = new Map([['a', []], ['b', [{ type: 'locked' }, { type: 'unlocked' }]]]);
  assert.deepEqual(classSummary(attempts, analyses, byAttempt), { students: 2, average: 80, flagged: 1, lockedThenUnlocked: 1 });
  assert.deepEqual([8, 59.6, 65, 120, 3700].map(formatDuration), ['8s', '1m', '1m 5s', '2m', '1h 1m']);
});

test('500 events build a timeline quickly', () => {
  const events = [];
  for (let i = 0; i < 500; i++) events.push(ev(i % 5 === 0 ? 'question_changed' : 'copy_attempt', i, { q: { i: (i % 20) + 1, n: 20 } }));
  const start = performance.now();
  const { items } = buildTimeline(events);
  assert.equal(items.length, 500);
  assert.ok(performance.now() - start < 250, 'analysis + timeline for 500 events should take well under 250 ms');
});

test('a capped burst shows as one summary line, and does not change the score', () => {
  const events = [ev('session_start', 0), ev('paste_attempt', 5), ev('events_capped', 70, { data: { kind: 'paste_attempt', dropped: 40, seconds: 60 } })];
  const { items, analysis } = buildTimeline(events);
  const line = items.find((i) => i.title === 'Repeated events summarized');
  assert.match(line.detail, /^40 more paste attempt events/);
  assert.equal(analysis.score, 98); // only the one stored paste attempt counts
});
