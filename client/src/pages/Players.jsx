import React, { useEffect, useState } from 'react';

export default function Players({ slug }) {
  const [view, setView] = useState(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const url = `/api/public/${encodeURIComponent(slug)}`;
    let es, retry, delay = 1000, stopped = false;
    // The browser retries a dropped stream by itself, but gives up for good if the server answers
    // with an error (e.g. while it restarts), so reconnect by hand when that happens.
    const connect = () => {
      es = new EventSource(`${url}/stream`);
      es.onmessage = (e) => {
        delay = 1000;
        setView(JSON.parse(e.data));
        setLive(true);
      };
      es.onerror = () => {
        setLive(false);
        fetch(url).then((r) => {
          if (r.status === 404) { stopped = true; es.close(); setView({ missing: true }); }
        }).catch(() => {}).finally(() => {
          if (stopped || es.readyState !== EventSource.CLOSED) return;
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 15000);
        });
      };
    };
    connect();
    return () => { stopped = true; clearTimeout(retry); es.close(); };
  }, [slug]);

  if (!view) return <div className="center muted">Connecting…</div>;
  if (view.missing || view.moved) return <div className="center muted">This player link doesn't exist. Ask your DM for the current one.</div>;
  return (
    <div className="players">
      <header>
        <h1>{view.battle ?? 'No battle running'}</h1>
        <div className="muted">{view.battle ? `Round ${view.round} · ` : ''}DM: {view.dm}</div>
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
