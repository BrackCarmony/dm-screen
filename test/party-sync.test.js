import test from 'node:test';
import assert from 'node:assert/strict';
import { syncParty } from '../client/src/rules.js';

const party = [
  { id: 'P01', name: 'Ulf', inParty: true },
  { id: 'P02', name: 'Nick', inParty: false },
  { id: 'P03', name: 'Mira', inParty: true },
];
const player = (name, extra = {}) => ({ id: `c-${name}`, kind: 'player', name, damage: [], init: null, ...extra });

test('a battle that matches the party needs no update', () => {
  const battle = { partySize: 2, combatants: [player('Ulf', { partyId: 'P01' }), player('Mira', { partyId: 'P03' })] };
  assert.equal(syncParty(battle, party).changed, false);
});

test('adds, removes and renames players, keeping initiative, damage, monsters and hand-added players', () => {
  const battle = {
    partySize: 4,
    turn: 'c-Nick',
    combatants: [
      { id: 'm1', kind: 'monster', name: 'Orc', damage: [3] },
      player('Ulfric', { partyId: 'P01', init: 15, damage: [4] }),
      player('nick', { init: 12 }),
      player('Wolf', { adhoc: true, init: 8 }),
      player('Gone', { partyId: 'P99' }),
    ],
  };
  const r = syncParty(battle, party);
  assert.equal(r.changed, true);
  assert.deepEqual(r.added, ['Mira']);
  assert.deepEqual(r.removed, ['nick', 'Gone']);
  assert.deepEqual(r.renamed, [['Ulfric', 'Ulf']]);
  assert.equal(r.partySize, 2);
  const names = r.battle.combatants.map((c) => c.name);
  assert.deepEqual(names, ['Orc', 'Ulf', 'Wolf', 'Mira']);
  const ulf = r.battle.combatants.find((c) => c.name === 'Ulf');
  assert.equal(ulf.init, 15);
  assert.deepEqual(ulf.damage, [4]);
  assert.equal(r.battle.combatants.find((c) => c.name === 'Mira').partyId, 'P03');
  assert.equal(r.battle.turn, null);
  assert.equal(r.battle.partySize, 2);
  assert.equal(syncParty(r.battle, party).changed, false);
});

test('old battles link players to the party by name', () => {
  const r = syncParty({ partySize: 2, combatants: [player('ulf'), player('Mira')] }, party);
  assert.equal(r.changed, true);
  assert.deepEqual(r.renamed, [['ulf', 'Ulf']]);
  assert.ok(r.battle.combatants.every((c) => c.partyId));
});

test('a hand-set party size alone is not a change', () => {
  const battle = { partySize: 6, combatants: [player('Ulf', { partyId: 'P01' }), player('Mira', { partyId: 'P03' })] };
  assert.equal(syncParty(battle, party).changed, false);
});
