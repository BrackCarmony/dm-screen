import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal from '../Modal.jsx';
import { beastMap, d, difficulty, fmtRange, partyLevels, rollParts, rollTable, uid } from '../rules.js';
import { newMonster, partyCombatants, partyCount } from './Battle.jsx';

const NEW_GROUP = '\u0000new';

export default function Encounters({ state, update, ai, onAi }) {
  const beasts = useMemo(() => beastMap(state.bestiary), [state.bestiary]);
  const levels = partyLevels(state.party);
  const [draft, setDraft] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [rolled, setRolled] = useState(null); // { group, n, id }: the last roll on a group's table
  const groups = [...new Set(state.encounters.map((e) => e.group))];
  // A long group's rolled encounter may be off screen.
  useEffect(() => {
    if (rolled) document.getElementById(`enc-card-${rolled.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [rolled]);

  function start(enc) {
    const { title } = rollParts(enc);
    const b = {
      id: uid('battle'),
      name: enc.note ? `${title}: ${enc.note}` : title,
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

  // A weight is set on the encounter itself; one saved with its rolls in the name ("3-4: Wolf Pack") loses them.
  const setWeight = (enc, weight) =>
    update('encounters', (all) => all.map((x) => (x.id === enc.id ? { ...x, name: rollParts(x).title, weight: Math.max(0, Math.min(20, weight)) } : x)));

  function roll(group, list) {
    const { ranges, total } = rollTable(list);
    const n = d(total);
    setRolled({ group, n, id: list.find((e) => ranges.get(e.id) && n >= ranges.get(e.id).from && n <= ranges.get(e.id).to).id });
  }

  function save(e) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.monsters.length) return;
    const { newGroup, editing, ...enc } = draft;
    const saved = { ...enc, name: draft.name.trim(), note: draft.note.trim(), group: draft.group.trim() || 'Custom' };
    update('encounters', (all) => (editing ? all.map((x) => (x.id === saved.id ? saved : x)) : [...all, saved]));
    setDraft(null);
  }

  return (
    <div className="page">
      <div className="toolbar">
        <p className="muted">
          Saved groups of monsters. Starting one creates a new battle with your party added. Each group is also a table to roll on:
          an encounter's rolls set how many numbers it gets, and 0 takes it off the table.
        </p>
        <span className="spacer" />
        {ai?.enabled && <button onClick={() => setGenerating(!generating)} aria-expanded={generating}>✨ Generate table</button>}
        <button className="primary" onClick={() => setDraft({ id: uid('enc'), group: groups[0] ?? 'Custom', newGroup: !groups.length, name: '', note: '', weight: 1, monsters: [] })}>New encounter</button>
      </div>

      {generating && ai && (
        <GenerateTable
          ai={ai}
          onAi={onAi}
          levels={levels}
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
        <Modal label={draft.editing ? 'Edit encounter' : 'New encounter'} onClose={() => setDraft(null)}>
          <form className="panel editor" onSubmit={save}>
            <h2>{draft.editing ? 'Edit encounter' : 'New encounter'}</h2>
            <label className="wide">Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required autoFocus /></label>
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
            <label>
              Rolls on the group's table
              <input type="number" min="0" max="20" className="narrow" value={draft.weight}
                onChange={(e) => setDraft({ ...draft, weight: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} />
            </label>
            <MonsterPicker bestiary={state.bestiary} monsters={draft.monsters} onChange={(monsters) => setDraft({ ...draft, monsters })} />
            <div className="btn-row form-actions"><button className="primary" disabled={!draft.monsters.length}>Save encounter</button><button type="button" onClick={() => setDraft(null)}>Cancel</button></div>
          </form>
        </Modal>
      )}

      {groups.map((g) => {
        const list = state.encounters.filter((e) => e.group === g);
        const { ranges, total } = rollTable(list);
        // The last roll, while it still lands on the same encounter (changing rolls or removing one shifts the ranges).
        const range = rolled?.group === g && ranges.get(rolled.id);
        const hit = range && rolled.n >= range.from && rolled.n <= range.to && list.find((e) => e.id === rolled.id);
        return (
          <section key={g}>
            <div className="group-head">
              <h2>{g}</h2>
              {total > 0 && <button onClick={() => roll(g, list)} title={`Roll 1-${total} on this group`}>🎲 Roll 1-{total}</button>}
              {hit && (
                <span className="rolled-result" role="status">
                  <span>Rolled <strong>{rolled.n}</strong>: {rollParts(hit).title}</span>
                  <button className="primary" onClick={() => start(hit)}>Start battle</button>
                </span>
              )}
            </div>
            <div className="enc-grid">
              {list.map((enc) => {
                const { title, weight } = rollParts(enc);
                const xps = enc.monsters.map((n) => beasts.get(n)?.xp);
                const xp = xps.reduce((s, x) => s + (x ?? 0), 0);
                const rating = difficulty(xps, levels);
                const missing = enc.monsters.filter((n) => !beasts.has(n));
                const isHit = hit && hit.id === enc.id;
                return (
                  <article key={enc.id} id={`enc-card-${enc.id}`} className={`card enc${weight ? '' : ' off-table'}${isHit ? ' rolled' : ''}`}>
                    <header>
                      <div>
                        <h3><span className="roll-range" title="Its numbers on the group's roll">{fmtRange(ranges.get(enc.id))}</span> {title}</h3>
                        {enc.note && <div className="muted small">{enc.note}</div>}
                      </div>
                      <div className="card-actions">
                        <button className="icon" title="Edit" onClick={() => setDraft({ ...enc, name: title, weight, newGroup: false, editing: true })}>✎</button>
                        <button className="icon" title="Delete" onClick={() => confirm(`Delete ${title}?`) && update('encounters', (all) => all.filter((x) => x.id !== enc.id))}>✕</button>
                      </div>
                    </header>
                    <p>{summarize(enc.monsters)}</p>
                    <div className="muted small">
                      {xp.toLocaleString()} XP
                      {rating && <> · <span className={`difficulty ${rating.toLowerCase()}`}>{rating}</span></>}
                      {missing.length ? ` · not in bestiary: ${[...new Set(missing)].join(', ')}` : ''}
                    </div>
                    <div className="enc-foot">
                      <button className="primary" onClick={() => start(enc)}>Start battle</button>
                      <span className="weight" title="How many numbers of the group's roll this encounter gets; 0 takes it off the table">
                        <span className="muted small">{weight ? `Rolls ×${weight}` : 'Off the table'}</span>
                        <button className="icon" aria-label={`Fewer rolls for ${title}`} disabled={!weight} onClick={() => setWeight(enc, weight - 1)}>−</button>
                        <button className="icon" aria-label={`More rolls for ${title}`} onClick={() => setWeight(enc, weight + 1)}>+</button>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {!levels.length && state.encounters.length > 0 && (
        <p className="muted small">Set your players' levels on the <a href="#party">Party page</a> to see how hard each encounter is.</p>
      )}
    </div>
  );
}

const SIZES = [4, 6, 8, 10, 12];

// Describe a place; Claude builds a random encounter table from the bestiary and saves it as a new group.
function GenerateTable({ ai, onAi, levels, partySize, onAdded, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [level, setLevel] = useState(3);
  const [entries, setEntries] = useState(8);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const left = Math.max(0, ai.limit - ai.used);
  const levelText = [...new Set(levels)].sort((a, b) => a - b).join('/');

  function submit(e) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    api.generateTable({ prompt, entries, ...(!levels.length && { level: Number(level) }) })
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
        bestiary {levels.length ? `for your party of ${levels.length} at level ${levelText}` : `for your party of ${partySize}`}, and adds a new
        monster only if nothing fits. You can change the rolls, edit or remove entries afterwards.
      </p>
      <textarea rows={2} maxLength={500} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Where is the party?" disabled={busy || !left} autoFocus />
      <div className="btn-row table-options">
        {!levels.length && (
          <label>Party level <input type="number" min={1} max={20} value={level} onChange={(e) => setLevel(e.target.value)} disabled={busy} /></label>
        )}
        <label>Encounters <select value={entries} onChange={(e) => setEntries(Number(e.target.value))} disabled={busy}>{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
      {!levels.length && <p className="muted small">Set levels on the <a href="#party">Party page</a> and tables will match each player's level.</p>}
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
