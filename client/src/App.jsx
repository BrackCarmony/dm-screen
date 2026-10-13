import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Battle from './pages/Battle.jsx';
import Bestiary from './pages/Bestiary.jsx';
import Encounters from './pages/Encounters.jsx';
import Shop from './pages/Shop.jsx';
import Party from './pages/Party.jsx';
import Reference from './pages/Reference.jsx';

const TABS = [
  ['battle', 'Battle'],
  ['bestiary', 'Bestiary'],
  ['encounters', 'Encounters'],
  ['shop', 'Magic Shop'],
  ['party', 'Party'],
  ['reference', 'XP Tables'],
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
    if (m.dm) setState(await api.state());
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
  if (!me.dm) return <Login onDone={load} />;
  if (!state) return <div className="center muted">Loading…</div>;

  const props = { state, update };
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">DM Screen</div>
        <nav>
          {TABS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className={tab === id ? 'active' : ''}>{label}</a>
          ))}
        </nav>
        <div className="topbar-right">
          <a href="/players" target="_blank" rel="noreferrer">Player view ↗</a>
          {me.passwordSet && <button className="link" onClick={() => api.logout().then(load)}>Log out</button>}
        </div>
      </header>
      {saveError && <div className="banner error">{saveError}</div>}
      {!me.passwordSet && <div className="banner">No DM password is set, so anyone can open this page. Set DM_PASSWORD before deploying.</div>}
      <main>
        {tab === 'battle' && <Battle {...props} />}
        {tab === 'bestiary' && <Bestiary {...props} />}
        {tab === 'encounters' && <Encounters {...props} />}
        {tab === 'shop' && <Shop {...props} />}
        {tab === 'party' && <Party {...props} />}
        {tab === 'reference' && <Reference {...props} />}
      </main>
    </div>
  );
}

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <form
      className="login"
      onSubmit={(e) => {
        e.preventDefault();
        api.login(pw).then(onDone).catch((x) => setErr(x.message));
      }}
    >
      <h1>DM Screen</h1>
      <input type="password" placeholder="DM password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      <button className="primary">Enter</button>
      {err && <p className="error-text">{err}</p>}
      <p className="muted"><a href="/players">Looking for the player view?</a></p>
    </form>
  );
}
