import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeSettings } from '@shared/constants.js';
import { supabase } from '../supabase.js';
import { alertEvents, deleteTest, endTest, getTest, listAttempts, unlock } from '../lib/api.js';
import {
  ALERT_TYPES, countByFilter, initials, isFinal, rowStatus, stillWorking, timeAgo,
} from '../lib/format.js';
import { feedSince, mergeAlerts, newFeedState } from '../lib/feed.js';
import { Link, navigate } from '../router.jsx';
import { Avatar, Banner, Chip, Empty, Icon, Modal, Pips } from '../ui.jsx';

const COLS = 'minmax(0,1fr) 150px 96px 110px 84px 96px';
const POLL_MS = 5000;
// "Unlock sent" is shown for this long; a student still locked after it can be unlocked again (a dropped connection can lose one).
const UNLOCK_SENT_MS = 15000;
const FILTERS = [
  ['all', 'All'], ['active', 'Active'], ['away', 'Away'], ['warned', 'Warned'], ['locked', 'Locked'],
  ['submitted', 'Submitted'], ['closed', 'Closed'], ['noheartbeat', 'No heartbeat'],
];
const TONE_ICON = { danger: ['danger', 'lock'], warn: ['warn', 'alert'], ok: ['ok', 'check'], info: ['info', 'info'] };
const TONE_ICON_FALLBACK = 'alert';

function EndDialog({ working, busy, error, onClose, onConfirm }) {
  const [ack, setAck] = useState(false);
  return (
    <Modal title="End this test?" eyebrow="Two steps" icon="alert" tone="warn" onClose={onClose}
      actions={(
        <>
          <button className="cn-btn cn-btn--danger cn-btn--lg" type="button" disabled={!ack || busy} onClick={onConfirm}>
            {busy ? 'Ending…' : 'End test'}
          </button>
          <button className="cn-btn cn-btn--secondary cn-btn--lg" type="button" onClick={onClose}>Keep going</button>
        </>
      )}>
      <p className="cn-lead">
        <b>1.</b> In Google Forms, open your form, go to Responses and turn off <b>Accepting responses</b>. Otherwise students
        can still submit.
      </p>
      <label className="cn-checkrow" htmlFor="ack-closed">
        <input id="ack-closed" type="checkbox" className="cn-checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>I turned off Accepting responses in Google Forms.</span>
      </label>
      <p className="cn-lead"><b>2.</b> Ending closes every unfinished attempt. Students see a closed screen within about 5 seconds.</p>
      <Banner kind="warn" icon="alert">
        <span data-testid="still-working"><b>{working}</b> {working === 1 ? 'student is' : 'students are'} still working.</span>{' '}
        Unsubmitted answers will be lost: Google Forms does not save partial answers.
      </Banner>
      {error ? <Banner kind="danger" icon="alert">{error}</Banner> : null}
    </Modal>
  );
}

export default function Monitor({ initialTest }) {
  const [test, setTest] = useState(initialTest);
  const [attempts, setAttempts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [feed, setFeed] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState('all');
  const [offline, setOffline] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [dialog, setDialog] = useState(null); // 'end' | 'delete'
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [sent, setSent] = useState({});
  const [notice, setNotice] = useState('');
  const known = useRef(new Map()); // attempt id -> attempt, used to name people in the feed
  const feedState = useRef(newFeedState());
  const refreshTimer = useRef(null);

  const live = test.status === 'live';
  const maxStrikes = mergeSettings(test.settings).maxStrikes;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const pushFeed = useCallback((entries) => {
    setFeed((prev) => {
      const merged = [...entries.filter((e) => !prev.some((p) => p.id === e.id)), ...prev];
      return merged.slice(0, 50);
    });
  }, []);

  const reload = useCallback(async () => {
    try {
      const rows = await listAttempts(test.id);
      rows.forEach((a) => known.current.set(a.id, a));
      setAttempts(rows);
      setLoaded(true);
      setOffline(false);
      setLastUpdate(new Date());
      const alerts = await alertEvents(test.id, ALERT_TYPES, feedSince(feedState.current));
      const entries = mergeAlerts(alerts, feedState.current, (id) => known.current.get(id)?.student_name || 'A student');
      if (entries.length) pushFeed(entries);
    } catch {
      setOffline(true);
    }
  }, [test.id, pushFeed]);

  useEffect(() => {
    reload();
    const poll = setInterval(reload, POLL_MS);
    return () => clearInterval(poll);
  }, [reload]);

  // A status change arriving over Realtime means something worth a feed line probably just happened: refresh now
  // instead of waiting for the next 5 s poll.
  const refreshSoon = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(reload, 700);
  }, [reload]);

  useEffect(() => {
    const channel = supabase.channel(`monitor-${test.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempts', filter: `test_id=eq.${test.id}` }, (payload) => {
        const row = payload.new;
        if (!row || !row.id) return;
        const before = known.current.get(row.id);
        known.current.set(row.id, { ...(before || {}), ...row });
        if (!before || before.status !== row.status || before.strikes !== row.strikes) refreshSoon();
        setAttempts((prev) => {
          const i = prev.findIndex((a) => a.id === row.id);
          if (i < 0) return [...prev, row];
          const next = [...prev];
          next[i] = { ...prev[i], ...row };
          return next;
        });
        setLastUpdate(new Date());
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); clearTimeout(refreshTimer.current); };
  }, [test.id, refreshSoon]);

  // an "Unlock sent" label lasts only while the attempt is still locked
  useEffect(() => {
    setSent((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const a of attempts) if (next[a.id] && a.status !== 'locked') { delete next[a.id]; changed = true; }
      return changed ? next : prev;
    });
  }, [attempts]);

  async function doUnlock(attempt) {
    setNotice('');
    try {
      await unlock(attempt.id);
      setSent((s) => ({ ...s, [attempt.id]: Date.now() }));
    } catch (e) {
      setNotice(e.message);
    }
  }

  async function confirmEnd() {
    setDialogBusy(true);
    setDialogError('');
    try {
      const res = await endTest(test.id);
      setTest(await getTest(test.id));
      await reload();
      setDialog(null);
      setNotice(`The test has ended. ${res.closed} unfinished ${res.closed === 1 ? 'attempt was' : 'attempts were'} closed.`);
    } catch (e) {
      setDialogError(e.message);
    } finally {
      setDialogBusy(false);
    }
  }

  async function confirmDelete() {
    setDialogBusy(true);
    try {
      await deleteTest(test.id);
      navigate('/');
    } catch (e) {
      setDialogError(e.message);
      setDialogBusy(false);
    }
  }

  const counts = countByFilter(attempts, now);
  const shown = attempts.filter((a) => {
    if (filter === 'all') return true;
    const k = rowStatus(a, now);
    return k === filter || (filter === 'closed' && k === 'abandoned');
  });

  return (
    <>
      <div className="cn-pagehead">
        <div className="cn-pagehead__t">
          <div className="dash-row" style={{ gap: 10 }}>
            <Chip kind={test.status} />
            <Link to="/" className="dash-link cn-sm">All tests</Link>
          </div>
          <h1 className="cn-h1" data-testid="test-title">{test.title}</h1>
          <p className="cn-sm cn-muted">
            <span data-testid="student-count">{attempts.length} {attempts.length === 1 ? 'student' : 'students'}</span>
            {live ? <> · <span data-testid="working-count">{stillWorking(attempts)} still working</span></> : null}
            {' · '}<a href={test.form_url} className="dash-link" target="_blank" rel="noreferrer">Student link</a>
          </p>
        </div>
        <div className="cn-actions">
          <Link to={`/tests/${test.id}/report`} className="cn-btn cn-btn--secondary" data-testid="open-report"><Icon name="chart" />Report</Link>
          {live ? (
            <button className="cn-btn cn-btn--danger" type="button" onClick={() => { setDialogError(''); setDialog('end'); }}>End test…</button>
          ) : null}
          {test.status === 'ended' ? (
            <button className="cn-btn cn-btn--secondary" type="button" onClick={() => { setDialogError(''); setDialog('delete'); }}>
              <Icon name="trash" />Delete data
            </button>
          ) : null}
        </div>
      </div>

      {offline ? (
        <Banner kind="warn" icon="wifi-off">
          You are offline. Showing the last update from {lastUpdate ? lastUpdate.toLocaleTimeString() : 'earlier'}. We will reconnect on our own.
        </Banner>
      ) : null}
      {notice ? <Banner kind="info" icon="info">{notice}</Banner> : null}
      {test.status === 'ended' ? (
        <Banner kind="info" icon="clock">
          This test has ended. Student data is kept for 180 days after the test ends, or until you delete it.
        </Banner>
      ) : null}

      <div className="cn-scrollx" role="tablist" aria-label="Filter by status">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} className={`cn-pill ${filter === key ? 'is-on' : ''}`}
            onClick={() => setFilter(key)} data-testid={`filter-${key}`}>{label}<span className="n">{counts[key]}</span></button>
        ))}
      </div>

      <div className="cn-split--lg">
        <div className={`cn-card cn-card--flush ${offline ? 'dash-offline' : ''}`}>
          {loaded && attempts.length === 0 ? (
            <Empty icon="users" title="Waiting for students">
              No one has joined yet. Share the student link so they can open the exam with the extension installed.
            </Empty>
          ) : (
            <div>
              <div className="cn-grow cn-grow--head" style={{ '--cols': COLS }}>
                <span>Student</span><span>Status</span><span>Strikes</span><span>Question</span><span>Last seen</span><span />
              </div>
              {shown.map((a) => {
                const status = rowStatus(a, now);
                const canUnlock = live && a.status === 'locked' && status === 'locked';
                return (
                  <div key={a.id} className={`cn-grow ${a.status === 'locked' ? 'is-attn' : ''}`} style={{ '--cols': COLS }}
                    data-testid="attempt-row" data-status={status} data-strikes={a.strikes}>
                    <div className="cn-grow__main">
                      <Avatar text={initials(a.student_name)} />
                      <span>
                        <Link to={`/tests/${test.id}/attempts/${a.id}`} className="dash-link">{a.student_name}</Link>
                        <small className="dash-sub">{a.student_email} · {a.verified
                          ? <span className="dash-verified">✓ verified</span> : <span className="dash-unverified">unverified</span>}</small>
                      </span>
                    </div>
                    <span data-label="Status" data-testid="status"><Chip kind={status} /></span>
                    <span data-label="Strikes"><Pips used={a.strikes} max={maxStrikes} /></span>
                    <span data-label="Question" className="cn-data">{a.current_q ? `Q${a.current_q.i} of ${a.current_q.n}` : '–'}</span>
                    <span data-label="Last seen" className="cn-data">{isFinal(a.status) ? '–' : timeAgo(now - Date.parse(a.last_heartbeat))}</span>
                    <span>
                      {canUnlock ? (
                        sent[a.id] && now - sent[a.id] < UNLOCK_SENT_MS
                          ? <span className="cn-sm cn-muted">Unlock sent</span>
                          : <button className="cn-btn cn-btn--primary cn-btn--sm" type="button" onClick={() => doUnlock(a)}><Icon name="unlock" />Unlock</button>
                      ) : null}
                    </span>
                  </div>
                );
              })}
              {loaded && shown.length === 0 ? <p className="cn-muted" style={{ padding: 24 }}>No students in this view.</p> : null}
            </div>
          )}
        </div>

        <div className="cn-card">
          <h2 className="cn-h3">Alerts</h2>
          {feed.length === 0 ? <p className="cn-muted cn-sm">Nothing to report yet.</p> : (
            <ul className="cn-feed" data-testid="feed">
              {feed.map((f) => {
                const [cls, icon] = TONE_ICON[f.tone] || ['info', TONE_ICON_FALLBACK];
                return (
                  <li key={f.id}>
                    <span className={`cn-dot cn-dot--${cls}`}><Icon name={icon} /></span>
                    <span>{f.text}<time>{new Date(f.t).toLocaleTimeString()}</time></span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {dialog === 'end' ? (
        <EndDialog working={stillWorking(attempts)} busy={dialogBusy} error={dialogError} onClose={() => setDialog(null)} onConfirm={confirmEnd} />
      ) : null}
      {dialog === 'delete' ? (
        <Modal title="Delete this test and its student data?" icon="trash" tone="danger" onClose={() => setDialog(null)}
          actions={(
            <>
              <button className="cn-btn cn-btn--danger cn-btn--lg" type="button" disabled={dialogBusy} onClick={confirmDelete}>Delete everything</button>
              <button className="cn-btn cn-btn--secondary cn-btn--lg" type="button" onClick={() => setDialog(null)}>Keep it</button>
            </>
          )}>
          <p className="cn-lead">All attempts and events for this test are removed. This cannot be undone.</p>
          {dialogError ? <Banner kind="danger" icon="alert">{dialogError}</Banner> : null}
        </Modal>
      ) : null}
    </>
  );
}
