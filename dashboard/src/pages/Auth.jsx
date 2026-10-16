import { useState } from 'react';
import { supabase } from '../supabase.js';
import { Banner, Logo } from '../ui.jsx';

const MIN_PASSWORD = 8;

function friendly(error) {
  const m = String(error?.message || '');
  if (/email not confirmed/i.test(m)) return 'Confirm your email first. Open the link we sent you, then sign in.';
  if (/invalid login credentials/i.test(m)) return 'That email and password do not match. Check them and try again.';
  if (/already registered/i.test(m)) return 'An account with this email already exists. Sign in instead.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/failed to fetch|network/i.test(m)) return "Can't reach the server. Check your connection and try again.";
  return m || 'Something went wrong. Try again.';
}

export default function Auth({ recovery }) {
  const [mode, setMode] = useState(recovery ? 'recovery' : 'signin'); // signin | signup | forgot | recovery
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const switchMode = (m) => { setMode(m); setError(''); setNotice(''); };

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (mode !== 'recovery' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError('Enter a valid email address.');
    if ((mode === 'signup' || mode === 'recovery') && password.length < MIN_PASSWORD) {
      return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
      } else if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(), password, options: { emailRedirectTo: window.location.origin },
        });
        if (err) throw err;
        if (!data.session) setNotice(`We sent a confirmation link to ${email.trim()}. Open it, then sign in here.`);
      } else if (mode === 'forgot') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (err) throw err;
        setNotice(`If an account exists for ${email.trim()}, a reset link is on its way.`);
      } else if (mode === 'recovery') {
        const { error: err } = await supabase.auth.updateUser({ password });
        if (err) throw err;
        window.location.assign('/');
      }
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  const titles = {
    signin: ['Welcome, teacher', 'Sign in to protect a Google Form and watch it live.'],
    signup: ['Create your account', 'Use your school email. We will send a link to confirm it.'],
    forgot: ['Reset your password', 'Enter your email and we will send you a reset link.'],
    recovery: ['Choose a new password', 'Pick a password you have not used elsewhere.'],
  };
  const [title, lead] = titles[mode];
  const cta = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', recovery: 'Save password' }[mode];

  return (
    <div className="cn-auth">
      <section className="cn-auth__brand">
        <Logo />
        <div className="cn-hero">
          <h1 className="cn-h-display">Fair exams, calmly kept.</h1>
          <p className="cn-lead" style={{ color: 'var(--ink)' }}>
            We watch the exam, not the student. Clear rules, honest strikes, and a record you can trust.
          </p>
        </div>
      </section>
      <section className="cn-auth__form">
        <div>
          <h2 className="cn-h1">{title}</h2>
          <p className="cn-muted" style={{ marginTop: 6 }}>{lead}</p>
        </div>
        <form onSubmit={submit} style={{ display: 'grid', gap: 16, width: '100%' }} noValidate>
          {mode !== 'recovery' && (
            <div className="cn-field">
              <label className="cn-label" htmlFor="email">Email</label>
              <input id="email" className="cn-input" type="email" autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" />
            </div>
          )}
          {mode !== 'forgot' && (
            <div className="cn-field">
              <label className="cn-label" htmlFor="password">{mode === 'recovery' ? 'New password' : 'Password'}</label>
              <input id="password" className="cn-input" type="password" value={password}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                onChange={(e) => setPassword(e.target.value)} />
              {mode === 'signup' || mode === 'recovery'
                ? <p className="cn-hint">At least {MIN_PASSWORD} characters.</p> : null}
            </div>
          )}
          {error ? <Banner kind="danger" icon="alert">{error}</Banner> : null}
          {notice ? <Banner kind="ok" icon="send">{notice}</Banner> : null}
          <button className="cn-btn cn-btn--primary cn-btn--lg cn-btn--block" type="submit" disabled={busy}>{busy ? 'One moment…' : cta}</button>
        </form>
        {mode === 'signin' && (
          <p className="cn-sm cn-muted">
            New here? <a href="#signup" onClick={(e) => { e.preventDefault(); switchMode('signup'); }} style={{ color: 'var(--brand-strong)', fontWeight: 600 }}>Create an account</a>
            {' · '}
            <a href="#forgot" onClick={(e) => { e.preventDefault(); switchMode('forgot'); }} style={{ color: 'var(--brand-strong)', fontWeight: 600 }}>Forgot password</a>
          </p>
        )}
        {(mode === 'signup' || mode === 'forgot') && (
          <p className="cn-sm cn-muted">
            <a href="#signin" onClick={(e) => { e.preventDefault(); switchMode('signin'); }} style={{ color: 'var(--brand-strong)', fontWeight: 600 }}>Back to sign in</a>
          </p>
        )}
        <hr className="cn-divider" style={{ width: '100%' }} />
        <p className="cn-sm cn-muted">Student? You do not need an account. Install the extension and open your exam link.</p>
      </section>
    </div>
  );
}
