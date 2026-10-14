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

  if (!me) return <div className="center muted">Loading…</div>;
  const resetToken = window.location.pathname === '/reset' ? new URLSearchParams(window.location.search).get('token') : null;
  if (resetToken) return <Reset token={resetToken} />;
  if (!me.user) return <Auth firstAccount={me.firstAccount} onDone={load} />;
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
        {tab === 'bestiary' && <Bestiary {...props} />}
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

function Auth({ firstAccount, onDone }) {
  const [mode, setMode] = useState(firstAccount ? 'signup' : 'login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
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
      <h1>DM Screen</h1>
      <div className="seg">
        <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Log in</button>
        <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>Sign up</button>
      </div>
      {mode === 'signup' && firstAccount && <p className="muted small">This is the first account, so it gets the campaign data already on this server.</p>}
      {mode === 'signup' && <input placeholder="Your name" value={f.name} onChange={set('name')} autoComplete="name" required />}
      {mode === 'signup'
        ? <input type="email" placeholder="Email" value={f.email} onChange={set('email')} autoComplete="email" required />
        : <input placeholder="Email or name" value={f.email} onChange={set('email')} autoComplete="username" required />}
      <input type="password" placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'} value={f.password} onChange={set('password')} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required />
      <button className="primary">{mode === 'signup' ? 'Create account' : 'Log in'}</button>
      {err && <p className="error-text">{err}</p>}
      {mode === 'login' && <button type="button" className="link" onClick={() => setMode('forgot')}>Forgot password?</button>}
      <p className="muted small">Players: ask your DM for their player link.</p>
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
