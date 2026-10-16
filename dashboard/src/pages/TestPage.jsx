import { useEffect, useState } from 'react';
import { getTest } from '../lib/api.js';
import { Link } from '../router.jsx';
import { Banner, Empty } from '../ui.jsx';
import Editor from './Editor.jsx';
import Monitor from './Monitor.jsx';

// /tests/new -> editor; /tests/:id -> editor while the test is a draft, otherwise the live monitor.
export default function TestPage({ id }) {
  const [test, setTest] = useState(id ? undefined : null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    getTest(id).then((t) => { if (alive) setTest(t); }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [id]);

  if (error) return <Banner kind="danger" icon="alert">{error}</Banner>;
  if (test === undefined) return null;
  if (id && !test) {
    return (
      <div className="cn-card">
        <Empty icon="search" title="Test not found" action={<Link to="/" className="cn-btn cn-btn--secondary">Back to tests</Link>}>
          It may have been deleted, or it belongs to another account.
        </Empty>
      </div>
    );
  }
  if (!test || test.status === 'draft') return <Editor test={test} onLive={setTest} />;
  return <Monitor initialTest={test} />;
}
