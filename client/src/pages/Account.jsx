import React, { useState } from 'react';
import { api } from '../api.js';

export default function Account({ user, onChange }) {
  const [name, setName] = useState(user.name);
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
        <p className="muted small">{user.email}</p>
        <form className="add-row" onSubmit={save('name', { name })}>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          <button>Save</button>
        </form>
        {msg.name && <p className="muted small">{msg.name}</p>}
      </section>

      <section className="panel">
        <h2>Change password</h2>
        <form className="editor" onSubmit={save('pw', pw, () => setPw({ currentPassword: '', newPassword: '' }))}>
          <input type="password" placeholder="Current password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
          <input type="password" placeholder="New password (8+ characters)" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
          <div className="btn-row"><button className="primary">Change password</button></div>
        </form>
        {msg.pw && <p className="muted small">{msg.pw}</p>}
      </section>
    </div>
  );
}
