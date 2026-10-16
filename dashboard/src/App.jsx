import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { Link, navigate, usePath } from './router.jsx';
import { Avatar, Icon, Logo } from './ui.jsx';
import Auth from './pages/Auth.jsx';
import TestsList from './pages/TestsList.jsx';
import TestPage from './pages/TestPage.jsx';

// Students are anonymous Supabase users. They must never be treated as a teacher (CLAUDE.md invariant).
const isTeacher = (session) => !!session && !session.user.is_anonymous;

function Shell({ session, children }) {
  const email = session.user.email || '';
  const path = usePath();
  return (
    <div className="cn-app">
      <aside className="cn-side">
        <Logo small />
        <nav className="cn-nav" aria-label="Main">
          <Link to="/" aria-current={path === '/' || path.startsWith('/tests') ? 'page' : undefined}>
            <Icon name="list" />Tests
          </Link>
        </nav>
        <div className="cn-side__foot">
          <Avatar text={(email[0] || '?').toUpperCase()} />
          <span><b>Teacher</b>{email}</span>
          <button className="cn-btn cn-btn--ghost cn-btn--sm" type="button" aria-label="Sign out"
            onClick={() => supabase.auth.signOut()}><Icon name="logout" /></button>
        </div>
      </aside>
      <div style={{ display: 'contents' }}>
        <div className="cn-mtop">
          <Logo small />
          <button className="cn-btn cn-btn--ghost cn-btn--sm" type="button" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
        <main className="cn-main">{children}</main>
      </div>
    </div>
  );
}

function Routes() {
  const path = usePath();
  if (path === '/tests/new') return <TestPage id={null} />;
  const m = path.match(/^\/tests\/([0-9a-f-]{36})\/?$/i);
  if (m) return <TestPage id={m[1]} key={m[1]} />;
  if (path !== '/') navigate('/', { replace: true });
  return <TestsList />;
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session && session.user.is_anonymous) supabase.auth.signOut();
  }, [session]);

  if (session === undefined) return null;
  if (recovery || !isTeacher(session)) return <Auth recovery={recovery} />;
  return <Shell session={session}><Routes /></Shell>;
}
