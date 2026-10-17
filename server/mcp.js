// An MCP server that lets an AI client (Claude Code, Claude Desktop, ...) work with one DM's campaign:
// search the bestiary, look at a battle, price encounters, roll dice, and add monsters and encounters.
// server/mcp-stdio.js runs it over stdio for a local client; the web app serves it at /mcp for remote ones.
//
// Writes go through the same store as the web app. The store reloads a DM's file when it changes on disk, and
// the browser reloads when the DM comes back to the tab, so neither overwrites what was added here. Tools only
// add: nothing here edits or deletes what the DM has made.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SAVES, beastMap, currentHp, d, difficulty, expandSpecial, fmtCr, fmtRange, initiativeOrder, maxHp, partyLevels, rollParts, rollTable, uid, xpSummary } from '../client/src/rules.js';
import { BALANCE, FIELD_RULES, findMonster, normalizeMonster, withUniqueNames } from './ai.js';

const statBlock = (m) =>
  [
    `${m.name} (CR ${fmtCr(m.cr)}, ${m.xp ?? 0} XP)`,
    `AC ${m.ac}, HP ${m.hp}, speed ${m.speed}, init ${m.init >= 0 ? '+' : ''}${m.init}`,
    `Saves: ${Object.entries(m.saves ?? {}).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')}`,
    `Attacks:\n${(m.attacks ?? []).map((a) => `  - ${a}`).join('\n')}`,
    m.special && `Special: ${expandSpecial(m.special)}`,
    m.url && `Full stat block: ${m.url}`,
  ].filter(Boolean).join('\n');
const text = (s) => ({ content: [{ type: 'text', text: s }] });
const fail = (s) => ({ ...text(s), isError: true });

const partyCount = (s) => Math.max(1, s.party.filter((p) => p.inParty).length);
// ["Wolf", "Wolf", "Dire Wolf"] -> "2× Wolf, Dire Wolf"
const countNames = (names) => Object.entries(names.reduce((c, n) => ({ ...c, [n]: (c[n] ?? 0) + 1 }), {}))
  .map(([n, k]) => (k > 1 ? `${k}× ${n}` : n)).join(', ');

// A group as a roll table: "1-2  Wolf Pack: 3× Wolf - 150 XP, Easy (note)", then the roll it takes.
function tableLines(s, list) {
  const beasts = beastMap(s.bestiary);
  const levels = partyLevels(s.party);
  const { ranges, total } = rollTable(list);
  return [
    ...list.map((e) => {
      const xps = e.monsters.map((n) => beasts.get(n)?.xp);
      const rating = difficulty(xps, levels);
      return `${fmtRange(ranges.get(e.id)).padEnd(5)} ${rollParts(e).title}: ${countNames(e.monsters)} - ${xps.reduce((a, b) => a + (b ?? 0), 0)} XP${rating ? `, ${rating}` : ''}${e.note ? ` (${e.note})` : ''}`;
    }),
    total ? `Roll 1-${total} (weights 0 are off the table).` : 'Every weight is 0, so there is nothing to roll.',
  ];
}

// An MCP server for one DM (a user record), on a DM store (createDmStore). Not yet connected to a transport.
export function createMcpServer({ dms, dm }) {
  const state = () => dms.get(dm.id);

  const server = new McpServer(
    { name: 'dm-screen', version: '0.1.0' },
    { instructions: `Campaign data for ${dm.name}'s DM Screen (D&D 5e). Monster names are exact bestiary names; use search_monsters to find them. Prefer monsters already in the bestiary over adding new ones.` },
  );

  // ---- Tools: actions the model decides to call. ----

  server.registerTool(
    'search_monsters',
    {
      title: 'Search the bestiary',
      description: 'Find monsters in the DM\'s bestiary by name, special abilities or attacks, optionally within a CR range. Returns one line per monster.',
      inputSchema: {
        query: z.string().optional().describe('Text to look for in the name, attacks and special abilities, e.g. "dragon" or "fire"'),
        minCr: z.number().optional(),
        maxCr: z.number().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, minCr, maxCr, limit }) => {
      const q = query?.toLowerCase();
      const hits = state().bestiary
        .filter((m) => !q || [m.name, m.special, ...(m.attacks ?? [])].join(' ').toLowerCase().includes(q))
        .filter((m) => (minCr === undefined || m.cr >= minCr) && (maxCr === undefined || m.cr <= maxCr))
        .sort((a, b) => a.cr - b.cr || a.name.localeCompare(b.name));
      if (!hits.length) return text('No monsters match.');
      const lines = hits.slice(0, limit).map((m) => `${m.name} - CR ${fmtCr(m.cr)}, AC ${m.ac}, HP ${m.hp}, ${m.xp ?? 0} XP`);
      if (hits.length > limit) lines.push(`... and ${hits.length - limit} more; narrow the search or raise the limit.`);
      return text(lines.join('\n'));
    },
  );

  server.registerTool(
    'get_monster',
    {
      title: 'Monster stat block',
      description: 'The full stat block for one monster in the bestiary.',
      inputSchema: { name: z.string().describe('Exact monster name, as returned by search_monsters') },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      const m = findMonster(state().bestiary, name);
      return m ? text(statBlock(m)) : fail(`No monster named "${name}". Try search_monsters.`);
    },
  );

  server.registerTool(
    'get_battle',
    {
      title: 'Battle status',
      description: 'Initiative order, hit points and XP award for a battle. Defaults to the battle shown to players. With no battles, lists none.',
      inputSchema: { battle: z.string().optional().describe('Battle name or id; leave out for the active battle') },
      annotations: { readOnlyHint: true },
    },
    async ({ battle }) => {
      const s = state();
      if (!s.battles.length) return text('There are no battles.');
      const b = battle
        ? s.battles.find((x) => x.id === battle || x.name.toLowerCase() === battle.toLowerCase())
        : s.battles.find((x) => x.id === s.settings.activeBattleId) ?? s.battles[0];
      if (!b) return fail(`No battle "${battle}". Battles: ${s.battles.map((x) => x.name).join(', ')}`);
      const beasts = beastMap(s.bestiary);
      const order = initiativeOrder(b.combatants, beasts);
      const unrolled = b.combatants.filter((c) => !order.includes(c));
      const line = (c) => {
        const who = c.mask ? `${c.name} (players see "${c.mask}")` : c.name;
        const hp = c.kind === 'monster' ? `, HP ${currentHp(c, beasts)}/${maxHp(c, beasts)}` : '';
        const turn = c.id === b.turn ? '  <- current turn' : '';
        return `${c.init ?? '-'}  ${who} [${c.kind}]${hp}${c.hidden ? ', hidden' : ''}${turn}`;
      };
      const xp = xpSummary(b, beasts);
      return text([
        `${b.name}, round ${b.round ?? 1}`,
        ...order.map(line),
        ...(unrolled.length ? ['No initiative yet:', ...unrolled.map(line)] : []),
        `XP: ${xp.total} total, ${xp.award} per player (party of ${b.partySize}, scale ${xp.scale})`,
        xp.rounds !== null && `Monsters have ${xp.remaining} HP left, about ${xp.rounds.toFixed(1)} rounds at ${b.partyDamage} party damage per round`,
        `Other battles: ${s.battles.filter((x) => x !== b).map((x) => x.name).join(', ') || 'none'}`,
      ].filter(Boolean).join('\n'));
    },
  );

  // This one also returns structuredContent checked against outputSchema, for clients that want data, not prose.
  server.registerTool(
    'encounter_xp',
    {
      title: 'Price an encounter',
      description: 'XP for a planned encounter, using the same formula as the Battle page: total XP / party size x max(1, monsters / party size). ' +
        'Also its 5e difficulty (Trivial, Easy, Medium, Hard or Deadly) when the DM has set levels on the Party page.',
      inputSchema: {
        monsters: z.array(z.object({ name: z.string(), count: z.number().int().min(1).default(1) })).min(1),
        partySize: z.number().int().min(1).optional().describe('Defaults to the players in the DM\'s party'),
      },
      outputSchema: {
        totalXp: z.number(),
        perPlayer: z.number(),
        scale: z.number(),
        award: z.number(),
        partySize: z.number(),
        totalHp: z.number(),
        difficulty: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ monsters, partySize }) => {
      const s = state();
      const missing = monsters.filter((m) => !findMonster(s.bestiary, m.name)).map((m) => m.name);
      if (missing.length) return fail(`Not in the bestiary: ${missing.join(', ')}`);
      const size = partySize ?? partyCount(s);
      const combatants = monsters.flatMap((m) =>
        Array.from({ length: m.count }, () => ({ kind: 'monster', name: findMonster(s.bestiary, m.name).name, damage: [] })),
      );
      const beasts = beastMap(s.bestiary);
      const xp = xpSummary({ combatants, partySize: size }, beasts);
      const levels = partyLevels(s.party);
      const rating = difficulty(combatants.map((c) => beasts.get(c.name)?.xp), levels);
      const result = { totalXp: xp.total, perPlayer: xp.perPlayer, scale: xp.scale, award: xp.award, partySize: size, totalHp: xp.remaining, ...(rating && { difficulty: rating }) };
      return {
        ...text(`${combatants.length} monsters, ${result.totalHp} HP: ${result.totalXp} XP total, ${result.award} XP per player for a party of ${size}.` +
          (rating ? ` ${rating} for the party (levels ${levels.join(', ')}).` : ' Set levels on the Party page to rate its difficulty.')),
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'roll_dice',
    {
      title: 'Roll dice',
      description: 'Roll dice written like "2d6+3", "d20" or "4d6-1d4+2". Shows each die.',
      inputSchema: { expression: z.string().regex(/^\s*[+-]?\s*(\d*d\d+|\d+)(\s*[+-]\s*(\d*d\d+|\d+))*\s*$/i, 'like 2d6+3') },
      annotations: { readOnlyHint: true },
    },
    async ({ expression }) => {
      let total = 0;
      const parts = [];
      for (const [, sign, count, sides, flat] of expression.replace(/\s+/g, '').matchAll(/([+-]?)(?:(\d*)d(\d+)|(\d+))/gi)) {
        const k = sign === '-' ? -1 : 1;
        if (flat) { total += k * Number(flat); parts.push(`${sign}${flat}`); continue; }
        const n = Number(count || 1);
        if (n > 100) return fail('At most 100 dice per term.');
        const rolls = Array.from({ length: n }, () => d(Number(sides)));
        total += k * rolls.reduce((a, b) => a + b, 0);
        parts.push(`${sign}${n}d${sides}[${rolls.join(',')}]`);
      }
      return text(`${parts.join(' ')} = ${total}`);
    },
  );

  // ---- Tools that write. They only add, and say what they added so the DM can check it in the app. ----

  const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  const monsterInput = z.object({
    name: z.string(),
    cr: z.number().describe('0, 0.125, 0.25, 0.5, or a whole number 1-30'),
    hp: z.number().int(),
    ac: z.number().int(),
    speed: z.string().describe('Feet, e.g. "30" or "30, fly 60"'),
    init: z.number().int().describe('Initiative modifier (the Dex modifier)'),
    saves: z.object(Object.fromEntries(SAVES.map((k) => [k, z.number().int()]))),
    attacks: z.array(z.string()),
    special: z.string(),
  });

  server.registerTool(
    'add_monsters',
    {
      title: 'Add monsters to the bestiary',
      description: `Add original monsters to the DM's bestiary, for when nothing there fits (check search_monsters first). They show in the app tagged AI, with the request. A name already in the bestiary gets a number, like "Wolf 2".

${BALANCE}

Fields:
${FIELD_RULES}`,
      inputSchema: {
        request: z.string().min(1).max(200).describe('What the DM asked for, shown on each monster, e.g. "woodland encounters for a level 5 party"'),
        monsters: z.array(monsterInput).min(1).max(20),
      },
      annotations: writes,
    },
    async ({ request, monsters }) => {
      const s = state();
      const made = monsters.map((m) => ({ ...normalizeMonster(m, { xpTable: s.xp?.cr ?? [] }), ai: true, aiPrompt: request }));
      const added = withUniqueNames(s.bestiary, made);
      dms.set(dm.id, 'bestiary', [...s.bestiary, ...added]);
      // The dm://monster/{name} list just grew; tell the client so it can re-fetch it.
      server.sendResourceListChanged();
      return text(`Added to the bestiary:\n${added.map((m, i) =>
        `${m.name} - CR ${fmtCr(m.cr)}, ${m.xp ?? 0} XP${m.name !== made[i].name ? ` (renamed: "${made[i].name}" was taken)` : ''}`).join('\n')}`);
    },
  );

  server.registerTool(
    'add_encounters',
    {
      title: 'Add encounters',
      description: 'Save encounters to the DM\'s Encounters page under one group, such as the entries of a random encounter table. ' +
        'A group is a table the DM can roll on: each encounter\'s weight is how many numbers of the roll it gets, and the roll runs to the weights\' total. ' +
        'Every monster must already be in the bestiary (add_monsters first for new ones); if any name is unknown, nothing is saved. ' +
        'The DM starts a battle from an encounter in the app.',
      inputSchema: {
        group: z.string().min(1).max(60).describe('Heading they appear under, e.g. "Woods (level 5)". An existing group is added to; see list_encounters'),
        encounters: z.array(z.object({
          name: z.string().min(1).max(80).describe('e.g. "Wolf Pack"; the app shows the roll range'),
          weight: z.number().int().min(0).max(20).default(1).describe('How many numbers of the group\'s roll it gets: 2-3 for common encounters, 1 for rare ones'),
          note: z.string().max(300).default('').describe('One line for the DM: setup, tactics or a twist'),
          monsters: z.array(z.object({ name: z.string(), count: z.number().int().min(1).max(30).default(1) })).min(1),
        })).min(1).max(20),
      },
      annotations: writes,
    },
    async ({ group, encounters }) => {
      const s = state();
      const missing = [...new Set(encounters.flatMap((e) => e.monsters).map((m) => m.name).filter((n) => !findMonster(s.bestiary, n)))];
      if (missing.length) {
        return fail(`Nothing saved. Not in the bestiary: ${missing.join(', ')}. Use search_monsters for exact names, or add_monsters to create them.`);
      }
      const heading = s.encounters.find((e) => e.group.toLowerCase() === group.trim().toLowerCase())?.group ?? group.trim();
      const made = encounters.map((e) => ({
        id: uid('enc'),
        group: heading,
        name: e.name.trim(),
        weight: e.weight,
        note: e.note.trim(),
        monsters: e.monsters.flatMap((m) => Array(m.count).fill(findMonster(s.bestiary, m.name).name)),
      }));
      const all = [...s.encounters, ...made];
      dms.set(dm.id, 'encounters', all);
      return text([`Saved ${made.length} encounters under "${heading}". The group's table is now:`, ...tableLines(s, all.filter((e) => e.group === heading))].join('\n'));
    },
  );

  server.registerTool(
    'list_encounters',
    {
      title: 'List encounters',
      description: 'The DM\'s saved encounters. Without a group, lists the groups; with one, each encounter in it with its monsters.',
      inputSchema: { group: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ group }) => {
      const s = state();
      if (!group) {
        const counts = countNames(s.encounters.map((e) => e.group));
        return text(counts ? `Groups (with how many encounters): ${counts}` : 'There are no encounters.');
      }
      const list = s.encounters.filter((e) => e.group.toLowerCase() === group.trim().toLowerCase());
      if (!list.length) return fail(`No group "${group}". Call list_encounters without a group to see them.`);
      return text(tableLines(s, list).join('\n'));
    },
  );

  // ---- Resources: data the client (or user) chooses to attach, addressed by URI. ----

  server.registerResource(
    'party',
    'dm://party',
    { title: 'Party', description: 'The players in the DM\'s party', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(state().party, null, 2) }] }),
  );

  // A template: one resource per monster. list() lets clients browse them; complete powers autocomplete.
  server.registerResource(
    'monster',
    new ResourceTemplate('dm://monster/{name}', {
      list: async () => ({
        resources: state().bestiary.map((m) => ({ uri: `dm://monster/${encodeURIComponent(m.name)}`, name: m.name, mimeType: 'text/plain' })),
      }),
      complete: {
        name: (value) => state().bestiary.map((m) => m.name).filter((n) => n.toLowerCase().startsWith(value.toLowerCase())).slice(0, 20),
      },
    }),
    { title: 'Monster', description: 'A monster\'s stat block', mimeType: 'text/plain' },
    async (uri, { name }) => {
      const m = findMonster(state().bestiary, decodeURIComponent(name));
      if (!m) throw new Error(`No monster named "${decodeURIComponent(name)}"`);
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: statBlock(m) }] };
    },
  );

  // ---- Prompts: reusable templates the user picks (in Claude Code they show up as slash commands). ----

  server.registerPrompt(
    'plan_encounter',
    {
      title: 'Plan an encounter',
      description: 'Build an encounter from the bestiary around a theme',
      argsSchema: {
        theme: z.string().describe('e.g. "undead crypt" or "goblin ambush on the road"'),
        difficulty: z.string().optional().describe('easy, medium, hard or deadly'),
      },
    },
    ({ theme, difficulty }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Plan a ${difficulty ?? 'medium'} D&D encounter for my party with the theme "${theme}". ` +
            'Read dm://party for who is playing. Use search_monsters to pick monsters from my bestiary only, ' +
            'check the total with encounter_xp, and give me a short read-aloud intro, the monster list with counts, ' +
            'tactics for each monster type and the XP award. Then offer to save it with add_encounters.',
        },
      }],
    }),
  );

  server.registerPrompt(
    'random_encounter_table',
    {
      title: 'Random encounter table',
      description: 'Build a random encounter table for a place, and save it to the Encounters page',
      argsSchema: {
        environment: z.string().describe('e.g. "the woods", "a swamp", "city streets at night"'),
        entries: z.string().optional().describe('How many encounters, default 8'),
      },
    },
    ({ environment, entries = '8' }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Make a random encounter table of ${entries} encounters for my party in ${environment}, and save it to my Encounters page.\n` +
            '1. Read dm://party for who is playing and their levels.\n' +
            `2. Use search_monsters to find monsters in my bestiary that would live in ${environment} and suit the party. ` +
            'Make a mix: mostly easy and medium, a couple hard, at most one deadly.\n' +
            '3. Only if nothing in the bestiary fits an entry, make a few original monsters with add_monsters.\n' +
            '4. Check each entry with encounter_xp, which rates its difficulty for the party.\n' +
            '5. Save the table with add_encounters as one group named for the place and level. Give each encounter a short name, ' +
            'a weight (2-3 for the commonest, 1 for rare ones) and a one-line note on setup, tactics or a twist.\n' +
            'Then show me the table it saved, and list any monsters you added.',
        },
      }],
    }),
  );

  return server;
}
