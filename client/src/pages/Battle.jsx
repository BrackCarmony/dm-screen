import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SAVES, beastMap, currentHp, d, fmtCr, fmtMod, initMod, initiativeOrder, maxHp, uid, xpSummary } from '../rules.js';

export default function Battle({ state, update }) {
  const beasts = useMemo(() => beastMap(state.bestiary), [state.bestiary]);
  const selected = state.settings.openBattleId ?? state.settings.activeBattleId;
  const setSelected = (id) => update('settings', (s) => ({ ...s, openBattleId: id }));
  const battle = state.battles.find((b) => b.id === selected) ?? state.battles[0];
  const isLive = battle && state.settings.activeBattleId === battle.id;

  const setBattle = (fn) => update('battles', (all) => all.map((b) => (b.id === battle.id ? fn(b) : b)));
  const setCombatant = (id, fn) => setBattle((b) => ({ ...b, combatants: b.combatants.map((c) => (c.id === id ? fn(c) : c)) }));

  function newBattle() {
    const name = prompt('Battle name?', 'New battle');
    if (!name) return;
    const b = { id: uid('battle'), name, save: 'con', partySize: partyCount(state), partyDamage: null, round: 1, turn: null, combatants: partyCombatants(state) };
    update('battles', (all) => [...all, b]);
    setSelected(b.id);
  }

  if (!battle) {
    return (
      <div className="empty">
        <p>No battles yet.</p>
        <button className="primary" onClick={newBattle}>New battle</button>
      </div>
    );
  }

  const monsters = battle.combatants.filter((c) => c.kind === 'monster');

  return (
    <div className="battle">
      <div className="toolbar">
        <select value={battle.id} onChange={(e) => setSelected(e.target.value)}>
          {state.battles.map((b) => (
            <option key={b.id} value={b.id}>{b.name}{state.settings.activeBattleId === b.id ? ' (live)' : ''}</option>
          ))}
        </select>
        <button onClick={newBattle}>New</button>
        <button onClick={() => { const n = prompt('Rename battle', battle.name); if (n) setBattle((b) => ({ ...b, name: n })); }}>Rename</button>
        <button
          className="danger"
          onClick={() => {
            if (!confirm(`Delete "${battle.name}"?`)) return;
            update('battles', (all) => all.filter((b) => b.id !== battle.id));
            setSelected(state.battles.find((b) => b.id !== battle.id)?.id);
          }}
        >
          Delete
        </button>
        <span className="spacer" />
        <button className={isLive ? 'live' : 'primary'} onClick={() => update('settings', (s) => ({ ...s, activeBattleId: isLive ? null : battle.id }))}>
          {isLive ? '● Showing to players' : 'Show to players'}
        </button>
      </div>

      <div className="battle-grid">
        <section>
          <AddMonster bestiary={state.bestiary} onAdd={(names) => setBattle((b) => ({ ...b, combatants: [...b.combatants, ...names.map(newMonster)] }))} />
          <div className="cards">
            {monsters.map((c) => (
              <MonsterCard
                key={c.id}
                c={c}
                beast={beasts.get(c.name)}
                beasts={beasts}
                save={battle.save}
                onSave={(save) => setBattle((b) => ({ ...b, save }))}
                isTurn={battle.turn === c.id}
                onChange={(fn) => setCombatant(c.id, fn)}
                onRemove={() => setBattle((b) => ({ ...b, combatants: b.combatants.filter((x) => x.id !== c.id) }))}
                onCopy={() => setBattle((b) => ({ ...b, combatants: [...b.combatants, newMonster(c.name)] }))}
              />
            ))}
            {monsters.length === 0 && <p className="muted">Add monsters above, or start one from Encounters.</p>}
          </div>
        </section>

        <aside>
          <Initiative battle={battle} beasts={beasts} state={state} setBattle={setBattle} setCombatant={setCombatant} />
          <XpPanel battle={battle} beasts={beasts} setBattle={setBattle} />
        </aside>
      </div>
    </div>
  );
}

export function newMonster(name) {
  return { id: uid('m'), kind: 'monster', name, mask: '', damage: [], init: null };
}

export function partyCombatants(state) {
  return state.party.filter((p) => p.inParty).map((p) => ({ id: uid('p'), kind: 'player', name: p.name, mask: '', damage: [], init: null }));
}

export const partyCount = (state) => state.party.filter((p) => p.inParty).length || 4;

function AddMonster({ bestiary, onAdd }) {
  const [name, setName] = useState('');
  const [count, setCount] = useState(1);
  const add = (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onAdd(Array.from({ length: Math.max(1, Number(count) || 1) }, () => n));
    setName('');
    setCount(1);
  };
  return (
    <form className="add-row" onSubmit={add}>
      <input list="beast-names" placeholder="Add monster…" value={name} onChange={(e) => setName(e.target.value)} />
      <input type="number" min="1" max="20" value={count} onChange={(e) => setCount(e.target.value)} className="narrow" aria-label="How many" />
      <button className="primary">Add</button>
      <datalist id="beast-names">
        {bestiary.map((m) => <option key={m.name} value={m.name} />)}
      </datalist>
    </form>
  );
}

function MonsterCard({ c, beast, beasts, save, onSave, isTurn, onChange, onRemove, onCopy }) {
  const [amount, setAmount] = useState('');
  const [open, setOpen] = useState(false);
  const max = maxHp(c, beasts);
  const cur = currentHp(c, beasts);
  const pct = max ? Math.max(0, Math.min(1, cur / max)) : 0;
  const state = cur <= 0 && max ? 'down' : pct <= 0.5 ? 'bloodied' : '';

  const apply = (sign) => {
    const n = Number(amount);
    if (!n) return;
    onChange((x) => ({ ...x, damage: [...(x.damage ?? []), sign * Math.abs(n)] }));
    setAmount('');
  };

  return (
    <article className={`card ${state} ${isTurn ? 'turn' : ''}`}>
      <header>
        <div>
          <h3>{c.name}</h3>
          <input className="mask" placeholder="Name shown to players" value={c.mask ?? ''} onChange={(e) => onChange((x) => ({ ...x, mask: e.target.value }))} />
        </div>
        <div className="card-actions">
          <button className="icon" title={c.hidden ? 'Hidden from players' : 'Visible to players'} onClick={() => onChange((x) => ({ ...x, hidden: !x.hidden }))}>{c.hidden ? '🙈' : '👁'}</button>
          <button className="icon" title="Add another" onClick={onCopy}>＋</button>
          <button className="icon" title="Remove" onClick={onRemove}>✕</button>
        </div>
      </header>

      {!beast && (
        <p className="warn">
          Not in the bestiary. Max HP:{' '}
          <input type="number" className="narrow" value={c.maxHp ?? ''} onChange={(e) => onChange((x) => ({ ...x, maxHp: e.target.value === '' ? undefined : Number(e.target.value) }))} />
        </p>
      )}

      <div className="stats">
        <Stat label="AC" value={beast?.ac ?? '–'} />
        <Stat label="Speed" value={beast?.speed || '–'} />
        <SavePicker save={save} saves={beast?.saves} onPick={onSave} />
        <Stat label="Init" value={fmtMod(beast?.init)} />
        <Stat label="CR" value={fmtCr(beast?.cr)} />
      </div>

      <div className="hp">
        <div className="hp-num"><strong>{cur}</strong> / {max || '?'}</div>
        <div className="bar"><span style={{ width: `${pct * 100}%` }} /></div>
      </div>

      <form className="dmg" onSubmit={(e) => { e.preventDefault(); apply(1); }}>
        <input type="number" inputMode="numeric" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="danger">Damage</button>
        <button type="button" onClick={() => apply(-1)}>Heal</button>
      </form>

      {c.damage?.length > 0 && (
        <div className="log">
          {c.damage.map((n, i) => (
            <button key={i} className={`chip ${n < 0 ? 'heal' : ''}`} title="Remove this entry" onClick={() => onChange((x) => ({ ...x, damage: x.damage.filter((_, j) => j !== i) }))}>
              {n < 0 ? `+${-n}` : `−${n}`}
            </button>
          ))}
        </div>
      )}

      {beast && (
        <>
          <ul className="attacks">
            {beast.attacks.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
          {(beast.special || beast.url) && (
            <div className="special">
              {beast.special && (
                <p className={open ? '' : 'clamp'} onClick={() => setOpen(!open)}>{beast.special}</p>
              )}
              {beast.url && <a href={beast.url} target="_blank" rel="noreferrer">Full stat block ↗</a>}
            </div>
          )}
        </>
      )}
    </article>
  );
}

// The save pill on a card: tap it to pick which save every card in this battle shows.
function SavePicker({ save, saves, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="stat save-pick" ref={ref}>
      <button type="button" className="stat-btn" aria-haspopup="listbox" aria-expanded={open} title="Change save" onClick={() => setOpen(!open)}>
        <span className="label">{save?.toUpperCase()} save</span>
        <span className="value">{fmtMod(saves?.[save])}</span>
      </button>
      {open && (
        <ul className="save-menu" role="listbox">
          {SAVES.map((s) => (
            <li key={s}>
              <button type="button" role="option" aria-selected={s === save} className={s === save ? 'on' : ''} onClick={() => { onPick(s); setOpen(false); }}>
                <span>{s.toUpperCase()}</span>
                <span>{fmtMod(saves?.[s])}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

// Saves on blur or Enter, so the list doesn't re-sort (and move the box) mid-number.
function InitInput({ c, onCommit }) {
  const [draft, setDraft] = useState(c.init ?? '');
  useEffect(() => setDraft(c.init ?? ''), [c.init]);
  const commit = () => {
    const init = draft === '' ? null : Number(draft);
    if (init !== (c.init ?? null)) onCommit(init);
  };
  return (
    <input
      type="number"
      className="narrow"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
      aria-label={`Initiative for ${c.name}`}
    />
  );
}

function Initiative({ battle, beasts, state, setBattle, setCombatant }) {
  const order = initiativeOrder(battle.combatants, beasts);
  const waiting = battle.combatants.filter((c) => !order.includes(c));
  const [player, setPlayer] = useState('');

  const step = (dir) =>
    setBattle((b) => {
      const ord = initiativeOrder(b.combatants, beasts).filter((c) => !(c.kind === 'monster' && currentHp(c, beasts) <= 0 && maxHp(c, beasts)));
      if (!ord.length) return b;
      const i = ord.findIndex((c) => c.id === b.turn);
      if (i === -1) return { ...b, turn: ord[0].id, round: b.round || 1 };
      let j = i + dir;
      let round = b.round || 1;
      if (j >= ord.length) { j = 0; round += 1; }
      if (j < 0) { j = ord.length - 1; round = Math.max(1, round - 1); }
      return { ...b, turn: ord[j].id, round };
    });

  const rollMonsters = () =>
    setBattle((b) => ({
      ...b,
      combatants: b.combatants.map((c) => (c.kind === 'monster' && (c.init === null || c.init === undefined || c.init === '') ? { ...c, init: d(20) + initMod(c, beasts) } : c)),
    }));

  const row = (c) => (
    <li key={c.id} className={`${c.kind} ${battle.turn === c.id ? 'current' : ''}`}>
      <InitInput c={c} onCommit={(init) => setCombatant(c.id, (x) => ({ ...x, init }))} />
      <span className="who">
        {c.kind === 'monster' ? c.mask || c.name : c.name}
        {c.kind === 'monster' && c.mask && <span className="muted"> ({c.name})</span>}
      </span>
      {c.kind === 'monster' ? <span className="muted small">{currentHp(c, beasts)} hp</span> : (
        <button className="icon" title="Remove player" onClick={() => setBattle((b) => ({ ...b, combatants: b.combatants.filter((x) => x.id !== c.id) }))}>✕</button>
      )}
    </li>
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Initiative</h2>
        <span className="muted">Round {battle.round || 1}</span>
      </div>
      <div className="btn-row">
        <button onClick={() => step(-1)}>◀ Prev</button>
        <button className="primary" onClick={() => step(1)}>{battle.turn ? 'Next turn ▶' : 'Start ▶'}</button>
        <button onClick={rollMonsters} title="d20 + init for monsters without a roll">Roll monsters</button>
      </div>
      <ol className="init-list">{order.map(row)}</ol>
      {waiting.length > 0 && (
        <>
          <h4 className="muted">No initiative yet</h4>
          <ul className="init-list">{waiting.map(row)}</ul>
        </>
      )}
      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!player.trim()) return;
          setBattle((b) => ({ ...b, combatants: [...b.combatants, { id: uid('p'), kind: 'player', name: player.trim(), damage: [], init: null }] }));
          setPlayer('');
        }}
      >
        <input list="party-names" placeholder="Add player or NPC…" value={player} onChange={(e) => setPlayer(e.target.value)} />
        <button>Add</button>
        <datalist id="party-names">{state.party.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      </form>
      <div className="btn-row">
        <button onClick={() => setBattle((b) => ({ ...b, combatants: b.combatants.map((c) => ({ ...c, init: null })), turn: null, round: 1 }))}>Clear initiative</button>
      </div>
    </div>
  );
}

function XpPanel({ battle, beasts, setBattle }) {
  const x = xpSummary(battle, beasts);
  return (
    <div className="panel">
      <h2>Encounter</h2>
      <label className="field">
        Save shown on cards
        <select value={battle.save} onChange={(e) => setBattle((b) => ({ ...b, save: e.target.value }))}>
          {SAVES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
        </select>
      </label>
      <label className="field">
        Party size
        <input type="number" min="1" className="narrow" value={battle.partySize ?? ''} onChange={(e) => setBattle((b) => ({ ...b, partySize: Number(e.target.value) || 1 }))} />
      </label>
      <dl className="kv">
        <dt>Total XP</dt><dd>{x.total.toLocaleString()}</dd>
        <dt>XP per player</dt><dd>{Math.round(x.perPlayer).toLocaleString()}</dd>
        <dt>Scale</dt><dd>×{x.scale.toFixed(2)}</dd>
        <dt>XP award (each)</dt><dd><strong>{x.award.toLocaleString()}</strong></dd>
        <dt>Enemy HP left</dt><dd>{x.remaining}</dd>
      </dl>
      <label className="field">
        Party damage / round
        <input type="number" min="0" className="narrow" value={battle.partyDamage ?? ''} onChange={(e) => setBattle((b) => ({ ...b, partyDamage: e.target.value === '' ? null : Number(e.target.value) }))} />
      </label>
      {x.rounds !== null && <p className="muted">About {x.rounds.toFixed(1)} rounds left.</p>}
    </div>
  );
}
