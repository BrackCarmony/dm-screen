import React, { useState } from 'react';

export default function Party({ state, update }) {
  const [name, setName] = useState('');
  const set = (id, patch) => update('party', (all) => all.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const levelled = state.party.some((p) => p.inParty && p.level);
  const levelUp = () => update('party', (all) => all.map((p) => (p.inParty && p.level ? { ...p, level: Math.min(20, p.level + 1) } : p)));
  return (
    <div className="page narrow-page">
      <div className="toolbar">
        <p className="muted">
          Players marked "In party" are added to new battles and count toward party size. Their levels set how hard encounters
          are rated; leave a pet's or NPC's level blank to leave it out.
        </p>
        <span className="spacer" />
        {/* Always shown, so setting the first level doesn't push the list down mid-typing. */}
        <button onClick={levelUp} disabled={!levelled} title="Add 1 to the level of everyone in the party who has one">Level up</button>
      </div>
      <ul className="party">
        {state.party.map((p) => (
          <li key={p.id}>
            <input value={p.name} onChange={(e) => set(p.id, { name: e.target.value })} />
            <label className="level">
              Level
              <input type="number" min="1" max="20" className="narrow" value={p.level ?? ''}
                onChange={(e) => set(p.id, { level: e.target.value === '' ? null : Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} />
            </label>
            <label className="check"><input type="checkbox" checked={p.inParty} onChange={(e) => set(p.id, { inParty: e.target.checked })} /> In party</label>
            <button className="icon" title="Remove" onClick={() => confirm(`Remove ${p.name}?`) && update('party', (all) => all.filter((x) => x.id !== p.id))}>✕</button>
          </li>
        ))}
      </ul>
      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const next = Math.max(0, ...state.party.map((p) => Number(p.id.replace(/\D/g, '')) || 0)) + 1;
          update('party', (all) => [...all, { id: `P${String(next).padStart(2, '0')}`, name: name.trim(), inParty: true }]);
          setName('');
        }}
      >
        <input placeholder="Add player, NPC or pet…" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary">Add</button>
      </form>
    </div>
  );
}
