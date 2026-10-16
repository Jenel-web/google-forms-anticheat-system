import { useEffect, useMemo, useRef, useState } from 'react';
import { mergeSettings } from '@shared/constants.js';
import { analyzeAttempt, heatLevel, questionHeat, scoreBand } from '@shared/integrity.js';
import { getTest, listAttempts, listTestEvents } from '../lib/api.js';
import { downloadCsv, toCsv } from '../lib/csv.js';
import { initials } from '../lib/format.js';
import { reconcile, readResponseEmails } from '../lib/reconcile.js';
import {
  ATTEMPT_COLUMNS, EVENT_COLUMNS, attemptRows, classSummary, eventRows, formatDuration, safeFilename,
} from '../lib/report.js';
import { Link } from '../router.jsx';
import { Avatar, Banner, Chip, Empty, Icon } from '../ui.jsx';

const COLS = '32px minmax(0,1fr) minmax(120px,1.2fr) 70px 110px';

function Reconciliation({ attempts }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const input = useRef(null);

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    setError('');
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text(); // read here; the file never leaves this browser
      const parsed = readResponseEmails(text);
      if (!parsed.found) {
        setError('We could not find an email column. In Google Forms turn on "Collect email addresses" (Settings), then download the responses CSV again.');
        return;
      }
      setResult(reconcile(attempts, parsed.emails));
    } catch {
      setError('That file could not be read. Download the responses as CSV from the Responses tab in Google Forms.');
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  return (
    <section className="cn-card" data-testid="reconcile">
      <div className="cn-card__head">
        <h2 className="cn-h2">Check responses against attempts</h2>
      </div>
      <p className="cn-sm cn-muted">
        In Google Forms open Responses, choose Download responses (.csv), and pick the file here. Only the email column is read, in your
        browser. Answers are never uploaded, and nothing is saved. A mismatch is a prompt to look closer, not proof of cheating.
      </p>
      <div className="dash-row" style={{ marginTop: 12 }}>
        <label className="cn-btn cn-btn--secondary" htmlFor="responses-csv" style={{ cursor: 'pointer' }}>
          <Icon name="file" />Choose responses CSV
        </label>
        <input id="responses-csv" ref={input} type="file" accept=".csv,text/csv" onChange={onFile} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} data-testid="responses-file" />
        {fileName ? <span className="cn-sm cn-muted">{fileName}</span> : null}
      </div>
      {error ? <div style={{ marginTop: 12 }}><Banner kind="danger" icon="alert">{error}</Banner></div> : null}
      {result ? (
        <div style={{ marginTop: 16 }} className="dash-stack">
          <p className="cn-sm" data-testid="reconcile-summary">
            {result.totalResponses} {result.totalResponses === 1 ? 'response' : 'responses'} in the file, {attempts.length}{' '}
            {attempts.length === 1 ? 'attempt' : 'attempts'} monitored.
          </p>
          <div className="dash-three">
            <ResultList testid="matched" tone="ok" icon="check-circle" title="Submitted and monitored" count={result.matched.length}
              empty="No matches.">
              {result.matched.map((m) => (
                <li key={m.attempt.id}>
                  <span>{m.attempt.student_name}<small className="dash-sub">{m.email}{m.responses > 1 ? ` · ${m.responses} responses` : ''}</small></span>
                  <Link to={`/tests/${m.attempt.test_id}/attempts/${m.attempt.id}`} className="dash-link cn-sm">Timeline</Link>
                </li>
              ))}
            </ResultList>
            <ResultList testid="no-attempt" tone="danger" icon="alert" title="Submitted with no monitored attempt" count={result.noAttempt.length}
              empty="Every response has a monitored attempt.">
              {result.noAttempt.map((m) => (
                <li key={m.email}>
                  <span>{m.email}{m.responses > 1 ? <small className="dash-sub">{m.responses} responses</small> : null}</span>
                </li>
              ))}
            </ResultList>
            <ResultList testid="no-submission" tone="warn" icon="clock" title="Monitored but no submission" count={result.noSubmission.length}
              empty="Every attempt has a response.">
              {result.noSubmission.map((m) => (
                <li key={m.attempt.id}>
                  <span>{m.attempt.student_name}<small className="dash-sub">{m.attempt.student_email}</small></span>
                  <Chip kind={m.attempt.status} />
                </li>
              ))}
            </ResultList>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ResultList({ testid, tone, icon, title, count, empty, children }) {
  return (
    <div className="cn-card cn-card--flush" data-testid={testid}>
      <div className="dash-row" style={{ padding: '16px 20px 12px' }}>
        <span className={`cn-dot cn-dot--${tone}`}><Icon name={icon} /></span>
        <b className="cn-h3">{title}</b>
        <span className="cn-chip cn-chip--ended" data-testid={`${testid}-count`}>{count}</span>
      </div>
      {count === 0 ? <p className="cn-muted cn-sm" style={{ padding: '0 20px 16px' }}>{empty}</p> : <ul className="dash-list">{children}</ul>}
    </div>
  );
}

export default function Report({ id }) {
  const [test, setTest] = useState(undefined);
  const [attempts, setAttempts] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await getTest(id);
        if (!alive) return;
        setTest(t);
        if (!t) return;
        const [a, e] = await Promise.all([listAttempts(id), listTestEvents(id)]);
        if (!alive) return;
        setAttempts(a);
        setEvents(e);
        setLoaded(true);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const eventsByAttempt = useMemo(() => {
    const map = new Map(attempts.map((a) => [a.id, []]));
    for (const e of events) (map.get(e.attempt_id) || []).push(e);
    return map;
  }, [attempts, events]);

  const analyses = useMemo(() => {
    const map = new Map();
    for (const a of attempts) map.set(a.id, analyzeAttempt(eventsByAttempt.get(a.id) || []));
    return map;
  }, [attempts, eventsByAttempt]);

  const ranked = useMemo(
    () => [...attempts].sort((a, b) => analyses.get(a.id).score - analyses.get(b.id).score || a.student_name.localeCompare(b.student_name)),
    [attempts, analyses],
  );
  const summary = useMemo(() => classSummary(attempts, analyses, eventsByAttempt), [attempts, analyses, eventsByAttempt]);
  const heat = useMemo(
    () => questionHeat(attempts.map((a) => ({ id: a.id, events: eventsByAttempt.get(a.id) || [] }))),
    [attempts, eventsByAttempt],
  );
  const heatMax = Math.max(0, ...heat.cells.map((c) => c.episodes));
  const gapStudents = attempts.filter((a) => analyses.get(a.id).gapFlag).length;

  if (error) return <Banner kind="danger" icon="alert">{error}</Banner>;
  if (test === undefined) return null;
  if (!test) {
    return (
      <div className="cn-card">
        <Empty icon="search" title="Test not found" action={<Link to="/" className="cn-btn cn-btn--secondary">Back to tests</Link>}>
          It may have been deleted, or it belongs to another account.
        </Empty>
      </div>
    );
  }
  const maxStrikes = mergeSettings(test.settings).maxStrikes;
  const base = safeFilename(test.title);

  return (
    <>
      <div className="cn-pagehead">
        <div className="cn-pagehead__t">
          <div className="dash-row" style={{ gap: 10 }}>
            <Chip kind={test.status} />
            <Link to={`/tests/${test.id}`} className="dash-link cn-sm">Back to the live monitor</Link>
          </div>
          <h1 className="cn-h1" data-testid="report-title">{test.title}</h1>
          <p className="cn-sm cn-muted">Report · up to {maxStrikes} strikes per student</p>
        </div>
        <div className="cn-actions">
          <button className="cn-btn cn-btn--secondary" type="button" disabled={!loaded} data-testid="csv-attempts"
            onClick={() => downloadCsv(`${base}-attempts.csv`, toCsv(ATTEMPT_COLUMNS, attemptRows(attempts, analyses)))}>
            <Icon name="download" />Attempts CSV
          </button>
          <button className="cn-btn cn-btn--secondary" type="button" disabled={!loaded} data-testid="csv-events"
            onClick={() => downloadCsv(`${base}-events.csv`, toCsv(EVENT_COLUMNS, eventRows(attempts, eventsByAttempt)))}>
            <Icon name="download" />Events CSV
          </button>
        </div>
      </div>

      <Banner kind="info" icon="info">
        The integrity score is a signal for your judgement, not a verdict. Every score can be traced back to the events behind it.
      </Banner>

      {loaded && attempts.length === 0 ? (
        <div className="cn-card">
          <Empty icon="users" title="No students yet" action={<Link to={`/tests/${test.id}`} className="cn-btn cn-btn--secondary">Back to the live monitor</Link>}>
            When students take the test, their scores and timelines show up here.
          </Empty>
        </div>
      ) : null}

      {attempts.length > 0 ? (
        <>
          <div className="cn-stats">
            <div className="cn-stat"><span className="cn-stat__n" data-testid="stat-students">{summary.students}</span><span className="cn-stat__l">Students</span></div>
            <div className="cn-stat"><span className="cn-stat__n" data-testid="stat-average">{summary.average}</span><span className="cn-stat__l">Average integrity</span></div>
            <div className="cn-stat"><span className="cn-stat__n" data-testid="stat-flagged">{summary.flagged}</span><span className="cn-stat__l">Flagged for review</span></div>
            <div className="cn-stat"><span className="cn-stat__n">{summary.lockedThenUnlocked}</span><span className="cn-stat__l">Locked, then unlocked</span></div>
          </div>

          <section className="cn-card cn-card--flush">
            <div className="cn-card__head" style={{ padding: '20px 24px 0', margin: 0 }}>
              <h2 className="cn-h2">Lowest integrity first</h2>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="cn-grow cn-grow--head" style={{ '--cols': COLS }}>
                <span>#</span><span>Student</span><span>Integrity</span><span /><span>Notes</span>
              </div>
              {ranked.map((a, i) => {
                const r = analyses.get(a.id);
                const band = scoreBand(r.score);
                return (
                  <div key={a.id} className="cn-grow" style={{ '--cols': COLS }} data-testid="report-row" data-score={r.score}>
                    <span className="cn-data">{i + 1}</span>
                    <div className="cn-grow__main">
                      <Avatar text={initials(a.student_name)} />
                      <span>
                        <Link to={`/tests/${test.id}/attempts/${a.id}`} className="dash-link">{a.student_name}</Link>
                        <small className="dash-sub">{r.strikes} {r.strikes === 1 ? 'strike' : 'strikes'}
                          {r.awaySeconds ? ` · ${formatDuration(r.awaySeconds)} away` : ''}</small>
                      </span>
                    </div>
                    <div className={`cn-bar ${band === 'mid' ? 'cn-bar--mid' : band === 'low' ? 'cn-bar--low' : ''}`} role="img" aria-label={`${r.score} of 100`}>
                      <i style={{ width: `${r.score}%` }} />
                    </div>
                    <b className="cn-data" style={{ fontSize: 14, textAlign: 'right' }} data-testid="score">{r.score}</b>
                    <span data-label="Notes">
                      {r.gapFlag ? <span className="cn-chip cn-chip--flag" title="Connection gaps add up to more than 2 minutes, or there are more than 3">
                        <Icon name="wifi-off" />Gaps</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="cn-card" data-testid="heatmap">
            <div className="cn-card__head">
              <h2 className="cn-h2">Where students left</h2>
              <div className="cn-legend">Fewer
                <i style={{ background: 'var(--surface-sky)' }} /><i style={{ background: 'var(--sky-200)' }} />
                <i style={{ background: 'var(--sky-300)' }} /><i style={{ background: 'var(--brand-strong)' }} />
                <i style={{ background: 'var(--ink)' }} />More leave episodes</div>
            </div>
            {heat.cells.length === 0 ? <p className="cn-muted cn-sm">Question numbers were not recorded for this test.</p> : (
              <div className="cn-heat" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(68px, 1fr))' }}>
                {heat.cells.map((c) => (
                  <div key={c.q} className="cn-heat__c" data-l={heatLevel(c.episodes, heatMax)} data-q={c.q} data-episodes={c.episodes} data-seconds={c.awaySeconds}
                    title={`Q${c.q}: ${c.episodes} leave ${c.episodes === 1 ? 'episode' : 'episodes'}, ${c.awaySeconds}s away, ${c.students} ${c.students === 1 ? 'student' : 'students'}`}>
                    <span>{c.episodes}</span><small>Q{c.q}{c.awaySeconds ? ` · ${c.awaySeconds}s` : ''}</small>
                  </div>
                ))}
              </div>
            )}
            <p className="dash-note" style={{ marginTop: 12 }}>
              The number is how many times students left the exam tab while on that question; the small text is the total time away.
              {heat.unknown ? ` ${heat.unknown} ${heat.unknown === 1 ? 'episode' : 'episodes'} happened before a question was known.` : ''}
            </p>
          </section>

          {gapStudents ? (
            <Banner kind="warn" icon="wifi-off">
              {gapStudents} {gapStudents === 1 ? 'student has' : 'students have'} connection gaps worth a look (more than 2 minutes in total, or more than 3).
              Gaps are unverified and never lower the score. They can hide offline material such as notes.
            </Banner>
          ) : null}
        </>
      ) : null}

      {loaded ? <Reconciliation attempts={attempts} /> : null}
    </>
  );
}
