import React, { useMemo, useState } from 'react';
import { api } from '../api.js';
import { beastMap, uid } from '../rules.js';
import { newMonster, partyCombatants, partyCount } from './Battle.jsx';

const NEW_GROUP = '\u0000new';

export default function Encounters({ state, update, ai, onAi }) {
  const beasts = useMemo(() => beastMap(state.bestiary), [state.bestiary]);
  const [draft, setDraft] = useState(null);
  const [generating, setGenerating] = useState(false);
  const groups = [...new Set(state.encounters.map((e) => e.group))];

  function start(enc) {
    const b = {
      id: uid('battle'),
      name: enc.note ? `${enc.name}: ${enc.note}` : enc.name,
      save: 'con',
      partySize: partyCount(state),
      partyDamage: null,
      round: 1,
      turn: null,
      combatants: [...enc.monsters.map(newMonster), ...partyCombatants(state)],
    };
    update('battles', (all) => [...all, b]);
    update('settings', (s) => ({ ...s, openBattleId: b.id }));
    window.location.hash = 'battle';
  }

  return (
    <div className="page">
      <div className="toolbar">
        <p className="muted">Saved groups of monsters. Starting one creates a new battle with your party added.</p>
        <span className="spacer" />
        {ai?.enabled && <button onClick={() => setGenerating(!generating)} aria-expanded={generating}>✨ Generate table</button>}
        <button className="primary" onClick={() => setDraft({ id: uid('enc'), group: groups[0] ?? 'Custom', newGroup: !groups.length, name: '', note: '', monsters: [] })}>New encounter</button>
      </div>

      {generating && ai && (
        <GenerateTable
          ai={ai}
          onAi={onAi}
          partySize={partyCount(state)}
          onClose={() => setGenerating(false)}
          // The server has already saved them; add them here too so the next save keeps them.
          onAdded={(r) => {
            if (r.monsters.length) update('bestiary', (all) => [...all, ...r.monsters.filter((m) => !all.some((x) => x.name === m.name))]);
            update('encounters', (all) => [...all, ...r.encounters.filter((e) => !all.some((x) => x.id === e.id))]);
          }}
        />
      )}

      {draft && (
        <form
          className="panel editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim() || !draft.monsters.length) return;
            const { newGroup, ...enc } = draft;
            update('encounters', (all) => [...all, { ...enc, name: draft.name.trim(), group: draft.group.trim() || 'Custom' }]);
            setDraft(null);
          }}
        >
          <h2>New encounter</h2>
          <label className="wide">Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
          {groups.length > 0 && (
            <label className="wide">
              Group
              <select
                value={draft.newGroup ? NEW_GROUP : draft.group}
                onChange={(e) => setDraft(e.target.value === NEW_GROUP ? { ...draft, group: '', newGroup: true } : { ...draft, group: e.target.value, newGroup: false })}
              >
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                <option value={NEW_GROUP}>New group…</option>
              </select>
            </label>
          )}
          {draft.newGroup && (
            <label className="wide">
              {groups.length ? 'New group name' : 'Group'}
              <input value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value })} placeholder="Custom" autoFocus={groups.length > 0} />
            </label>
          )}
          <label className="wide">Note<input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
          <MonsterPicker bestiary={state.bestiary} monsters={draft.monsters} onChange={(monsters) => setDraft({ ...draft, monsters })} />
          <div className="btn-row form-actions"><button className="primary" disabled={!draft.monsters.length}>Save encounter</button><button type="button" onClick={() => setDraft(null)}>Cancel</button></div>
        </form>
      )}

      {groups.map((g) => (
        <section key={g}>
          <h2>{g}</h2>
          <div className="enc-grid">
            {state.encounters.filter((e) => e.group === g).map((enc) => {
              const xp = enc.monsters.reduce((s, n) => s + (beasts.get(n)?.xp ?? 0), 0);
              const missing = enc.monsters.filter((n) => !beasts.has(n));
              return (
                <article key={enc.id} className="card enc">
                  <header>
                    <div>
                      <h3>{enc.name}</h3>
                      {enc.note && <div className="muted small">{enc.note}</div>}
                    </div>
                    <button className="icon" title="Delete" onClick={() => confirm(`Delete ${enc.name}?`) && update('encounters', (all) => all.filter((x) => x.id !== enc.id))}>✕</button>
                  </header>
                  <p>{summarize(enc.monsters)}</p>
                  <div className="muted small">{xp.toLocaleString()} XP{missing.length ? ` · not in bestiary: ${[...new Set(missing)].join(', ')}` : ''}</div>
                  <button className="primary" onClick={() => start(enc)}>Start battle</button>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const DICE = [6, 8, 10, 12, 20];

// Describe a place; Claude builds a random encounter table from the bestiary and saves it as a new group.
function GenerateTable({ ai, onAi, partySize, onAdded, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [level, setLevel] = useState(3);
  const [die, setDie] = useState(8);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const left = Math.max(0, ai.limit - ai.used);

  function submit(e) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    api.generateTable({ prompt, level: Number(level), die })
      .then((r) => {
        onAi(r.ai);
        onAdded(r);
        setPrompt('');
        setMsg({
          text: [
            `Added “${r.group}” with ${r.encounters.length} encounters.`,
            r.monsters.length && `New monsters in your bestiary: ${r.monsters.map((m) => m.name).join(', ')}.`,
            r.dropped.length && `Left out monsters that aren't in your bestiary: ${r.dropped.join(', ')}.`,
          ].filter(Boolean).join(' '),
        });
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
        <h2>Generate an encounter table <span className="tag">beta</span></h2>
        <span className="muted small">{left} of {ai.limit} generations left</span>
      </div>
      <p className="muted small">
        Describe where the party is, for example “a haunted marsh at night”. Claude builds a random encounter table from your
        bestiary for your party of {partySize}, and adds a new monster only if nothing fits. Each note starts with how hard the fight is.
      </p>
      <textarea rows={2} maxLength={500} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Where is the party?" disabled={busy || !left} autoFocus />
      <div className="btn-row table-options">
        <label>Party level <input type="number" min={1} max={20} value={level} onChange={(e) => setLevel(e.target.value)} disabled={busy} /></label>
        <label>Roll <select value={die} onChange={(e) => setDie(Number(e.target.value))} disabled={busy}>{DICE.map((n) => <option key={n} value={n}>d{n}</option>)}</select></label>
      </div>
      <div className="btn-row">
        <button className="primary" disabled={busy || !left || !prompt.trim()}>{busy ? 'Building table…' : 'Generate'}</button>
        <button type="button" onClick={onClose}>Close</button>
        {busy && <span className="muted small">This can take a minute.</span>}
      </div>
      {!left && <p className="muted small">You've used all your beta generations.</p>}
      {msg && <p className={msg.error ? 'error-text small' : 'small'}>{msg.text}</p>}
    </form>
  );
}

// One pill per monster with a count; adding a name already in the list bumps its count.
function MonsterPicker({ bestiary, monsters, onChange }) {
  const [name, setName] = useState('');
  const counts = countNames(monsters);
  const add = () => {
    const n = name.trim();
    if (!n) return;
    onChange([...monsters, bestiary.find((m) => m.name.toLowerCase() === n.toLowerCase())?.name ?? n]);
    setName('');
  };
  const removeOne = (n) => {
    const i = monsters.lastIndexOf(n);
    onChange(monsters.filter((_, j) => j !== i));
  };
  return (
    <div>
      <span className="muted small">Monsters</span>
      {counts.size > 0 && (
        <div className="pills">
          {[...counts].map(([n, c]) => (
            <span key={n} className="pill">
              {/* The count keeps a fixed width, so − and + stay put while you click them. */}
              <strong className="count">{c}×</strong>
              <span className="pill-name">{n}</span>
              <button type="button" className="icon" title={`One less ${n}`} onClick={() => removeOne(n)}>−</button>
              <button type="button" className="icon" title={`One more ${n}`} onClick={() => onChange([...monsters, n])}>+</button>
            </span>
          ))}
        </div>
      )}
      <div className="add-row">
        <input list="encounter-beasts" placeholder="Add monster…" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} aria-label="Add monster" />
        <button type="button" onClick={add}>Add</button>
        <datalist id="encounter-beasts">{bestiary.map((m) => <option key={m.name} value={m.name} />)}</datalist>
      </div>
    </div>
  );
}

function countNames(names) {
  const counts = new Map();
  names.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
  return counts;
}

function summarize(names) {
  return [...countNames(names)].map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ');
}
