import { useEffect, useMemo, useState } from 'react';
import { listAttemptSummaries, listTests } from '../lib/api.js';
import { isFlagged } from '../lib/format.js';
import { Link, navigate } from '../router.jsx';
import { Banner, Chip, Empty, Icon } from '../ui.jsx';

const COLS = 'minmax(0,1fr) 120px 100px 80px 24px';
const ORDER = { live: 0, draft: 1, ended: 2 };

export default function TestsList() {
  const [tests, setTests] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([listTests(), listAttemptSummaries()])
      .then(([t, a]) => { if (alive) { setTests(t); setAttempts(a); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => {
    const byTest = new Map();
    for (const a of attempts) {
      const row = byTest.get(a.test_id) || { students: 0, flags: 0 };
      row.students += 1;
      if (isFlagged(a)) row.flags += 1;
      byTest.set(a.test_id, row);
    }
    return (tests || [])
      .filter((t) => t.title.toLowerCase().includes(query.trim().toLowerCase()))
      .map((t) => ({ ...t, ...(byTest.get(t.id) || { students: 0, flags: 0 }) }))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.created_at.localeCompare(a.created_at));
  }, [tests, attempts, query]);

  const live = (tests || []).filter((t) => t.status === 'live').length;
  const flags = attempts.filter(isFlagged).length;

  return (
    <>
      <div className="cn-pagehead">
        <div className="cn-pagehead__t">
          <h1 className="cn-h1">Tests</h1>
          <p className="cn-muted cn-sm">Protect a Google Form, watch it live, review it after.</p>
        </div>
        <div className="cn-actions">
          <div className="cn-inwrap cn-dtop cn-search">
            <Icon name="search" />
            <input className="cn-input" placeholder="Search tests" aria-label="Search tests" value={query}
              onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="cn-btn cn-btn--primary" type="button" onClick={() => navigate('/tests/new')}>
            <Icon name="plus" />Add test
          </button>
        </div>
      </div>

      {error ? <Banner kind="danger" icon="alert">{error}</Banner> : null}

      {tests && tests.length === 0 ? (
        <div className="cn-card">
          <Empty icon="shield" title="No tests yet"
            action={<button className="cn-btn cn-btn--primary" type="button" onClick={() => navigate('/tests/new')}><Icon name="plus" />Add your first test</button>}>
            Paste a Google Form link to protect your first exam. It takes about a minute.
          </Empty>
        </div>
      ) : null}

      {tests && tests.length > 0 ? (
        <>
          <div className="cn-stats">
            <div className="cn-stat"><span className="cn-stat__n">{live}</span><span className="cn-stat__l">Live now</span></div>
            <div className="cn-stat"><span className="cn-stat__n">{attempts.length}</span><span className="cn-stat__l">Students so far</span></div>
            <div className="cn-stat"><span className="cn-stat__n">{flags}</span><span className="cn-stat__l">Open flags</span></div>
          </div>
          <div className="cn-card cn-card--flush">
            <div>
              <div className="cn-grow cn-grow--head" style={{ '--cols': COLS }}>
                <span>Test</span><span>Status</span><span>Students</span><span>Flags</span><span />
              </div>
              {rows.map((t) => (
                <Link key={t.id} to={`/tests/${t.id}`} className="cn-grow" style={{ '--cols': COLS, color: 'inherit', textDecoration: 'none' }}
                  data-testid="test-row">
                  <div className="cn-grow__main">
                    <span className="cn-dot cn-dot--info"><Icon name="file" /></span>
                    <span>{t.title}<small>{new Date(t.created_at).toLocaleDateString()}</small></span>
                  </div>
                  <span data-label="Status"><Chip kind={t.status} /></span>
                  <span data-label="Students" className="cn-data" style={{ fontSize: 15 }}>{t.students}</span>
                  <span data-label="Flags">
                    {t.flags ? <span className="cn-chip cn-chip--flag"><Icon name="flag" />{t.flags}</span> : <span className="cn-muted">–</span>}
                  </span>
                  <span className="cn-muted" style={{ justifySelf: 'end' }}><Icon name="chevron-right" /></span>
                </Link>
              ))}
              {rows.length === 0 ? <p className="cn-muted" style={{ padding: 24 }}>No tests match "{query}".</p> : null}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
