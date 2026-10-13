import React, { useState } from 'react';
import { uid } from '../rules.js';

// Mirrors the Magic Shops Tool: each table scales its prices, keeps the items at or
// under the gold target, and rolls random picks from those.
export default function Shop({ state, update }) {
  const shop = state.shop;
  const [rolled, setRolled] = useState({});
  const setShop = (fn) => update('shop', fn);
  const setTable = (id, patch) => setShop((s) => ({ ...s, tables: s.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  function roll(t) {
    const pool = affordable(t);
    const picks = [];
    for (let i = 0; i < Math.min(t.rolls, pool.length); i++) picks.push(pool[Math.floor(Math.random() * pool.length)]);
    setRolled({ ...rolled, [t.id]: picks });
  }

  function saveShop() {
    const items = Object.values(rolled).flat();
    if (!items.length) return;
    const name = prompt('Name this shop', 'New shop');
    if (!name) return;
    setShop((s) => ({ ...s, saved: [{ id: uid('shop'), name, items }, ...s.saved] }));
    setRolled({});
  }

  return (
    <div className="page">
      {shop.note && <p className="muted">{shop.note}</p>}
      <div className="shop-grid">
        {shop.tables.map((t) => {
          const pool = affordable(t);
          return (
            <section key={t.id} className="panel">
              <h2>{t.name}</h2>
              <div className="form-row">
                <label>Gold target<input type="number" value={t.goldTarget} onChange={(e) => setTable(t.id, { goldTarget: Number(e.target.value) || 0 })} /></label>
                <label>Price ×<input type="number" step="any" className="narrow" value={t.multiplier} onChange={(e) => setTable(t.id, { multiplier: Number(e.target.value) || 1 })} /></label>
                <label>Items<input type="number" min="0" className="narrow" value={t.rolls} onChange={(e) => setTable(t.id, { rolls: Number(e.target.value) || 0 })} /></label>
              </div>
              <p className="muted small">{pool.length} of {t.items.length} items fit the target.</p>
              <button className="primary" onClick={() => roll(t)}>Roll</button>
              {rolled[t.id] && (
                <ul className="items">
                  {rolled[t.id].map((it, i) => <li key={i}><span>{it.name}</span><span>{it.price.toLocaleString()} gp</span></li>)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {Object.values(rolled).some((r) => r.length) && <button className="primary" onClick={saveShop}>Save rolled items as a shop</button>}

      <h2>Shops</h2>
      <div className="shop-grid">
        {shop.saved.map((s) => (
          <section key={s.id} className="panel">
            <div className="panel-head">
              <h3>{s.name}</h3>
              <button className="icon" title="Delete shop" onClick={() => confirm(`Delete ${s.name}?`) && setShop((x) => ({ ...x, saved: x.saved.filter((y) => y.id !== s.id) }))}>✕</button>
            </div>
            <ul className="items">
              {s.items.map((it, i) => (
                <li key={i}>
                  <span>{it.name}</span>
                  <span>
                    {it.price?.toLocaleString()} gp{' '}
                    <button className="icon" title="Sold / remove" onClick={() => setShop((x) => ({ ...x, saved: x.saved.map((y) => (y.id === s.id ? { ...y, items: y.items.filter((_, j) => j !== i) } : y)) }))}>✕</button>
                  </span>
                </li>
              ))}
            </ul>
            <AddItem onAdd={(it) => setShop((x) => ({ ...x, saved: x.saved.map((y) => (y.id === s.id ? { ...y, items: [...y.items, it] } : y)) }))} />
          </section>
        ))}
      </div>
    </div>
  );
}

function affordable(t) {
  return t.items
    .map((it) => ({ ...it, price: Math.round(it.price * t.multiplier) }))
    .filter((it) => it.price <= t.goldTarget);
}

function AddItem({ onAdd }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  return (
    <form className="add-row" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; onAdd({ name: name.trim(), price: Number(price) || 0 }); setName(''); setPrice(''); }}>
      <input placeholder="Item" value={name} onChange={(e) => setName(e.target.value)} />
      <input type="number" placeholder="gp" className="narrow" value={price} onChange={(e) => setPrice(e.target.value)} />
      <button>Add</button>
    </form>
  );
}
