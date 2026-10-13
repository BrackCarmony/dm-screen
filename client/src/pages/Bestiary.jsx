import React, { useMemo, useState } from 'react';
import { SAVES, fmtCr, fmtMod } from '../rules.js';

const BLANK = { name: '', hp: '', ac: '', speed: '30', saves: {}, init: '', attacks: [], cr: '', xp: '', special: '', url: '' };

export default function Bestiary({ state, update }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name');
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);

  const rows = useMemo(() => {
    const needle = q.toLowerCase();
    const list = state.bestiary.filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.special?.toLowerCase().includes(needle));
    const key = { name: (m) => m.name, cr: (m) => m.cr ?? -1, hp: (m) => m.hp ?? 0, ac: (m) => m.ac ?? 0 }[sort];
    return list.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (sort === 'name' ? 1 : -1));
  }, [state.bestiary, q, sort]);

  function save(m) {
    update('bestiary', (all) => {
      const i = all.findIndex((x) => x.name === editing.original);
      return i === -1 ? [...all, m] : all.map((x, j) => (j === i ? m : x));
    });
    setEditing(null);
  }

  return (
    <div className="page">
      <div className="toolbar">
        <input placeholder={`Search ${state.bestiary.length} monsters…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name">Sort by name</option>
          <option value="cr">Sort by CR</option>
          <option value="hp">Sort by HP</option>
          <option value="ac">Sort by AC</option>
        </select>
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing({ original: null, m: { ...BLANK } })}>New monster</button>
      </div>

      {editing && <Editor initial={editing.m} names={state.bestiary.map((m) => m.name)} original={editing.original} onSave={save} onCancel={() => setEditing(null)} />}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th><th>CR</th><th>HP</th><th>AC</th><th>Speed</th>
              {SAVES.map((s) => <th key={s}>{s.toUpperCase()}</th>)}
              <th>Init</th><th>XP</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <React.Fragment key={m.name}>
                <tr className="clickable" onClick={() => setOpen(open === m.name ? null : m.name)}>
                  <td><strong>{m.name}</strong></td>
                  <td>{fmtCr(m.cr)}</td><td>{m.hp ?? '–'}</td><td>{m.ac ?? '–'}</td><td>{m.speed || '–'}</td>
                  {SAVES.map((s) => <td key={s}>{fmtMod(m.saves?.[s])}</td>)}
                  <td>{fmtMod(m.init)}</td><td>{m.xp?.toLocaleString() ?? '–'}</td>
                  <td><button className="link" onClick={(e) => { e.stopPropagation(); setEditing({ original: m.name, m }); }}>Edit</button></td>
                </tr>
                {open === m.name && (
                  <tr className="detail">
                    <td colSpan={14}>
                      <ul className="attacks">{m.attacks.map((a, i) => <li key={i}>{a}</li>)}</ul>
                      {m.special && <p>{m.special}</p>}
                      {m.url && <a href={m.url} target="_blank" rel="noreferrer">Full stat block ↗</a>}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Editor({ initial, names, original, onSave, onCancel }) {
  const [m, setM] = useState({ ...initial, attacks: [...initial.attacks, '', '', ''].slice(0, Math.max(3, initial.attacks.length)) });
  const set = (k) => (e) => setM({ ...m, [k]: e.target.value });
  const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const clash = m.name.trim() && m.name.trim() !== original && names.includes(m.name.trim());

  return (
    <form
      className="panel editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (clash || !m.name.trim()) return;
        onSave({
          ...m,
          name: m.name.trim(),
          hp: n(m.hp), ac: n(m.ac), init: n(m.init), cr: n(m.cr), xp: n(m.xp),
          saves: Object.fromEntries(SAVES.map((s) => [s, n(m.saves?.[s])])),
          attacks: m.attacks.map((a) => a.trim()).filter(Boolean),
        });
      }}
    >
      <h2>{original ? `Edit ${original}` : 'New monster'}</h2>
      <div className="form-grid">
        <label>Name<input value={m.name} onChange={set('name')} required /></label>
        <label>HP<input type="number" value={m.hp ?? ''} onChange={set('hp')} /></label>
        <label>AC<input type="number" value={m.ac ?? ''} onChange={set('ac')} /></label>
        <label>Speed<input value={m.speed ?? ''} onChange={set('speed')} /></label>
        <label>Init<input type="number" value={m.init ?? ''} onChange={set('init')} /></label>
        <label>CR<input type="number" step="any" value={m.cr ?? ''} onChange={set('cr')} /></label>
        <label>XP<input type="number" value={m.xp ?? ''} onChange={set('xp')} /></label>
        {SAVES.map((s) => (
          <label key={s}>{s.toUpperCase()} save<input type="number" value={m.saves?.[s] ?? ''} onChange={(e) => setM({ ...m, saves: { ...m.saves, [s]: e.target.value } })} /></label>
        ))}
      </div>
      {m.attacks.map((a, i) => (
        <label key={i} className="wide">Attack {i + 1}<input value={a} onChange={(e) => setM({ ...m, attacks: m.attacks.map((x, j) => (j === i ? e.target.value : x)) })} /></label>
      ))}
      <label className="wide">Special<textarea rows={3} value={m.special ?? ''} onChange={set('special')} /></label>
      <label className="wide">Link<input value={m.url ?? ''} onChange={set('url')} /></label>
      {clash && <p className="error-text">A monster with that name already exists.</p>}
      <div className="btn-row">
        <button className="primary">Save</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
