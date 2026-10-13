import React, { useMemo, useState } from 'react';
import { beastMap, uid } from '../rules.js';
import { newMonster, partyCombatants, partyCount } from './Battle.jsx';

export default function Encounters({ state, update }) {
  const beasts = useMemo(() => beastMap(state.bestiary), [state.bestiary]);
  const [draft, setDraft] = useState(null);
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
        <button className="primary" onClick={() => setDraft({ id: uid('enc'), group: 'Custom', name: '', note: '', monsters: [] })}>New encounter</button>
      </div>

      {draft && (
        <form
          className="panel editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim() || !draft.monsters.length) return;
            update('encounters', (all) => [...all, { ...draft, name: draft.name.trim() }]);
            setDraft(null);
          }}
        >
          <h2>New encounter</h2>
          <label className="wide">Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
          <label className="wide">Group<input value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value })} /></label>
          <label className="wide">Note<input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
          <MonsterPicker bestiary={state.bestiary} monsters={draft.monsters} onChange={(monsters) => setDraft({ ...draft, monsters })} />
          <div className="btn-row"><button className="primary" disabled={!draft.monsters.length}>Save</button><button type="button" onClick={() => setDraft(null)}>Cancel</button></div>
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
              {c > 1 && <strong>{c}×</strong>} {n}
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
