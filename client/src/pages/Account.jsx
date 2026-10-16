import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Account({ user, mcp, onChange }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? '');
  const [slug, setSlug] = useState(user.slug);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState({});
  const link = `${window.location.origin}/p/${user.slug}`;

  const save = (key, patch, after) => (e) => {
    e.preventDefault();
    api.account(patch)
      .then((r) => { onChange(r.user); after?.(); setMsg({ [key]: 'Saved.' }); })
      .catch((x) => setMsg({ [key]: x.message }));
  };

  return (
    <div className="page narrow-page">
      <section className="panel">
        <h2>Player link</h2>
        <p className="muted small">Share this with your players. It shows the battle you mark "Show to players".</p>
        <div className="add-row">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button onClick={() => navigator.clipboard?.writeText(link).then(() => setMsg({ link: 'Copied.' }))}>Copy</button>
        </div>
        {msg.link && <p className="muted small">{msg.link}</p>}
        <form className="add-row" onSubmit={save('slug', { slug })}>
          <span className="muted">/p/</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} aria-label="Player link name" />
          <button>Change</button>
        </form>
        {msg.slug && <p className="muted small">{msg.slug}</p>}
      </section>

      <section className="panel">
        <h2>Profile</h2>
        <form className="add-row" onSubmit={save('name', { name })}>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          <button>Save</button>
        </form>
        {msg.name && <p className="muted small">{msg.name}</p>}
        {!user.email && <p className="muted small">Add an email so you can reset your password.</p>}
        <form className="add-row" onSubmit={save('email', { email })}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" autoComplete="email" required />
          <button>Save</button>
        </form>
        {msg.email && <p className="muted small">{msg.email}</p>}
      </section>

      <section className="panel">
        <h2>Change password</h2>
        <p className="muted small">This signs you out on your other devices and disconnects AI apps.</p>
        <form className="editor" onSubmit={save('pw', pw, () => setPw({ currentPassword: '', newPassword: '' }))}>
          <input type="password" placeholder="Current password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
          <input type="password" placeholder="New password (8+ characters)" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
          <div className="btn-row"><button className="primary">Change password</button></div>
        </form>
        {msg.pw && <p className="muted small">{msg.pw}</p>}
      </section>

      {mcp && <AiApps mcp={mcp} />}
    </div>
  );
}

// AI apps connected over MCP (OAuth grants), and how to connect one.
function AiApps({ mcp }) {
  const [apps, setApps] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api.aiApps().then(setApps).catch((x) => setErr(x.message));
  useEffect(() => { load(); }, []);
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString() : 'never');

  return (
    <section className="panel">
      <h2>AI apps</h2>
      <p className="muted small">
        Let an AI such as Claude look things up in your campaign and add monsters and encounters, for example
        "make a random encounter table for my level 5 party in the woods". Add this address as an MCP server
        (in Claude: Settings → Connectors → Add custom connector) and sign in when it asks.
      </p>
      <div className="add-row">
        <input readOnly value={mcp} onFocus={(e) => e.target.select()} aria-label="MCP server address" />
        <button onClick={() => navigator.clipboard?.writeText(mcp)}>Copy</button>
      </div>
      <p className="muted small">In Claude Code: <code>claude mcp add --transport http dm-screen {mcp}</code></p>
      {err && <p className="error-text">{err}</p>}
      {apps?.length === 0 && <p className="muted small">No apps connected.</p>}
      {apps?.map((a) => (
        <div key={a.id} className="add-row">
          <span><strong>{a.clientName}</strong> <span className="muted small">({a.redirectHost}) connected {date(a.createdAt)}, last used {date(a.lastUsed)}</span></span>
          <button onClick={() => api.disconnectAiApp(a.id).then(load).catch((x) => setErr(x.message))}>Disconnect</button>
        </div>
      ))}
    </section>
  );
}
