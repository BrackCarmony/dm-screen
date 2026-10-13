// What players are allowed to see: the active battle's initiative order.
export function publicView(state) {
  const battle = state.battles?.find((b) => b.id === state.settings?.activeBattleId);
  if (!battle) return { battle: null, order: [] };
  const beasts = new Map(state.bestiary.map((m) => [m.name, m]));
  const order = sortByInitiative(battle.combatants, beasts)
    .filter((c) => !c.hidden)
    .map((c) => {
      const row = {
        id: c.id,
        name: c.kind === 'monster' ? c.mask || c.name : c.name,
        init: c.init,
        team: c.kind === 'player' ? 'P' : 'M',
      };
      if (c.kind === 'monster') {
        const max = maxHp(c, beasts);
        const cur = currentHp(c, beasts);
        if (max) row.health = cur <= 0 ? 0 : Math.min(1, cur / max);
      }
      return row;
    });
  return { battle: battle.name, round: battle.round ?? 1, turn: battle.turn ?? null, order };
}

export function maxHp(c, beasts) {
  return c.maxHp ?? beasts.get(c.name)?.hp ?? null;
}

export function currentHp(c, beasts) {
  const max = maxHp(c, beasts) ?? 0;
  return max - (c.damage ?? []).reduce((a, b) => a + (Number(b) || 0), 0);
}

export function sortByInitiative(combatants, beasts) {
  const mod = (c) => (c.kind === 'monster' ? beasts.get(c.name)?.init ?? 0 : 0);
  return combatants
    .filter((c) => c.init !== null && c.init !== undefined && c.init !== '')
    .slice()
    .sort((a, b) => b.init - a.init || mod(b) - mod(a));
}
