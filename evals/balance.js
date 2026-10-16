// Is a monster's challenge rating right for its numbers? A deterministic grader for the monster generator's
// evals: no model calls, so it costs nothing to run.
//
// It follows the 5e approach: a defensive CR from hit points (nudged by armor class) and an offensive CR from
// damage per round (nudged by attack bonus or save DC), averaged. What each CR should look like is learned from
// the SRD bestiary in data/seed (334 monsters with published CRs), not copied from a rulebook table.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CRS = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)];
export const crIndex = (cr) => CRS.reduce((best, c, i) => (Math.abs(c - cr) < Math.abs(CRS[best] - cr) ? i : best), 0);
export const fmtCr = (cr) => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' })[cr] ?? String(cr);

const DICE = /(\d+)d(\d+)(?:\s*([+-])\s*(\d+)(?!d))?/gi;
const avgDice = (text) => {
  let total = 0;
  for (const [, n, sides, sign, mod] of text.matchAll(DICE)) {
    total += (Number(n) * (Number(sides) + 1)) / 2 + (mod ? (sign === '-' ? -1 : 1) * Number(mod) : 0);
  }
  return total;
};
const key = (name) => name.toLowerCase().replace(/[^a-z]/g, '').replace(/e?s$/, '');

// One attack line, e.g. "Longsword +5 1d8+3 slashing or 1d10+3 slashing" or "Fire Breath (Recharge 5-6) DC17 Dex 16d6 fire".
export function parseAction(line) {
  const name = line.split(/\s+(?:[+-]\d|DC\s?\d|\(|\d+d\d)/i)[0].replace(/:$/, '').trim();
  const bonus = line.match(/^[^\d(]*?\s([+-]\d+)\b/)?.[1];
  const dc = line.match(/DC\s?(\d+)/i)?.[1];
  // "or" separates alternatives (two-handed, a different form): count the first. Riders ("+ 1d6 fire") add.
  const damage = avgDice(line.split(/\sor\s/i)[0]);
  return {
    name,
    bonus: bonus === undefined ? null : Number(bonus),
    dc: dc === undefined ? null : Number(dc),
    damage,
    recharge: /recharge|\/day/i.test(line),
  };
}

// "Multiattack: Bite, 2× Claw" -> [[['Bite', 1], ['Claw', 2]]]. Alternatives ("3× Jolt or 3× Headbutt") are
// separate routines; notes in parentheses ("3× Punch (can replace one with Stomp)") are dropped.
const parseMultiattack = (line) => line.replace(/^multi(attack)?:?/i, '').replace(/\([^)]*\)/g, '').split(/,?\s+or\s+/i)
  .map((routine) => routine.split(/,|\band\b/).map((part) => {
    const m = part.trim().match(/^(?:(\d+)\s*[×x]\s*)?(.+)$/i);
    return m && m[2] ? [m[2].trim(), Number(m[1] ?? 1)] : null;
  }).filter(Boolean));

// The same from prose, as many SRD monsters write it: "makes three melee attacks: one with its tail and two
// with its claws", "makes two longsword attacks or two longbow attacks". Each "or" (or "Alternatively") starts
// another option; a number word up to three words before an attack's name is how many of that attack.
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const proseMultiattack = (line, actions) => line.split(/\.\s*alternatively|\sor\s/i).map((option) => actions.map((a) => {
  const m = option.match(new RegExp(`\\b(one|two|three|four|five|six|\\d+)\\s+(?:\\w+\\s+){0,3}?${escape(a.name.toLowerCase())}`, 'i'));
  return m ? [a.name, NUMBERS[m[1].toLowerCase()] ?? Number(m[1])] : null;
}).filter(Boolean));

// What a monster does in a round, from its attack lines and special text.
export function offense(monster) {
  const lines = monster.attacks ?? [];
  const multi = lines.find((l) => /^multi/i.test(l));
  const actions = lines.filter((l) => l !== multi).map(parseAction);
  const byName = new Map(actions.map((a) => [key(a.name), a]));
  const routineActions = actions.filter((a) => !a.recharge && a.damage > 0);
  let routine = Math.max(0, ...routineActions.map((a) => a.damage));
  let used = routineActions.filter((a) => a.damage === routine).slice(0, 1);
  const options = !multi ? [] : /\d\s*[×x]\s/i.test(multi) || !/\b(one|two|three|four|five|six)\b/i.test(multi) ? parseMultiattack(multi) : proseMultiattack(multi, actions);
  for (const option of options) {
    const parts = option.map(([name, count]) => [byName.get(key(name)), count]).filter(([a]) => a);
    const total = parts.reduce((s, [a, count]) => s + a.damage * count, 0);
    if (total > routine) { routine = total; used = parts.map(([a]) => a); }
  }
  // A recharge ability (a breath weapon) is used about once in a three-round fight.
  const burst = Math.max(0, ...actions.filter((a) => a.recharge).map((a) => a.damage));
  const dpr = burst > routine ? (burst + 2 * routine) / 3 : routine;
  const bonuses = (used.length ? used : actions).map((a) => a.bonus).filter((b) => b !== null);
  const dcs = [...actions.map((a) => a.dc), ...[...String(monster.special ?? '').matchAll(/DC\s?(\d+)/gi)].map((m) => Number(m[1]))].filter((x) => x !== null);
  return {
    dpr,
    bonus: bonuses.length ? Math.max(...bonuses) : null,
    dc: dcs.length ? Math.max(...dcs) : null,
  };
}

// Spells and legendary actions add power that attack lines don't show, so these are estimated less reliably,
// and are left out when learning what each CR looks like.
// Above this, the SRD has 10 ordinary monsters in all (one or two per CR), and the grader agrees with fewer
// than half of their published CRs, so stronger monsters get "unsure" rather than pass or fail.
export const WELL_SAMPLED_CR = 10;
// A monster passes when its defense and its offense each look within this many steps of its CR. Steps are
// along the CR ladder (0, 1/8, 1/4, 1/2, 1, 2, ...). Ordinary SRD monsters up to CR 10 pass 95-97% of the time.
export const PASS_STEPS = 3;
// When the DM asks for a lopsided monster (a tank, a glass cannon), defense and offense are meant to be far
// apart, so it passes when their average, 5e's own CR, is within this many steps instead.
export const LOPSIDED_STEPS = 2;

export function unreliable(monster) {
  const text = `${monster.special ?? ''} ${(monster.attacks ?? []).join(' ')}`;
  return [/spellcasting|\bspells\s*(\(DC|:)/i.test(text) && 'casts spells', /(?<!non-)legendary/i.test(text) && 'has legendary actions'].filter(Boolean);
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Expected HP, AC, damage per round, attack bonus and save DC at each CR, learned from ordinary monsters
// with known CRs (not spellcasters or legendary monsters: see unreliable). A CR with monsters uses their
// median; a CR with none (18, and 20 up) comes from a straight line fitted to CR 5 and up, since 5e's numbers
// grow about linearly with CR. Nothing is lower than the CR below it. The defaults scored best on the SRD
// with each monster held out of its own calibration (see test/balance.test.js).
export function calibrate(monsters, { enough = 1, fitFrom = 5 } = {}) {
  const rows = monsters.filter((m) => !unreliable(m).length).map((m) => ({ cr: CRS[crIndex(m.cr)], hp: m.hp, ac: m.ac, ...offense(m) }));
  const curve = (stat) => {
    const values = CRS.map((cr) => rows.filter((r) => r.cr === cr && r[stat] !== null && r[stat] > 0).map((r) => r[stat]));
    const points = CRS.map((cr, i) => ({ cr, xs: values[i] })).filter((p) => p.cr >= fitFrom && p.xs.length)
      .map((p) => ({ cr: p.cr, y: median(p.xs), w: Math.sqrt(p.xs.length) }));
    const W = points.reduce((s, p) => s + p.w, 0);
    const mx = points.reduce((s, p) => s + p.w * p.cr, 0) / W;
    const my = points.reduce((s, p) => s + p.w * p.y, 0) / W;
    const slope = points.reduce((s, p) => s + p.w * (p.cr - mx) * (p.y - my), 0) / points.reduce((s, p) => s + p.w * (p.cr - mx) ** 2, 0);
    const at = CRS.map((cr, i) => (values[i].length >= enough ? median(values[i]) : cr >= 1 ? my + slope * (cr - mx) : null));
    const first = at.find((v) => v !== null);
    for (let i = 0; i < at.length; i++) at[i] = Math.max(at[i] ?? first, i ? at[i - 1] : 0);
    return at;
  };
  return { hp: curve('hp'), ac: curve('ac'), dpr: curve('dpr'), bonus: curve('bonus'), dc: curve('dc') };
}

// The CR index whose expected value is closest, comparing ratios (HP 30 vs 60 is as far as 60 vs 120).
const nearest = (curve, value) => curve.reduce((best, v, i) => (Math.abs(Math.log(value / v)) < Math.abs(Math.log(value / curve[best])) ? i : best), 0);
const clamp = (i) => Math.max(0, Math.min(CRS.length - 1, i));

// Grade one monster: the CR its numbers suggest, how far that is from the CR it claims, and why.
// lopsided: the request asked for defense and offense to be uneven (see LOPSIDED_STEPS).
export function grade(monster, table, { lopsided = false } = {}) {
  const claimed = crIndex(Number(monster.cr) || 0);
  const off = offense(monster);
  const problems = [];

  // Defense: HP picks a CR; every 2 AC above or below what that CR expects moves it one step.
  const hpAt = nearest(table.hp, Math.max(1, monster.hp));
  const defensive = clamp(hpAt + Math.trunc((monster.ac - table.ac[hpAt]) / 2));

  // Offense: damage per round picks a CR; attack bonus (or save DC, when it only has saves) nudges it.
  let offensive = null;
  if (off.dpr > 0) {
    const dprAt = nearest(table.dpr, off.dpr);
    const nudge = off.bonus !== null ? off.bonus - table.bonus[dprAt] : off.dc !== null ? off.dc - table.dc[dprAt] : 0;
    offensive = clamp(dprAt + Math.trunc(nudge / 2));
  }

  const estimated = offensive === null ? defensive : Math.round((defensive + offensive) / 2);
  const delta = estimated - claimed;
  const say = (what, i) => `${what} looks like CR ${fmtCr(CRS[i])}`;
  const defenseOff = !lopsided && Math.abs(defensive - claimed) > PASS_STEPS;
  const offenseOff = !lopsided && offensive !== null && Math.abs(offensive - claimed) > PASS_STEPS;
  const averageOff = lopsided && Math.abs(delta) > LOPSIDED_STEPS;
  if (defenseOff) problems.push(say(`HP ${monster.hp} with AC ${monster.ac}`, defensive));
  if (offenseOff) problems.push(say(`about ${Math.round(off.dpr)} damage a round${off.bonus !== null ? ` at +${off.bonus}` : ''}`, offensive));
  if (averageOff) problems.push(say(`Defense and offense together (asked to be lopsided)`, estimated));

  const caveats = unreliable(monster);
  if (CRS[claimed] > WELL_SAMPLED_CR) caveats.push(`too few SRD monsters above CR ${WELL_SAMPLED_CR} to judge`);
  if (offensive === null) caveats.push('no damage found in its attacks');
  return {
    name: monster.name,
    // pass: defense and offense each fit the CR. unsure: a caveat applies, so it isn't counted either way.
    verdict: caveats.length ? 'unsure' : defenseOff || offenseOff || averageOff ? 'fail' : 'pass',
    reliable: caveats.length === 0,
    caveats, // why it can't be judged: spells, legendary actions, a CR above WELL_SAMPLED_CR, no damage to read
    claimed: CRS[claimed],
    estimated: CRS[estimated],
    defensive: CRS[defensive],
    offensive: offensive === null ? null : CRS[offensive],
    delta, // in steps of the CR ladder (0, 1/8, 1/4, 1/2, 1, 2, ...)
    dpr: Math.round(off.dpr * 10) / 10,
    problems,
  };
}

// The table learned from the SRD bestiary that ships with the app.
export function srdTable() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return calibrate(JSON.parse(fs.readFileSync(path.join(root, 'data', 'seed', 'bestiary.json'), 'utf8')));
}
