import React from 'react';
import { fmtCr } from '../rules.js';

export default function Reference({ state }) {
  const { levels, cr } = state.xp;
  return (
    <div className="page ref-grid">
      <section>
        <h2>Character advancement</h2>
        <table className="data">
          <thead><tr><th>Level</th><th>XP</th><th>Prof</th></tr></thead>
          <tbody>{levels.map((l) => <tr key={l.level}><td>{l.level}</td><td>{l.xp.toLocaleString()}</td><td>+{l.prof}</td></tr>)}</tbody>
        </table>
      </section>
      <section>
        <h2>XP by challenge rating</h2>
        <table className="data">
          <thead><tr><th>CR</th><th>XP</th></tr></thead>
          <tbody>{cr.map((c) => <tr key={c.cr}><td>{fmtCr(c.cr)}</td><td>{c.xp.toLocaleString()}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}
