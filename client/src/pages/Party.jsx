import React, { useState } from 'react';

export default function Party({ state, update }) {
  const [name, setName] = useState('');
  const set = (id, patch) => update('party', (all) => all.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return (
    <div className="page narrow-page">
      <p className="muted">Players marked "In party" are added to new battles and count toward party size.</p>
      <ul className="party">
        {state.party.map((p) => (
          <li key={p.id}>
            <input value={p.name} onChange={(e) => set(p.id, { name: e.target.value })} />
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
