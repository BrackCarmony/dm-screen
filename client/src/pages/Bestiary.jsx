import React, { useMemo, useState } from 'react';
import { SAVES, fmtCr, fmtMod } from '../rules.js';

const BLANK = { name: '', hp: '', ac: '', speed: '30', saves: {}, init: '', attacks: [], cr: '', xp: '', special: '', url: '' };

// Sortable columns. Names start A→Z; numbers start highest first.
const COLUMNS = [
  { key: 'name', label: 'Name', get: (m) => m.name.toLowerCase(), asc: true },
  { key: 'cr', label: 'CR', get: (m) => m.cr },
  { key: 'hp', label: 'HP', get: (m) => m.hp },
  { key: 'ac', label: 'AC', get: (m) => m.ac },
  { key: 'speed', label: 'Speed', get: (m) => parseInt(m.speed, 10) },
  ...SAVES.map((s) => ({ key: s, label: s.toUpperCase(), get: (m) => m.saves?.[s] })),
  { key: 'init', label: 'Init', get: (m) => m.init },
  { key: 'xp', label: 'XP', get: (m) => m.xp },
];
const missingCr = (v) => v === null || v === undefined || v === '';
const missing = (v) => v === null || v === undefined || v === '' || Number.isNaN(v);

export default function Bestiary({ state, update }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'name', asc: true });
  const [crMin, setCrMin] = useState('');
  const [crMax, setCrMax] = useState('');
  const crs = useMemo(() => [...new Set(state.bestiary.map((m) => m.cr).filter((c) => !missing(c)))].sort((a, b) => a - b), [state.bestiary]);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);

  const rows = useMemo(() => {
    const needle = q.toLowerCase();
    // The two CR boxes work in either order, so 12 to 10 means 10 to 12.
    const [lo, hi] = crMin !== '' && crMax !== '' && Number(crMin) > Number(crMax) ? [crMax, crMin] : [crMin, crMax];
    const list = state.bestiary.filter((m) =>
      (!needle || m.name.toLowerCase().includes(needle) || m.special?.toLowerCase().includes(needle)) &&
      (lo === '' || (!missing(m.cr) && m.cr >= Number(lo))) &&
      (hi === '' || (!missing(m.cr) && m.cr <= Number(hi))));
    const get = COLUMNS.find((c) => c.key === sort.key).get;
    // Blank values always go last, whichever way it's sorted.
    return list.slice().sort((a, b) => {
      const x = get(a), y = get(b);
      if (missing(x) || missing(y)) return missing(x) - missing(y);
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1);
    });
  }, [state.bestiary, q, sort, crMin, crMax]);

  const sortBy = (col) => setSort(sort.key === col.key ? { key: col.key, asc: !sort.asc } : { key: col.key, asc: !!col.asc });
  const filtered = q || crMin !== '' || crMax !== '';

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
        <label className="cr-filter">
          CR
          <select value={crMin} onChange={(e) => setCrMin(e.target.value)} aria-label="Lowest CR">
            <option value="">any</option>
            {crs.map((c) => <option key={c} value={c}>{fmtCr(c)}</option>)}
          </select>
          to
          <select value={crMax} onChange={(e) => setCrMax(e.target.value)} aria-label="Highest CR">
            <option value="">any</option>
            {crs.map((c) => <option key={c} value={c}>{fmtCr(c)}</option>)}
          </select>
        </label>
        {filtered && (
          <>
            <span className="muted small">{rows.length} of {state.bestiary.length}</span>
            <button className="link" onClick={() => { setQ(''); setCrMin(''); setCrMax(''); }}>Clear</button>
          </>
        )}
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing({ original: null, m: { ...BLANK } })}>New monster</button>
      </div>

      {editing && <Editor initial={editing.m} names={state.bestiary.map((m) => m.name)} xpTable={state.xp.cr} original={editing.original} onSave={save} onCancel={() => setEditing(null)} />}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key} aria-sort={sort.key === col.key ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
                  <button className="sort" onClick={() => sortBy(col)}>
                    {col.label}<span className="arrow">{sort.key === col.key ? (sort.asc ? '▲' : '▼') : ''}</span>
                  </button>
                </th>
              ))}
              <th />
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
      <p className="muted small">
        Starter monsters are from the{' '}
        <a href="https://dnd.wizards.com/resources/systems-reference-document" target="_blank" rel="noreferrer">System Reference Document 5.1</a>{' '}
        by Wizards of the Coast LLC, licensed under{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noreferrer">CC BY 4.0</a>.
      </p>
    </div>
  );
}

function Editor({ initial, names, xpTable, original, onSave, onCancel }) {
  const [m, setM] = useState({ ...initial, attacks: [...initial.attacks] });
  const set = (k) => (e) => setM({ ...m, [k]: e.target.value });
  const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const clash = m.name.trim() && m.name.trim() !== original && names.includes(m.name.trim());
  // XP comes from the CR via the XP table. A CR that isn't in the table keeps the monster's own XP.
  const crs = xpTable.map((r) => r.cr);
  if (!missingCr(initial.cr) && !crs.includes(Number(initial.cr))) crs.push(Number(initial.cr));
  crs.sort((a, b) => a - b);
  const xpFor = (cr) => (missingCr(cr) ? null : xpTable.find((r) => r.cr === Number(cr))?.xp ?? (Number(cr) === Number(initial.cr) ? initial.xp ?? null : null));
  const xp = xpFor(m.cr);

  return (
    <form
      className="panel editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (clash || !m.name.trim()) return;
        onSave({
          ...m,
          name: m.name.trim(),
          hp: n(m.hp), ac: n(m.ac), init: n(m.init), cr: n(m.cr), xp,
          saves: Object.fromEntries(SAVES.map((s) => [s, n(m.saves?.[s])])),
          attacks: m.attacks.map((a) => a.trim()).filter(Boolean),
        });
      }}
    >
      <h2>{original ? `Edit ${original}` : 'New monster'}</h2>
      <div className="form-grid">
        <label className="span-2">Name<input value={m.name} onChange={set('name')} required /></label>
        <label>
          CR
          <select value={missingCr(m.cr) ? '' : String(Number(m.cr))} onChange={set('cr')}>
            <option value="">–</option>
            {crs.map((c) => <option key={c} value={String(c)}>{fmtCr(c)}</option>)}
          </select>
        </label>
        <label>XP<output className="xp-value">{xp === null ? '–' : xp.toLocaleString()}</output></label>
        <label>HP<input type="number" value={m.hp ?? ''} onChange={set('hp')} /></label>
        <label>AC<input type="number" value={m.ac ?? ''} onChange={set('ac')} /></label>
        <label>Speed<input value={m.speed ?? ''} onChange={set('speed')} /></label>
        <label>Initiative<input type="number" value={m.init ?? ''} onChange={set('init')} /></label>
      </div>
      <fieldset className="saves-grid">
        <legend>Saves</legend>
        {SAVES.map((s) => (
          <label key={s}>{s.toUpperCase()}<input type="number" value={m.saves?.[s] ?? ''} onChange={(e) => setM({ ...m, saves: { ...m.saves, [s]: e.target.value } })} /></label>
        ))}
      </fieldset>
      {/* Always one blank attack at the end; typing in it adds another. */}
      {[...m.attacks, ''].map((a, i) => (
        <label key={i} className="wide">
          Attack {i + 1}
          <span className="add-row">
            <input value={a} onChange={(e) => { const attacks = [...m.attacks]; attacks[i] = e.target.value; while (attacks.at(-1) === '') attacks.pop(); setM({ ...m, attacks }); }} />
            {i < m.attacks.length && <button type="button" className="icon" title="Remove attack" onClick={() => setM({ ...m, attacks: m.attacks.filter((_, j) => j !== i) })}>✕</button>}
          </span>
        </label>
      ))}
      <label className="wide">Special<textarea rows={3} value={m.special ?? ''} onChange={set('special')} /></label>
      <label className="wide">Link<input value={m.url ?? ''} onChange={set('url')} /></label>
      {clash && <p className="error-text">A monster with that name already exists.</p>}
      <div className="btn-row form-actions">
        <button className="primary">Save monster</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
