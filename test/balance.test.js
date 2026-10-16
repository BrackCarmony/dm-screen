import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRS, calibrate, crIndex, grade, offense, parseAction, srdTable } from '../evals/balance.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srd = JSON.parse(fs.readFileSync(path.join(root, 'data', 'seed', 'bestiary.json'), 'utf8'));
const dpr = (...attacks) => offense({ attacks, special: '' }).dpr;

test('attack lines: bonus, save DC, average damage with riders, the first of "or" alternatives', () => {
  assert.deepEqual(parseAction('Longsword +5 1d8+3 slashing or 1d10+3 slashing'), { name: 'Longsword', bonus: 5, dc: null, damage: 7.5, recharge: false });
  assert.equal(parseAction('Warhammer +5 1d8+3 bludgeoning + 1d6 fire').damage, 11);
  assert.deepEqual(parseAction('Fire Breath (Recharge 5-6) DC17 Dex 16d6 fire, half on save'), { name: 'Fire Breath', bonus: null, dc: 17, damage: 56, recharge: true });
});

test('damage per round: compact and prose multiattacks, alternatives, and a breath weapon over three rounds', () => {
  assert.equal(dpr('Multiattack: Bite, 2× Claw', 'Bite +6 1d10+4 piercing', 'Claw +6 1d6+4 slashing'), 9.5 + 2 * 7.5);
  assert.equal(dpr('Multiattack: 3× Jolt or 3× Headbutt', 'Headbutt +9 2d8+5 bludgeoning', 'Jolt +9 60ft 2d10+5 lightning'), 3 * 16);
  assert.equal(dpr('Multiattack: 3× Punch (can replace one with Stomp)', 'Punch +8 2d8+4 bludgeoning'), 3 * 13);
  assert.equal(dpr('Multiattack: The devil makes three melee attacks: one with its tail and two with its claws.', 'Claw +6 1d6+3 piercing', 'Tail +6 2d6+3 piercing'), 10 + 2 * 6.5);
  assert.equal(dpr('Bite +4 1d6+2 piercing', 'Cold Breath (Recharge 5-6) DC12 Dex 4d8 cold'), (18 + 2 * 5.5) / 3);
});

test('a monster passes when its defense and offense each fit its CR, and is "unsure" when it can\'t be judged', () => {
  const table = srdTable();
  const ogre = srd.find((m) => m.name === 'Ogre');
  assert.equal(grade(ogre, table).verdict, 'pass');
  // The same ogre claiming CR 10: its numbers don't support it, and the grader says which ones.
  const proud = grade({ ...ogre, cr: 10 }, table);
  assert.equal(proud.verdict, 'fail');
  assert.match(proud.problems.join(' '), /HP 59 .* looks like CR \d/);
  assert.equal(grade({ ...ogre, special: 'Spells (DC 12, +4): fire bolt' }, table).verdict, 'unsure');
  assert.equal(grade({ ...ogre, cr: 20 }, table).verdict, 'unsure');
  assert.equal(grade({ ...ogre, attacks: ['Glare'] }, table).verdict, 'unsure');
});

// A guard on the grader itself: each SRD monster graded against a table learned without it. If a change to
// the grader makes this worse, the change is wrong, however good it looks on a few examples.
test('held out of calibration, ordinary SRD monsters up to CR 10 mostly pass and land near their CR', () => {
  const graded = srd.map((m, i) => grade(m, calibrate(srd.filter((_, j) => j !== i)))).filter((g) => g.verdict !== 'unsure');
  const pass = graded.filter((g) => g.verdict === 'pass').length / graded.length;
  const near = graded.filter((g) => Math.abs(g.delta) <= 1).length / graded.length;
  const bias = graded.reduce((s, g) => s + g.delta, 0) / graded.length;
  assert.ok(graded.length > 200, `${graded.length} judged`);
  assert.ok(pass >= 0.9, `pass rate ${pass}`);
  assert.ok(near >= 0.8, `within one step ${near}`);
  assert.ok(Math.abs(bias) < 0.5, `bias ${bias} steps`);
});

test('the CR ladder', () => {
  assert.equal(CRS.length, 34);
  assert.deepEqual([0, 0.125, 0.3, 1, 30].map(crIndex), [0, 1, 2, 4, 33]);
});
