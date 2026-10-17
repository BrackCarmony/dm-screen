// Game math lifted from the battle sheet formulas.
export const SAVES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const d = (sides) => 1 + Math.floor(Math.random() * sides);

export const fmtMod = (n) => (n === null || n === undefined || n === '' ? '–' : n >= 0 ? `+${n}` : `${n}`);

export const fmtCr = (cr) => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' })[cr] ?? (cr ?? '–');

// Special text abbreviates passive Perception as "PP 13" (the SRD import, the generator) or "pperp 13" (the
// sheet). Shown spelled out; the stored text is left as it is.
export const expandSpecial = (text) => String(text ?? '').replace(/\b(?:PP|[Pp]perp)\s*(\d+)/g, 'Passive Perception $1');

export function beastMap(bestiary) {
  return new Map(bestiary.map((m) => [m.name, m]));
}

export function maxHp(c, beasts) {
  return c.maxHp ?? beasts.get(c.name)?.hp ?? 0;
}

export function damageTaken(c) {
  return (c.damage ?? []).reduce((a, b) => a + (Number(b) || 0), 0);
}

export function currentHp(c, beasts) {
  return maxHp(c, beasts) - damageTaken(c);
}

export function initMod(c, beasts) {
  return c.kind === 'monster' ? beasts.get(c.name)?.init ?? 0 : c.initMod ?? 0;
}

export function initiativeOrder(combatants, beasts) {
  return combatants
    .filter((c) => c.init !== null && c.init !== undefined && c.init !== '')
    .slice()
    .sort((a, b) => b.init - a.init || initMod(b, beasts) - initMod(a, beasts));
}

// Party Size / XP per Player / Scale / XP Award, as on the sheet.
export function xpSummary(battle, beasts) {
  const monsters = battle.combatants.filter((c) => c.kind === 'monster');
  const total = monsters.reduce((s, c) => s + (beasts.get(c.name)?.xp ?? 0), 0);
  const party = Math.max(1, Number(battle.partySize) || 1);
  const perPlayer = total / party;
  const scale = Math.max(1, monsters.length / party);
  const remaining = monsters.reduce((s, c) => s + Math.max(0, currentHp(c, beasts)), 0);
  const dmg = Number(battle.partyDamage) || 0;
  return {
    total,
    perPlayer,
    scale,
    award: Math.floor(perPlayer * scale),
    remaining,
    rounds: dmg > 0 ? remaining / dmg : null,
  };
}

let seq = 0;
export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// Bring a battle's players in line with the Party tab. Players are linked by partyId (or, for
// battles made before that existed, by name); players added by hand in the battle (adhoc) are left alone.
// Initiative and damage are kept. The party size used for XP follows along, but a hand-set size
// alone doesn't count as a change. Returns the updated battle and what changed.
export function syncParty(battle, party) {
  const byId = new Map(party.map((p) => [p.id, p]));
  const byName = new Map(party.map((p) => [p.name.trim().toLowerCase(), p]));
  const linked = new Set();
  const added = [], removed = [], renamed = [];
  const combatants = [];
  for (const c of battle.combatants) {
    if (c.kind !== 'player' || c.adhoc) { combatants.push(c); continue; }
    const p = c.partyId ? byId.get(c.partyId) : byName.get(c.name.trim().toLowerCase());
    if (!p) {
      if (c.partyId) removed.push(c.name); else combatants.push(c);
    } else if (!p.inParty || linked.has(p.id)) {
      removed.push(c.name);
    } else {
      linked.add(p.id);
      if (p.name !== c.name) renamed.push([c.name, p.name]);
      combatants.push({ ...c, partyId: p.id, name: p.name });
    }
  }
  for (const p of party) {
    if (!p.inParty || linked.has(p.id)) continue;
    added.push(p.name);
    combatants.push({ id: uid('p'), kind: 'player', partyId: p.id, name: p.name, mask: '', damage: [], init: null });
  }
  const partySize = party.filter((p) => p.inParty).length || 4;
  const sizeChanged = battle.partySize !== partySize;
  const changed = added.length > 0 || removed.length > 0 || renamed.length > 0;
  const ids = new Set(combatants.map((c) => c.id));
  return {
    battle: { ...battle, combatants, partySize, turn: ids.has(battle.turn) ? battle.turn : null },
    changed, added, removed, renamed, partySize: sizeChanged ? partySize : null,
  };
}

// ---- Encounter difficulty, by the 5e encounter building rules. ----

// XP thresholds per character, levels 1-20: [easy, medium, hard, deadly].
export const XP_THRESHOLDS = [
  [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100],
  [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700],
];
export const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Deadly'];
// The encounter multiplier for how many monsters there are.
const multiplier = (n) => (n <= 1 ? 1 : n === 2 ? 1.5 : n <= 6 ? 2 : n <= 10 ? 2.5 : n <= 14 ? 3 : 4);
const clampLevel = (l) => Math.min(20, Math.max(1, Math.round(l)));

// The levels of the party members who count toward difficulty: in the party, with a level set (pets and NPCs can go without).
export const partyLevels = (party) => party.filter((p) => p.inParty && Number(p.level) >= 1).map((p) => clampLevel(Number(p.level)));

// The whole party's [easy, medium, hard, deadly] XP: each character's thresholds added up.
export const xpTargets = (levels) => levels.reduce((sum, l) => sum.map((s, i) => s + XP_THRESHOLDS[clampLevel(l) - 1][i]), [0, 0, 0, 0]);

// "Trivial", "Easy", ... "Deadly" for monsters' XP against characters of these levels. Null without either, or when
// a monster's XP is unknown (undefined or null: not in the bestiary), since the rating would be too low.
export function difficulty(xps, levels) {
  if (!xps.length || !levels.length || xps.some((x) => x === undefined || x === null)) return null;
  const adjusted = xps.reduce((s, x) => s + x, 0) * multiplier(xps.length);
  const i = xpTargets(levels).findLastIndex((t) => adjusted >= t);
  return i === -1 ? 'Trivial' : DIFFICULTIES[i];
}

// ---- Random encounter tables: an encounter group is the table. ----
// Each encounter has a weight, how many numbers of the roll it gets (0 keeps it off the table), and the group's
// roll runs from 1 to the weights' total, so removing an encounter shrinks the roll. Encounters saved before
// weights existed have their rolls in the name, like "3-4: Wolf Pack"; that counts as weight 2 and the name
// reads "Wolf Pack".
const ROLL_PREFIX = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*:\s*(.+)$/;
export function rollParts(enc) {
  const m = enc.name.match(ROLL_PREFIX);
  const title = m ? m[3] : enc.name;
  if (enc.weight !== undefined && enc.weight !== null) return { title, weight: Math.max(0, Math.round(Number(enc.weight)) || 0) };
  return { title, weight: m ? Math.max(1, Number(m[2] ?? m[1]) - Number(m[1]) + 1) : 1 };
}

// Each encounter's numbers in its group's roll, in order: { from, to } (null when its weight is 0), and the total.
export function rollTable(encounters) {
  let total = 0;
  const ranges = new Map();
  for (const e of encounters) {
    const { weight } = rollParts(e);
    ranges.set(e.id, weight ? { from: total + 1, to: total + weight } : null);
    total += weight;
  }
  return { ranges, total };
}

// "3" or "3-4".
export const fmtRange = (r) => (r ? (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`) : '–');
