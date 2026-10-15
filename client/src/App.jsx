import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Battle from './pages/Battle.jsx';
import Bestiary from './pages/Bestiary.jsx';
import Encounters from './pages/Encounters.jsx';
import Shop from './pages/Shop.jsx';
import Party from './pages/Party.jsx';
import Reference from './pages/Reference.jsx';
import Account from './pages/Account.jsx';
import Admin from './pages/Admin.jsx';
import Privacy from './pages/Privacy.jsx';
import Feedback from './pages/Feedback.jsx';
import Help from './pages/Help.jsx';

const TABS = [
  ['battle', 'Battle'],
  ['bestiary', 'Bestiary'],
  ['encounters', 'Encounters'],
  ['shop', 'Magic Shop'],
  ['party', 'Party'],
  ['reference', 'XP Tables'],
  ['feedback', 'Feedback'],
  ['account', 'Account'],
];

function useHashTab() {
  const read = () => window.location.hash.slice(1) || 'battle';
  const [tab, setTab] = useState(read);
  useEffect(() => {
    const on = () => setTab(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return tab;
}

export default function App() {
  const [me, setMe] = useState(null);
  const [state, setState] = useState(null);
  const [saveError, setSaveError] = useState('');
  const timers = useRef({});
  const tab = useHashTab();

  const load = useCallback(async () => {
    const m = await api.me();
    setMe(m);
    setState(m.user ? await api.state() : null);
  }, []);

  useEffect(() => {
    load().catch((e) => setSaveError(e.message));
  }, [load]);

  // Update one top-level collection locally, then save it shortly after.
  const update = useCallback((key, fn) => {
    setState((s) => {
      const value = typeof fn === 'function' ? fn(s[key]) : fn;
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => {
        api.put(key, value).then(() => setSaveError('')).catch((e) => setSaveError(`Not saved: ${e.message}`));
      }, 250);
      return { ...s, [key]: value };
    });
  }, []);

  // The privacy policy is public, so it shows whether or not anyone is logged in.
  if (window.location.pathname === '/privacy') return <Privacy />;
  if (!me) return <div className="center muted">Loading…</div>;
  const resetToken = window.location.pathname === '/reset' ? new URLSearchParams(window.location.search).get('token') : null;
  if (resetToken) return <Reset token={resetToken} />;
  if (!me.user) return <Auth firstAccount={me.firstAccount} google={me.google} onDone={load} />;
  if (!state) return <div className="center muted">Loading…</div>;

  const props = { state, update };
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">DM Screen</div>
        <nav>
          {[...TABS, ...(me.user.admin ? [['admin', 'Admin']] : [])].map(([id, label]) => (
            <a key={id} href={`#${id}`} className={tab === id ? 'active' : ''}>{label}</a>
          ))}
        </nav>
        <div className="topbar-right">
          <a href="#help" className={`help-btn ${tab === 'help' ? 'active' : ''}`} title="Getting started" aria-label="Getting started">?</a>
          <a href={`/p/${me.user.slug}`} target="_blank" rel="noreferrer">Player view ↗</a>
          <span className="muted">{me.user.name}</span>
          <button className="link" onClick={() => api.logout().then(load)}>Log out</button>
        </div>
      </header>
      {saveError && <div className="banner error">{saveError}</div>}
      <main>
        {tab === 'battle' && <Battle {...props} />}
        {tab === 'bestiary' && <Bestiary {...props} ai={me.ai} onAi={(ai) => setMe((m) => ({ ...m, ai }))} />}
        {tab === 'encounters' && <Encounters {...props} />}
        {tab === 'shop' && <Shop {...props} />}
        {tab === 'party' && <Party {...props} />}
        {tab === 'reference' && <Reference {...props} />}
        {tab === 'admin' && me.user.admin && <Admin />}
        {tab === 'feedback' && <Feedback pages={TABS.filter(([id]) => id !== 'feedback').map(([, label]) => label)} />}
        {tab === 'help' && <Help user={me.user} />}
        {tab === 'account' && <Account user={me.user} onChange={(user) => setMe({ ...me, user })} />}
      </main>
    </div>
  );
}

// Google sign-in comes back to /?login_error=... when it fails; show it once and tidy the address.
function takeLoginError() {
  const params = new URLSearchParams(window.location.search);
  const message = params.get('login_error');
  if (message) window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  return message ?? '';
}

function GoogleButton() {
  return (
    <a className="button google-btn" href="/api/auth/google">
      <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      Continue with Google
    </a>
  );
}

function Auth({ firstAccount, google, onDone }) {
  const [mode, setMode] = useState(firstAccount ? 'signup' : 'login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState(takeLoginError);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [sent, setSent] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    setErr('');
    if (mode === 'forgot') return api.forgot(f.email).then(() => setSent(true)).catch((x) => setErr(x.message));
    const go = mode === 'signup' ? api.signup(f) : api.login(f.email, f.password);
    go.then(() => {
      // New accounts start on the getting-started guide.
      if (mode === 'signup') window.location.hash = 'help';
      onDone();
    }).catch((x) => setErr(x.message));
  };
  if (mode === 'forgot') {
    return (
      <form className="login" onSubmit={submit}>
        <h1>Reset password</h1>
        {sent ? (
          <p>If that email has an account, a reset link is on its way. It works for one hour.</p>
        ) : (
          <>
            <input type="email" placeholder="Email" value={f.email} onChange={set('email')} autoComplete="email" required autoFocus />
            <button className="primary">Send reset link</button>
          </>
        )}
        {err && <p className="error-text">{err}</p>}
        <button type="button" className="link" onClick={() => { setMode('login'); setSent(false); }}>Back to log in</button>
      </form>
    );
  }
  return (
    <form className="login" onSubmit={submit}>
      <h1 className="login-logo"><img src="/logo.svg" alt="DM Screen" width="128" height="128" /></h1>
      <div className="seg">
        <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Log in</button>
        <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>Sign up</button>
      </div>
      {mode === 'signup' && firstAccount && <p className="muted small">This is the first account, so it gets the campaign data already on this server.</p>}
      {google && (
        <>
          <GoogleButton />
          <div className="or"><span>or</span></div>
        </>
      )}
      {mode === 'signup' && <input placeholder="Your name" value={f.name} onChange={set('name')} autoComplete="name" required />}
      {mode === 'signup'
        ? <input type="email" placeholder="Email" value={f.email} onChange={set('email')} autoComplete="email" required />
        : <input placeholder="Email or name" value={f.email} onChange={set('email')} autoComplete="username" required />}
      <input type="password" placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'} value={f.password} onChange={set('password')} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required />
      <button className="primary">{mode === 'signup' ? 'Create account' : 'Log in'}</button>
      {err && <p className="error-text">{err}</p>}
      {mode === 'login' && <button type="button" className="link" onClick={() => setMode('forgot')}>Forgot password?</button>}
      <p className="muted small">Players: ask your DM for their player link.</p>
      <a className="muted small" href="/privacy">Privacy</a>
    </form>
  );
}

function Reset({ token }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <form
      className="login"
      onSubmit={(e) => {
        e.preventDefault();
        setErr('');
        api.reset(token, pw).then(() => window.location.replace('/')).catch((x) => setErr(x.message));
      }}
    >
      <h1>Choose a new password</h1>
      <input type="password" placeholder="New password (8+ characters)" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
      <button className="primary">Save and log in</button>
      {err && <p className="error-text">{err}</p>}
      <a href="/">Back to log in</a>
    </form>
  );
}
