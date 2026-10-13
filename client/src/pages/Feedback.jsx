import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUS = { open: 'Open', addressed: 'Addressed', rejected: "Won't do" };

export default function Feedback({ pages }) {
  const [items, setItems] = useState(null);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState('');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.feedback().then(setItems).catch((e) => setMsg(e.message));
  }, []);

  function send(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    api.sendFeedback({ message, page })
      .then((item) => { setItems([item, ...(items ?? [])]); setMessage(''); setPage(''); setMsg('Thanks! Your feedback was sent.'); })
      .catch((x) => setMsg(x.message))
      .finally(() => setSending(false));
  }

  return (
    <div className="page narrow-page">
      <form className="panel editor" onSubmit={send}>
        <h2>Send feedback</h2>
        <p className="muted small">Something confusing, missing or broken? Tell us what could be better. You'll see here when it's been looked at.</p>
        <label>
          About
          <select value={page} onChange={(e) => setPage(e.target.value)}>
            <option value="">General</option>
            {pages.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>
          Feedback
          <textarea rows={5} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} required />
        </label>
        <div className="btn-row"><button className="primary" disabled={sending || !message.trim()}>Send</button></div>
        {msg && <p className="muted small">{msg}</p>}
      </form>

      <h2>Your feedback</h2>
      {items === null ? <p className="muted">Loading…</p> : !items.length ? <p className="muted">Nothing sent yet.</p> : (
        <ul className="feedback-list">
          {items.map((f) => (
            <li key={f.id} className="panel">
              <div className="panel-head">
                <span className="muted small">{new Date(f.createdAt).toLocaleDateString()}{f.page ? ` · ${f.page}` : ''}</span>
                <span className={`status-pill ${f.status}`}>{STATUS[f.status] ?? f.status}</span>
              </div>
              <p className="feedback-text">{f.message}</p>
              {f.note && <p className="small"><strong>Reply:</strong> {f.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
