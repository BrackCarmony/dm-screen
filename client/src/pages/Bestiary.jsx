import React, { useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal from '../Modal.jsx';
import { SAVES, expandSpecial, fmtCr, fmtMod } from '../rules.js';

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

export default function Bestiary({ state, update, ai, mcp, onAi }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('all');
  const [panel, setPanel] = useState(null); // 'generate' | 'import'
  const toggle = (p) => setPanel(panel === p ? null : p);
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
      (source === 'all' || (source === 'ai' && m.ai) || (source === 'imported' && m.imported)) &&
      (!needle || m.name.toLowerCase().includes(needle) || `${m.special ?? ''} ${expandSpecial(m.special)}`.toLowerCase().includes(needle)) &&
      (lo === '' || (!missing(m.cr) && m.cr >= Number(lo))) &&
      (hi === '' || (!missing(m.cr) && m.cr <= Number(hi))));
    const get = COLUMNS.find((c) => c.key === sort.key).get;
    // Blank values always go last, whichever way it's sorted.
    return list.slice().sort((a, b) => {
      const x = get(a), y = get(b);
      if (missing(x) || missing(y)) return missing(x) - missing(y);
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1);
    });
  }, [state.bestiary, q, sort, crMin, crMax, source]);

  const sortBy = (col) => setSort(sort.key === col.key ? { key: col.key, asc: !sort.asc } : { key: col.key, asc: !!col.asc });
  const filtered = q || crMin !== '' || crMax !== '' || source !== 'all';

  function save(m) {
    update('bestiary', (all) => {
      const i = all.findIndex((x) => x.name === editing.original);
      return i === -1 ? [...all, m] : all.map((x, j) => (j === i ? m : x));
    });
    setEditing(null);
  }

  // The server has already saved the new monsters; add them here too so the next save keeps them.
  function added(monsters, from) {
    update('bestiary', (all) => [...all, ...monsters.filter((m) => !all.some((x) => x.name === m.name))]);
    setSource(from);
    setQ('');
    setCrMin('');
    setCrMax('');
    setOpen(monsters[0].name);
  }

  return (
    <div className="page">
      <div className="toolbar">
        <input placeholder={`Search ${state.bestiary.length} monsters…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Which monsters">
          <option value="all">All monsters</option>
          <option value="ai">AI-generated</option>
          <option value="imported">Imported</option>
        </select>
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
            <button className="link" onClick={() => { setQ(''); setCrMin(''); setCrMax(''); setSource('all'); }}>Clear</button>
          </>
        )}
        <span className="spacer" />
        <button onClick={() => toggle('import')} aria-expanded={panel === 'import'}>Import JSON</button>
        {ai?.enabled && <button onClick={() => toggle('generate')} aria-expanded={panel === 'generate'}>✨ Generate with AI</button>}
        <button className="primary" onClick={() => setEditing({ original: null, m: { ...BLANK } })}>New monster</button>
      </div>

      {panel === 'generate' && ai && <Generate ai={ai} onAi={onAi} onAdded={(m) => added(m, 'ai')} onClose={() => setPanel(null)} />}
      {panel === 'import' && <Import mcp={mcp} onAdded={(m) => added(m, 'imported')} onClose={() => setPanel(null)} />}

      {editing && (
        <Modal label={editing.original ? `Edit ${editing.original}` : 'New monster'} onClose={() => setEditing(null)}>
          <Editor initial={editing.m} names={state.bestiary.map((m) => m.name)} xpTable={state.xp.cr} original={editing.original} onSave={save} onCancel={() => setEditing(null)} />
        </Modal>
      )}

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
                  <td><strong>{m.name}</strong>{m.ai && <span className="tag ai-tag" title="Made with AI">AI</span>}{m.imported && <span className="tag" title="Imported from JSON">Imported</span>}</td>
                  <td>{fmtCr(m.cr)}</td><td>{m.hp ?? '–'}</td><td>{m.ac ?? '–'}</td><td>{m.speed || '–'}</td>
                  {SAVES.map((s) => <td key={s}>{fmtMod(m.saves?.[s])}</td>)}
                  <td>{fmtMod(m.init)}</td><td>{m.xp?.toLocaleString() ?? '–'}</td>
                  <td><button className="link" onClick={(e) => { e.stopPropagation(); setEditing({ original: m.name, m }); }}>Edit</button></td>
                </tr>
                {open === m.name && (
                  <tr className="detail">
                    <td colSpan={14}>
                      <ul className="attacks">{m.attacks.map((a, i) => <li key={i}>{a}</li>)}</ul>
                      {m.special && <p>{expandSpecial(m.special)}</p>}
                      {m.aiPrompt && <p className="muted small">Made with AI from “{m.aiPrompt}”. Check the numbers before you use it.</p>}
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

function Generate({ ai, onAi, onAdded, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const left = Math.max(0, ai.limit - ai.used);

  function submit(e) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    api.generateMonsters(prompt)
      .then((r) => {
        onAi(r.ai);
        onAdded(r.monsters);
        setPrompt('');
        setMsg({ text: `Added ${r.monsters.map((m) => m.name).join(', ')}.` });
      })
      .catch((x) => {
        if (x.data?.ai) onAi(x.data.ai);
        setMsg({ text: x.message, error: true });
      })
      .finally(() => setBusy(false));
  }

  return (
    <form className="panel editor generate" onSubmit={submit}>
      <div className="panel-head">
        <h2>Generate monsters <span className="tag">beta</span></h2>
        <span className="muted small">{left} of {ai.limit} generations left</span>
      </div>
      <p className="muted small">Describe what you need and Claude adds up to 4 new monsters to your bestiary, for example “a CR 3 swamp hag and two bog zombie minions”. A generation only counts if monsters are added.</p>
      <textarea rows={3} maxLength={500} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should Claude make?" disabled={busy || !left} autoFocus />
      <div className="btn-row">
        <button className="primary" disabled={busy || !left || !prompt.trim()}>{busy ? 'Making monsters…' : 'Generate'}</button>
        <button type="button" onClick={onClose}>Close</button>
        {busy && <span className="muted small">This can take a minute.</span>}
      </div>
      {!left && <p className="muted small">You've used all your beta generations.</p>}
      {msg && <p className={msg.error ? 'error-text small' : 'small'}>{msg.text}</p>}
    </form>
  );
}

function Import({ mcp, onAdded, onClose }) {
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [guide, setGuide] = useState(null);
  const [copied, setCopied] = useState(false);

  function submit(e) {
    e.preventDefault();
    if (!json.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    api.importMonsters(json)
      .then((r) => {
        onAdded(r.monsters);
        setJson('');
        const skipped = r.skipped ? ` Skipped ${r.skipped} without a name.` : '';
        setMsg({ text: `Added ${r.monsters.length} monster${r.monsters.length === 1 ? '' : 's'}: ${r.monsters.map((m) => m.name).join(', ')}.${skipped}` });
      })
      .catch((x) => setMsg({ text: x.message, error: true }))
      .finally(() => setBusy(false));
  }
  const loadGuide = (e) => {
    if (e.currentTarget.open && !guide) api.agentInstructions().then((r) => setGuide(r.text)).catch((x) => setGuide(x.message));
  };
  const copy = () => navigator.clipboard.writeText(guide).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });

  return (
    <form className="panel editor generate" onSubmit={submit}>
      <h2>Import monsters</h2>
      <p className="muted small">Paste monsters as JSON, for example from your own AI or another DM. Free, and doesn't use a generation.</p>
      {mcp && (
        <p className="small callout">
          <strong>Skip the copy and paste.</strong> If your AI app can connect to MCP servers (Claude can), connect it to
          DM Screen once and just ask: "add three swamp monsters for a level 5 party". They go straight into your bestiary,
          and it can build encounters from them too. <a href="#account/ai-apps">Connect an AI app →</a>
        </p>
      )}
      <details className="agent-guide" onToggle={loadGuide}>
        <summary>Using your own AI? Copy these instructions</summary>
        <p className="muted small">Give these to ChatGPT, Claude or your own agent, replace the part in angle brackets with what you want, then paste its reply below.</p>
        {guide === null ? <p className="muted small">Loading…</p> : (
          <>
            <pre className="guide-text">{guide}</pre>
            <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy instructions'}</button>
          </>
        )}
      </details>
      <textarea rows={6} className="mono" value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"monsters": [{"name": "…", "cr": 1, "hp": 22, …}]}' disabled={busy} spellCheck={false} />
      <div className="btn-row">
        <button className="primary" disabled={busy || !json.trim()}>{busy ? 'Importing…' : 'Import'}</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {msg && <p className={msg.error ? 'error-text small' : 'small'}>{msg.text}</p>}
    </form>
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
