import test from 'node:test';
import assert from 'node:assert/strict';
import { difficulty, expandSpecial, fmtRange, partyLevels, rollParts, rollTable, xpTargets } from '../client/src/rules.js';

test('passive Perception is spelled out for display, and nothing else changes', () => {
  assert.equal(expandSpecial('Keen Sight and Smell. Darkvision 60 ft., PP 13'), 'Keen Sight and Smell. Darkvision 60 ft., Passive Perception 13');
  assert.equal(expandSpecial('Mgc Resis, dark 60 pperp 17 Sv'), 'Mgc Resis, dark 60 Passive Perception 17 Sv');
  // Only the abbreviation next to a number: words containing "pp" and a lone "PP" are left alone.
  assert.equal(expandSpecial('Ripples app 3. PP? Upper 12'), 'Ripples app 3. PP? Upper 12');
  assert.equal(expandSpecial(undefined), '');
});

test('encounter difficulty adds up each character\'s thresholds and applies the monster multiplier', () => {
  const four = [1, 1, 1, 1]; // easy 100, medium 200, hard 300, deadly 400
  assert.equal(difficulty([50], four), 'Trivial');
  assert.equal(difficulty([50, 50], four), 'Easy'); // 100 × 1.5
  assert.equal(difficulty([50, 50, 50, 50], four), 'Deadly'); // 200 × 2
  assert.equal(difficulty([450], [5, 3]), 'Easy'); // easy 250 + 75
  assert.deepEqual(xpTargets([25, 0]), [2825, 5750, 8575, 12800]); // levels clamp to 1-20
  assert.equal(difficulty([], four), null);
  assert.equal(difficulty([50], []), null);
  assert.equal(difficulty([50, undefined], four), null); // a monster not in the bestiary
  // Pets and NPCs without a level, and anyone out of the party, don't count.
  assert.deepEqual(partyLevels([{ inParty: true, level: 4 }, { inParty: true }, { inParty: true, level: null }, { inParty: false, level: 9 }]), [4]);
});

test('a group rolls from 1 to its weights\' total, and weight 0 is off the table', () => {
  const list = [
    { id: 'a', name: 'Wolves', weight: 2 },
    { id: 'b', name: 'Done already', weight: 0 },
    { id: 'c', name: 'Bandits' }, // no weight: 1
    { id: 'd', name: '7-9: Owlbear' }, // saved before weights: its rolls in the name
    { id: 'e', name: '3-4: Trolls', weight: 1 }, // a weight set later wins over the name
  ];
  const { ranges, total } = rollTable(list);
  assert.equal(total, 7);
  assert.deepEqual(list.map((e) => fmtRange(ranges.get(e.id))), ['1-2', '–', '3', '4-6', '7']);
  assert.deepEqual(rollParts(list[3]), { title: 'Owlbear', weight: 3 });
  assert.deepEqual(rollParts(list[4]), { title: 'Trolls', weight: 1 });
  assert.deepEqual(rollParts({ name: 'Room 12' }), { title: 'Room 12', weight: 1 }); // a number without a colon is just a name
  assert.deepEqual(rollTable([{ id: 'x', name: 'Off', weight: 0 }]).total, 0);
});
