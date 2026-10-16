import { useEffect, useMemo, useState } from 'react';
import { mergeSettings } from '@shared/constants.js';
import { scoreBand } from '@shared/integrity.js';
import { getTest, listAttemptEvents, listAttempts } from '../lib/api.js';
import { downloadCsv, toCsv } from '../lib/csv.js';
import { initials } from '../lib/format.js';
import { EVENT_COLUMNS, buildTimeline, clockTime, eventRows, formatDuration, safeFilename } from '../lib/report.js';
import { Link } from '../router.jsx';
import { Avatar, Banner, Chip, Empty, Icon } from '../ui.jsx';

const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;
const BAND_COLOR = { ok: 'var(--success)', mid: 'var(--amber)', low: 'var(--danger)' };

function Ring({ score }) {
  const band = scoreBand(score);
  return (
    <div className="cn-ring" role="img" aria-label={`Integrity score ${score} out of 100`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={RING_R} fill="none" stroke="var(--surface-sky)" strokeWidth="10" />
        <circle cx="50" cy="50" r={RING_R} fill="none" stroke={BAND_COLOR[band]} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - score / 100)} />
      </svg>
      <div className="cn-ring__n"><span data-testid="ring-score">{score}<small>of 100</small></span></div>
    </div>
  );
}

function pointsText(label, p, unit) {
  if (!p.points) return null;
  return <li key={label}><b>−{Math.round(p.points * 10) / 10}</b> {label}{unit ? ` (${unit})` : ''}</li>;
}

export default function Timeline({ testId, attemptId }) {
  const [test, setTest] = useState(undefined);
  const [attempt, setAttempt] = useState(undefined);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await getTest(testId);
        const attempts = t ? await listAttempts(testId) : [];
        if (!alive) return;
        setTest(t);
        const a = attempts.find((x) => x.id === attemptId) || null;
        setAttempt(a);
        if (a) setEvents(await listAttemptEvents(attemptId));
        if (alive) setLoaded(true);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => { alive = false; };
  }, [testId, attemptId]);

  const maxStrikes = test ? mergeSettings(test.settings).maxStrikes : 3;
  const { items, analysis } = useMemo(() => buildTimeline(events, maxStrikes), [events, maxStrikes]);
  const shown = showAll ? items : items.filter((i) => !i.minor);
  const hidden = items.length - shown.length;

  if (error) return <Banner kind="danger" icon="alert">{error}</Banner>;
  if (test === undefined || attempt === undefined) return null;
  if (!test || !attempt) {
    return (
      <div className="cn-card">
        <Empty icon="search" title="Student not found" action={<Link to={`/tests/${testId}/report`} className="cn-btn cn-btn--secondary">Back to the report</Link>}>
          This attempt may have been deleted, or it belongs to another account.
        </Empty>
      </div>
    );
  }

  const score = analysis.score;
  const penalties = analysis.penalties;
  const lines = [
    pointsText('for strikes', penalties.strikes, `${penalties.strikes.count} × 10`),
    pointsText('for time away', penalties.away, `${formatDuration(penalties.away.seconds)}, up to 30`),
    pointsText('for blocked sites', penalties.blockedSite, `${penalties.blockedSite.count} × 15`),
    pointsText('for quick returns to another question', penalties.suspiciousReturn, `${penalties.suspiciousReturn.count} × 5`),
    pointsText('for copy, paste or devtools attempts', penalties.clipboard, `${penalties.clipboard.count} × 2, up to 10`),
  ].filter(Boolean);

  return (
    <>
      <div className="cn-pagehead">
        <div className="cn-pagehead__t">
          <Link to={`/tests/${test.id}/report`} className="cn-sm dash-link" style={{ textDecoration: 'none' }}>← {test.title}</Link>
          <div className="dash-row" style={{ gap: 12 }}>
            <Avatar text={initials(attempt.student_name)} />
            <div>
              <h1 className="cn-h1" data-testid="student-name">{attempt.student_name}</h1>
              <p className="cn-sm cn-muted">{attempt.student_email} · {attempt.verified
                ? <span className="dash-verified">✓ verified</span> : <span className="dash-unverified">unverified</span>}</p>
            </div>
          </div>
        </div>
        <div className="cn-actions">
          <Chip kind={attempt.status} />
        </div>
      </div>

      <div className="cn-stats" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
        <div className="cn-stat" style={{ gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 16 }}>
          <Ring score={score} />
          <div>
            <b className="cn-h3">Integrity score</b>
            <p className="cn-sm cn-muted">Lower means more flagged events. A signal for your judgement, not a verdict.</p>
          </div>
        </div>
        <div className="cn-stat" style={{ gap: 8 }}>
          <b className="cn-h3">How the score was worked out</b>
          {lines.length ? <ul className="dash-pen" data-testid="penalties">{lines}</ul> : <p className="cn-sm cn-muted">Nothing was subtracted: 100.</p>}
        </div>
        <div className="cn-stat" style={{ gap: 8 }}>
          <span className={`cn-chip ${analysis.gapFlag ? 'cn-chip--flag' : 'cn-chip--ended'}`} style={{ justifySelf: 'start' }}>
            <Icon name="wifi-off" />Connection gaps (unverified)
          </span>
          <b className="cn-h3" data-testid="gap-summary">
            {analysis.gaps.length ? `${analysis.gaps.length} ${analysis.gaps.length === 1 ? 'gap' : 'gaps'}, ${formatDuration(analysis.gapSeconds)} in total` : 'None'}
          </b>
          <p className="cn-sm cn-muted">Shown for context. Gaps are never subtracted from the score.</p>
        </div>
      </div>

      <section className="cn-card">
        <div className="cn-card__head">
          <h2 className="cn-h2">Timeline</h2>
          <div className="dash-row">
            <button className="cn-btn cn-btn--ghost cn-btn--sm" type="button" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)} data-testid="toggle-all">
              {showAll ? 'Hide minor events' : `Show every event${hidden ? ` (${hidden} more)` : ''}`}
            </button>
            <button className="cn-btn cn-btn--secondary cn-btn--sm" type="button" disabled={!loaded}
              onClick={() => downloadCsv(`${safeFilename(attempt.student_name)}-events.csv`,
                toCsv(EVENT_COLUMNS, eventRows([attempt], new Map([[attempt.id, events]]))))}>
              <Icon name="download" />Export
            </button>
          </div>
        </div>
        {shown.length === 0 ? <p className="cn-muted">No events recorded for this student.</p> : (
          <ol className="cn-tl" data-testid="timeline">
            {shown.map((it) => (
              <li key={it.key} className="cn-tl__item dash-tl-item" data-type={it.title}>
                <span className="cn-tl__time">{clockTime(it.t)}</span>
                <span className="cn-tl__rail"><span className={`cn-dot cn-dot--${it.tone}`}><Icon name={it.icon} /></span></span>
                <div className="cn-tl__body">
                  <span className="cn-tl__t">{clockTime(it.t)}</span>
                  <b>{it.title}</b>
                  {it.detail ? <span className="cn-sm cn-muted">{it.detail}</span> : null}
                  {it.q || it.domain || (it.domains && it.domains.length) ? (
                    <span className="cn-tl__meta">
                      {it.q ? <span className="cn-q">Q{it.q.i}</span> : null}
                      {it.domain ? <span className="cn-domain">{it.domain}</span> : null}
                      {(it.domains || []).map((d) => <span key={d} className="cn-domain">{d}</span>)}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
