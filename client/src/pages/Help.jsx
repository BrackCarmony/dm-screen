import React from 'react';

// Getting-started guide. Opens after sign-up and from the ? in the top bar.
export default function Help({ user, mcp }) {
  const link = `${window.location.origin}/p/${user.slug}`;
  return (
    <div className="page narrow-page help">
      <h1>Getting started</h1>
      <p className="muted">A quick tour of running a fight with DM Screen. Come back any time with the <strong>?</strong> in the top bar.</p>

      <section className="panel">
        <h2><span className="step">1</span> Add your party</h2>
        <p>
          Open the <a href="#party">Party</a> tab and add your players, plus any NPCs or pets who fight alongside them.
          Everyone marked <em>In party</em> joins new battles automatically and counts toward the party size used for XP.
        </p>
        <p className="muted small">If the party changes later, a battle shows an <em>Update battle</em> button to bring it up to date.</p>
      </section>

      <section className="panel">
        <h2><span className="step">2</span> Set up a fight</h2>
        <p>Either way works:</p>
        <ul>
          <li>
            <strong>Plan ahead:</strong> on the <a href="#encounters">Encounters</a> tab, click <em>New encounter</em> and pick monsters from the bestiary.
            When it's time to fight, click <em>Start battle</em>. You start with a few example encounters to try.
          </li>
          <li>
            <strong>On the spot:</strong> on the <a href="#battle">Battle</a> tab, click <em>New</em>, then use <em>Add monster…</em> to drop monsters in.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2><span className="step">3</span> Run the battle</h2>
        <ul>
          <li>Click <em>Roll monsters</em> to roll their initiative, and type in your players' rolls.</li>
          <li>Use <em>Start</em> and <em>Next turn</em> to move through the order. The current turn is highlighted.</li>
          <li>Each monster card tracks damage and healing, and shows its AC, saves and attacks.</li>
          <li>
            Give a monster a <em>Name shown to players</em> (say, "Hooded figure") to keep what it is a secret,
            or hide it from players entirely with 👁.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2><span className="step">4</span> Let your players follow along</h2>
        <p>Click <em>Show to players</em> on a battle. Your player view then shows that battle's initiative order, live, two ways:</p>
        <ul>
          <li><strong>Share it:</strong> send your players this link to open on their phones or laptops: <a href={link} target="_blank" rel="noreferrer">{link}</a></li>
          <li><strong>Show it:</strong> open <em>Player view ↗</em> from the top bar on a TV or second screen at the table.</li>
        </ul>
        <p className="muted small">
          Players see names, turn order and a rough health bar for each monster, never its stats or hit points.
          You can change the link on the <a href="#account">Account</a> page.
        </p>
      </section>

      <section className="panel">
        <h2>Make it yours</h2>
        <ul>
          <li>
            <strong><a href="#bestiary">Bestiary</a>:</strong> starts with the monsters from the D&amp;D 5e System Reference Document.
            Add your own with <em>New monster</em>, or edit any of them to match your table.
          </li>
          <li>
            <strong><a href="#shop">Magic Shop</a>:</strong> roll a shop's stock from the major and minor item tables under a gold budget, and save the shops your party visits.
            Use <em>Edit items</em> to change what each table can roll.
          </li>
          {mcp && (
            <li>
              <strong><a href="#account/ai-apps">AI apps</a>:</strong> connect Claude or another AI app that supports MCP, and it can look up
              your monsters, battles and encounters, and add new monsters and encounter tables when you ask.
            </li>
          )}
          <li>
            <strong><a href="#feedback">Feedback</a>:</strong> something confusing, missing or broken? Tell us there. You'll see when it's been looked at.
          </li>
        </ul>
      </section>

      <p><a className="button primary" href="#party">Start with your party →</a></p>
    </div>
  );
}
