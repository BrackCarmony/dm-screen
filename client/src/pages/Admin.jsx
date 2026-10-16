import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUS = { open: 'Open', addressed: 'Addressed', rejected: "Won't do" };
const FILTERS = [['open', 'Open'], ['addressed', 'Addressed'], ['rejected', "Won't do"], ['all', 'All']];

const ago = (iso) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
};
const date = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '–');

export default function Admin() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('open');
  const load = () => api.adminDms().then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <p className="error-text">{err}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const t = data.totals;
  // Feedback counts come from the list, so they follow marks made on this page.
  const count = (status) => (status === 'all' ? data.feedback.length : data.feedback.filter((f) => f.status === status).length);
  const shown = data.feedback.filter((f) => filter === 'all' || f.status === filter);
  const replace = (item) => setData({ ...data, feedback: data.feedback.map((f) => (f.id === item.id ? item : f)) });
  return (
    <div className="page">
      <div className="tiles">
        <Tile label="DMs signed up" value={t.dms} />
        <Tile label="New this week" value={t.signups7} />
        <Tile label="New in 30 days" value={t.signups30} />
        <Tile label="Active this week" value={t.active7} />
        <Tile label="Have made a battle" value={t.withBattles} />
        <Tile label="Open feedback" value={count('open')} />
        <Tile label="Have used AI" value={t.aiUsers} />
        <Tile label="AI generations" value={t.aiGenerations} />
        {t.aiNearLimit > 0 && <Tile label="Near the AI limit" value={t.aiNearLimit} />}
      </div>
      <div className="toolbar">
        <h2>DMs</h2>
        <span className="spacer" />
        <button onClick={load}>Refresh</button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Signed up</th><th>Last active</th>
              <th>Battles</th><th>Party</th><th>Monsters</th><th>Encounters</th><th>Shops</th><th>AI used</th><th>AI apps</th><th>Feedback</th><th>Player link</th>
            </tr>
          </thead>
          <tbody>
            {data.dms.map((d) => (
              <tr key={d.id}>
                <td><strong>{d.name}</strong>{d.admin && <span className="tag">admin</span>}</td>
                <td>{d.email ?? <span className="muted">none yet</span>}</td>
                <td>{date(d.createdAt)}</td>
                <td title={d.lastSeen ?? ''}>{ago(d.lastSeen)}</td>
                <td>{d.counts.battles}{d.live && <span className="tag live-tag">live</span>}</td>
                <td>{d.counts.party}</td>
                <td>{d.counts.monsters}</td>
                <td>{d.counts.encounters}</td>
                <td>{d.counts.shops}</td>
                <td title={`${d.ai.monsters} AI monsters in their bestiary. Last generated: ${ago(d.ai.lastUsed)}`}>
                  {d.ai.used} / {d.ai.limit}
                  {d.ai.used >= d.ai.limit ? <span className="tag">limit</span> : d.ai.used >= 0.8 * d.ai.limit && <span className="tag">near limit</span>}
                </td>
                <td>{d.ai.apps}</td>
                <td>{d.feedback}</td>
                <td><a href={`/p/${d.slug}`} target="_blank" rel="noreferrer">/p/{d.slug}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Last active updates at most every 10 minutes while a DM uses the site. AI used is generations with the Bestiary's Generate with AI against each account's limit (hover for their AI monsters and when they last generated); AI apps are apps such as Claude connected to their campaign over MCP, which don't count toward the limit.</p>

      <div className="toolbar admin-feedback-head">
        <h2>Feedback</h2>
        <span className="spacer" />
        <div className="seg">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{label} {count(id)}</button>
          ))}
        </div>
      </div>
      {!shown.length ? <p className="muted">Nothing here.</p> : (
        <ul className="feedback-list">
          {shown.map((f) => <FeedbackItem key={f.id} item={f} onChange={replace} />)}
        </ul>
      )}
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div className="tile">
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
    </div>
  );
}

function FeedbackItem({ item, onChange }) {
  const [note, setNote] = useState(item.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const mark = (status) => {
    setBusy(true);
    setErr('');
    api.markFeedback(item.id, { status, note })
      .then(onChange)
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <li className="panel">
      <div className="panel-head">
        <span className="small">
          <strong>{item.name}</strong>{item.email && <span className="muted"> · {item.email}</span>}
          <span className="muted"> · {date(item.createdAt)}{item.page ? ` · ${item.page}` : ''}</span>
        </span>
        <span className={`status-pill ${item.status}`}>{STATUS[item.status] ?? item.status}</span>
      </div>
      <p className="feedback-text">{item.message}</p>
      <div className="add-row">
        <input placeholder="Reply the DM will see (optional)" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        {item.status !== 'addressed' && <button disabled={busy} onClick={() => mark('addressed')}>Addressed</button>}
        {item.status !== 'rejected' && <button disabled={busy} onClick={() => mark('rejected')}>Won't do</button>}
        {item.status !== 'open' && <button disabled={busy} onClick={() => mark(item.status)} title="Save the reply without changing the status">Save reply</button>}
        {item.status !== 'open' && <button disabled={busy} onClick={() => mark('open')}>Reopen</button>}
      </div>
      {err && <p className="error-text small">{err}</p>}
    </li>
  );
}
