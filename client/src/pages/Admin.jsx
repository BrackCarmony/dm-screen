import React, { useEffect, useState } from 'react';

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
  const load = () =>
    fetch('/api/admin/dms')
      .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b.error)))))
      .then(setData)
      .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <p className="error-text">{err}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const t = data.totals;
  return (
    <div className="page">
      <div className="tiles">
        <Tile label="DMs signed up" value={t.dms} />
        <Tile label="New this week" value={t.signups7} />
        <Tile label="New in 30 days" value={t.signups30} />
        <Tile label="Active this week" value={t.active7} />
        <Tile label="Have made a battle" value={t.withBattles} />
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
              <th>Battles</th><th>Party</th><th>Monsters</th><th>Encounters</th><th>Shops</th><th>Player link</th>
            </tr>
          </thead>
          <tbody>
            {data.dms.map((d) => (
              <tr key={d.id}>
                <td><strong>{d.name}</strong>{d.admin && <span className="tag">admin</span>}</td>
                <td>{d.email}</td>
                <td>{date(d.createdAt)}</td>
                <td title={d.lastSeen ?? ''}>{ago(d.lastSeen)}</td>
                <td>{d.counts.battles}{d.live && <span className="tag live-tag">live</span>}</td>
                <td>{d.counts.party}</td>
                <td>{d.counts.monsters}</td>
                <td>{d.counts.encounters}</td>
                <td>{d.counts.shops}</td>
                <td><a href={`/p/${d.slug}`} target="_blank" rel="noreferrer">/p/{d.slug}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Last active updates at most every 10 minutes while a DM uses the site.</p>
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
