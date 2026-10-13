import React, { useEffect, useState } from 'react';

export default function Players() {
  const [view, setView] = useState(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/public/stream');
    es.onmessage = (e) => {
      setView(JSON.parse(e.data));
      setLive(true);
    };
    es.onerror = () => setLive(false);
    return () => es.close();
  }, []);

  if (!view) return <div className="center muted">Connecting…</div>;
  return (
    <div className="players">
      <header>
        <h1>{view.battle ?? 'No battle running'}</h1>
        {view.battle && <div className="muted">Round {view.round}</div>}
        <span className={`dot ${live ? 'on' : ''}`} title={live ? 'Live' : 'Reconnecting'} />
      </header>
      <ol className="order">
        {view.order.map((c) => (
          <li key={c.id} className={`${c.team === 'P' ? 'pc' : 'npc'} ${view.turn === c.id ? 'current' : ''} ${c.health === 0 ? 'down' : ''}`}>
            <span className="init">{c.init}</span>
            <span className="name">{c.name}</span>
            {c.health !== undefined && (
              <span className="health" title={status(c.health)}>
                <span className="bar"><span style={{ width: `${Math.round(c.health * 100)}%` }} /></span>
                <span className="status">{status(c.health)}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      {view.battle && view.order.length === 0 && <p className="center muted">Waiting for initiative…</p>}
    </div>
  );
}

const status = (h) => (h <= 0 ? 'Down' : h <= 0.5 ? 'Bloodied' : '');
