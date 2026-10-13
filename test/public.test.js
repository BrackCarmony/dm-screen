import test from 'node:test';
import assert from 'node:assert/strict';
import { publicView } from '../server/public.js';

const state = {
  bestiary: [{ name: 'orc', hp: 15, init: 1 }, { name: 'troll', hp: 84, init: 1 }],
  settings: { activeBattleId: 'b1' },
  battles: [{
    id: 'b1', name: 'Test', round: 2, turn: 'm2',
    combatants: [
      { id: 'm1', kind: 'monster', name: 'orc', mask: 'Grukk', damage: [5], init: 12 },
      { id: 'm2', kind: 'monster', name: 'troll', damage: [84], init: 15 },
      { id: 'm3', kind: 'monster', name: 'orc', damage: [], init: 3, hidden: true },
      { id: 'p1', kind: 'player', name: 'Ulf', damage: [], init: 12 },
      { id: 'p2', kind: 'player', name: 'Nick', damage: [], init: null },
    ],
  }],
};

test('players see the active battle in initiative order, masked and without hidden monsters', () => {
  const v = publicView(state);
  assert.equal(v.battle, 'Test');
  assert.equal(v.round, 2);
  assert.deepEqual(v.order.map((r) => r.name), ['troll', 'Grukk', 'Ulf']);
  assert.equal(v.order[0].health, 0);
  assert.equal(v.order[1].health, 10 / 15);
  assert.equal(v.order[2].health, undefined);
});

test('no active battle shows nothing', () => {
  assert.deepEqual(publicView({ ...state, settings: { activeBattleId: null } }), { battle: null, order: [] });
});
