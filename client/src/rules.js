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
