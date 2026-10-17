import Anthropic from '@anthropic-ai/sdk';
import { DIFFICULTIES, xpTargets } from '../client/src/rules.js';

// Haiku matched or beat Opus on the monster eval (balance, names, varied stats) at about 1/40th the cost:
// see the README's Evals section and .claude/hillclimb/monster-balance.
export const AI_MODEL = 'claude-haiku-5-5';
export const MAX_PROMPT = 500;
const MAX_MONSTERS = 4;
const SAVES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

// Why a generation failed. None of these use up one of the DM's generations.
//   busy:        Claude is rate limited, overloaded or unreachable; try again later.
//   unavailable: the server's key, billing or request is wrong; needs the site owner.
//   refused:     Claude declined the prompt.
//   invalid:     the reply couldn't be turned into monsters.
export class GenerateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const int = { type: 'integer' };
const MONSTER_ITEM = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    cr: { type: 'number', description: 'Challenge rating: 0, 0.125, 0.25, 0.5, or a whole number 1-30' },
    hp: int,
    ac: int,
    speed: { type: 'string', description: 'Feet, e.g. "30" or "30, fly 60"' },
    init: { type: 'integer', description: 'Initiative modifier (the Dex modifier)' },
    saves: {
      type: 'object',
      properties: Object.fromEntries(SAVES.map((s) => [s, int])),
      required: SAVES,
      additionalProperties: false,
    },
    attacks: { type: 'array', items: { type: 'string' } },
    special: { type: 'string' },
  },
  required: ['name', 'cr', 'hp', 'ac', 'speed', 'init', 'saves', 'attacks', 'special'],
  additionalProperties: false,
};
const MONSTER_SCHEMA = {
  type: 'object',
  properties: { monsters: { type: 'array', items: MONSTER_ITEM } },
  required: ['monsters'],
  additionalProperties: false,
};

// How fields are written in the bestiary. Shared by Claude's prompt and the instructions DMs copy for their own AI.
export const FIELD_RULES = `- name: a short name a DM can read aloud, different from the others' names. Don't number them ("Frost Wolf (2)"): give each monster of a pack a name of its own.
- cr: challenge rating: 0, 0.125, 0.25, 0.5, or a whole number from 1 to 30.
- hp, ac, init: whole numbers; init is the initiative modifier (the Dex modifier).
- speed: in feet, e.g. "30" or "30, fly 60".
- saves: the saving throw modifier for each of str, dex, con, int, wis, cha (proficient saves include the proficiency bonus).
- attacks: one short line per action, e.g. "Multiattack: 2× Claw", "Claw +5 5ft 2d6+3 slashing", "Longbow +4 150/600ft 1d8+2 piercing", "Fire Breath (Recharge 5-6) DC13 Dex 6d6 fire".
- special: traits, resistances and senses in one compact paragraph, e.g. "Pack Tactics. Resist cold. Darkvision 60 ft., PP 13. Legendary: Detect, Tail Swipe".`;

export const BALANCE = `Balance hit points, armor class, attack bonuses, damage and save DCs for the challenge rating using the 5e monster creation guidelines. Don't copy monsters from published books other than the 5e System Reference Document.`;

// Typical numbers at each CR: the medians of the SRD bestiary's ordinary monsters (evals/balance.js, srdTable),
// rounded. Above CR 10 the SRD has too few to say. test/ai.test.js fails if this drifts from the calibration.
export const TYPICAL_BY_CR = [
  // [cr, hp, ac, attack bonus, save DC, damage per round]
  [0, 3, 11, 3, 11, 3], [0.125, 9, 12, 4, 11, 5], [0.25, 13, 12, 4, 11, 6], [0.5, 22, 12, 4, 11, 8],
  [1, 27, 12, 4, 11, 10], [2, 45, 13, 5, 12, 13], [3, 58, 13, 5, 12, 17], [4, 78, 13, 5, 13, 17],
  [5, 102, 15, 7, 15, 26], [6, 112, 15, 7, 15, 29], [7, 127, 17, 7, 15, 39], [8, 136, 17, 8, 15, 44],
  [9, 147, 18, 10, 17, 47], [10, 178, 18, 10, 17, 47],
];
const crName = (cr) => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' })[cr] ?? String(cr);

// How to set a new monster's numbers. Shared by the monster and encounter table prompts.
const MONSTER_GUIDE = `${BALANCE}

Typical numbers for each CR, from the SRD's monsters. Each row is an average, not a stat block to copy: real monsters at the same CR differ, and yours should too, from the row and from each other. Let the monster's idea set its numbers, then check them against its CR's row: hit points up to about a third above or below it, AC two or three either side, and damage per round the other way, so a tougher monster hits softer and a fragile one harder, and the two still average out to its CR. Unless the DM asks for something lopsided, don't push both far the same way. Damage per round is its usual turn (every hit of its multiattack), with a recharge ability counted about once in three rounds. Above CR 10, keep growing from the CR 10 row.
CR | HP | AC | attack bonus | save DC | damage per round
${TYPICAL_BY_CR.map(([cr, hp, ac, bonus, dc, dpr]) => `${crName(cr)} | ${hp} | ${ac} | +${bonus} | ${dc} | ${dpr}`).join('\n')}

Write fields the way the rest of the bestiary does:
${FIELD_RULES}`;

const SYSTEM = `You design monsters for a Dungeons & Dragons 5th edition DM's bestiary, used at the table to run combat.

Make original monsters that fit the DM's request. Make ${MAX_MONSTERS} at most; if the request doesn't say how many, make one. ${MONSTER_GUIDE}`;

const EXAMPLE = { monsters: [{ name: 'Cinder Imp', cr: 0.5, hp: 10, ac: 13, speed: '20, fly 40', init: 3, saves: { str: -2, dex: 3, con: 1, int: 0, wis: 1, cha: 2 }, attacks: ['Sting +5 5ft 1d4+3 piercing', 'Ember Spit +5 30ft 2d4 fire'], special: 'Imm fire. Devil\'s Sight. Darkvision 120 ft., PP 11' }] };

// Instructions a DM can give their own AI (ChatGPT, Claude, an agent) so its reply can be imported.
export const AGENT_INSTRUCTIONS = `Create Dungeons & Dragons 5th edition monsters for my DM Screen bestiary: <describe the monsters you want here>

${BALANCE}

Reply with only JSON, no other text, in this shape:
${JSON.stringify(EXAMPLE, null, 2)}

Fields:
${FIELD_RULES}`;

const VALID_CRS = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)];
const nearestCr = (cr) => VALID_CRS.reduce((best, c) => (Math.abs(c - cr) < Math.abs(best - cr) ? c : best), VALID_CRS[0]);
const whole = (v, fallback = 0) => (Number.isFinite(v) ? Math.round(v) : fallback);
const text = (v, max) => String(v ?? '').trim().slice(0, max);

// One monster from Claude or pasted JSON, cleaned up into a bestiary entry, or null without a name.
export function normalizeMonster(m, { xpTable = [] } = {}) {
  if (!m || typeof m !== 'object' || !text(m.name, 60)) return null;
  const cr = nearestCr(Number(m.cr) || 0);
  const url = text(m.url, 500);
  return {
    name: text(m.name, 60),
    hp: Math.max(1, whole(Number(m.hp), 1)),
    ac: Math.max(1, whole(Number(m.ac), 10)),
    speed: text(m.speed, 60) || '30',
    saves: Object.fromEntries(SAVES.map((s) => [s, whole(Number(m.saves?.[s]))])),
    init: whole(Number(m.init)),
    attacks: (Array.isArray(m.attacks) ? m.attacks : []).map((a) => text(a, 300)).filter(Boolean).slice(0, 12),
    cr,
    xp: xpTable.find((r) => r.cr === cr)?.xp ?? null,
    special: text(m.special, 1500),
    url: /^https?:\/\//i.test(url) ? url : '',
  };
}

// Rename monsters whose name is already in the bestiary (or earlier in the list): "Wolf" becomes "Wolf 2".
export function withUniqueNames(bestiary, monsters) {
  const taken = new Set(bestiary.map((m) => m.name.toLowerCase()));
  return monsters.map((m) => {
    let name = m.name;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${m.name} ${n}`;
    taken.add(name.toLowerCase());
    return { ...m, name };
  });
}

// Turn Claude's monsters into bestiary entries. Returns only the ones that are usable.
export function toBestiaryEntries(raw, { prompt, xpTable = [] }) {
  return (Array.isArray(raw) ? raw : [])
    .map((m) => normalizeMonster(m, { xpTable }))
    .filter(Boolean)
    .slice(0, MAX_MONSTERS)
    .map((m) => ({ ...m, ai: true, aiPrompt: prompt }));
}

export const MAX_IMPORT = 200;

// Pasted JSON: {"monsters": [...]}, a list of monsters, or one monster. Returns { monsters, skipped }.
export function parseImport(input, { xpTable = [] } = {}) {
  let data = input;
  if (typeof input === 'string') {
    // AI replies often wrap the JSON in a ```json block or a sentence; read from the first { or [ to the last } or ].
    const start = input.search(/[[{]/);
    const end = Math.max(input.lastIndexOf('}'), input.lastIndexOf(']'));
    try {
      data = JSON.parse(start === -1 || end < start ? input : input.slice(start, end + 1));
    } catch {
      throw new GenerateError('invalid', "That isn't valid JSON. Paste the monsters JSON exactly as your AI gave it.");
    }
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.monsters) ? data.monsters : data && typeof data === 'object' ? [data] : [];
  if (list.length > MAX_IMPORT) throw new GenerateError('invalid', `Import at most ${MAX_IMPORT} monsters at a time.`);
  const monsters = list.map((m) => normalizeMonster(m, { xpTable })).filter(Boolean).map((m) => ({ ...m, imported: true }));
  if (!monsters.length) throw new GenerateError('invalid', 'No monsters with a name were found in that JSON.');
  return { monsters, skipped: list.length - monsters.length };
}

// ---- Random encounter tables: mostly monsters already in the DM's bestiary, a few new ones only if nothing fits. ----
// Claude reads the whole bestiary (one short line per monster) and writes back names and counts, so a table costs
// many input tokens but few output tokens.

export const MAX_ENTRIES = 12;
const MAX_NEW_MONSTERS = 2;

const TABLE_SCHEMA = {
  type: 'object',
  properties: {
    group: { type: 'string', description: 'Heading for the table, named for the place and level, e.g. "Darkwood (level 5)"' },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'A short title, e.g. "Wolf Pack"' },
          weight: { type: 'integer', description: 'How many numbers of the roll this entry gets, 1-3: more for the commonest encounters' },
          note: { type: 'string', description: 'One line for the DM: setup, tactics or a twist' },
          monsters: {
            type: 'array',
            items: { type: 'object', properties: { name: { type: 'string' }, count: int }, required: ['name', 'count'], additionalProperties: false },
          },
        },
        required: ['name', 'weight', 'note', 'monsters'],
        additionalProperties: false,
      },
    },
    newMonsters: { type: 'array', items: MONSTER_ITEM, description: `At most ${MAX_NEW_MONSTERS}; usually none` },
  },
  required: ['group', 'entries', 'newMonsters'],
  additionalProperties: false,
};

// "easy 1000, medium 2000, hard 3000, deadly 4400" for four level 5 characters.
const targets = (levels) => xpTargets(levels).map((t, i) => `${DIFFICULTIES[i].toLowerCase()} ${t}`).join(', ');

const TABLE_SYSTEM = `You build random encounter tables for a Dungeons & Dragons 5th edition DM. Each entry is a fight the DM can start from their Encounters page.

Build the table from the monsters in the DM's bestiary, listed below: pick ones that would live in the place the DM describes and suit the party's level. Write their names exactly as listed. Give each entry a weight, how many numbers of the roll it gets: 2 or 3 for the encounters most likely there, 1 for rare ones. The app turns the weights into roll ranges.

Use the 5e encounter building rules: add up the monsters' XP and multiply it by 1 for one monster, 1.5 for two, 2 for 3-6, 2.5 for 7-10, 3 for 11-14 and 4 for 15 or more. Compare that adjusted XP with the party's targets, given with the request, and check each entry's sum before you settle on it. Make most entries easy or medium, a couple hard and at most one deadly, and none below easy: a fight under the easy target isn't worth rolling for.

Notes are one line on setup, tactics or a twist. Don't say how hard the fight is: the app works that out and shows it.

Only if nothing in the bestiary fits an entry, make up to ${MAX_NEW_MONSTERS} original monsters in newMonsters and use them by name in the entries. Usually make none. For a new monster:
${MONSTER_GUIDE}`;

// "Bite, Claw" from ["Multiattack: 2× Claw", "Bite +4 5ft 1d6+2 piercing", ...]: enough for Claude to tell what a monster does.
const attackNames = (attacks = []) =>
  attacks.map((a) => String(a).split(/:| [+(]| DC\d/)[0].trim()).filter((a) => a && a !== 'Multiattack').slice(0, 4).join(', ');

// One line per monster, sorted, so the same bestiary is the same text and the prompt cache can reuse it.
export function bestiaryListing(bestiary) {
  return bestiary
    .filter((m) => m?.name)
    .slice()
    .sort((a, b) => (a.cr ?? 0) - (b.cr ?? 0) || a.name.localeCompare(b.name))
    .map((m) => [m.name, `CR ${crName(m.cr ?? 0)}`, `${m.xp ?? 0} XP`, attackNames(m.attacks), text(m.special, 120)].filter(Boolean).join(' | '))
    .join('\n');
}

// Exact name ignoring case, else ignoring spacing and punctuation: bestiaries imported from the sheet use
// names like "dire-wolf", which an AI will write as "Dire Wolf".
const loose = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '');
export const findMonster = (bestiary, name) =>
  bestiary.find((m) => m.name.toLowerCase() === String(name).trim().toLowerCase()) ?? bestiary.find((m) => loose(m.name) === loose(name));

// Claude's table, checked against the bestiary as it is now. New monsters get unique names, and unknown monsters
// are dropped (and entries left with none). Returns { group, encounters, monsters (new, for the bestiary),
// dropped (names that matched nothing) }.
export function toEncounterTable(raw, { bestiary, encounters = [], prompt, xpTable = [] }) {
  const made = (Array.isArray(raw?.newMonsters) ? raw.newMonsters : [])
    .map((m) => normalizeMonster(m, { xpTable })).filter(Boolean).slice(0, MAX_NEW_MONSTERS)
    .map((m) => ({ ...m, ai: true, aiPrompt: prompt }));
  const monsters = withUniqueNames(bestiary, made);
  const dropped = new Set();
  const resolve = (name) => {
    const i = made.findIndex((m) => m.name.toLowerCase() === String(name).trim().toLowerCase());
    const m = i === -1 ? findMonster(bestiary, name) : monsters[i];
    if (!m) dropped.add(String(name));
    return m;
  };

  const groups = new Set(encounters.map((e) => e.group.toLowerCase()));
  const base = text(raw?.group, 60) || 'Random encounters';
  let group = base;
  for (let n = 2; groups.has(group.toLowerCase()); n++) group = `${base} ${n}`;

  const table = (Array.isArray(raw?.entries) ? raw.entries : []).slice(0, MAX_ENTRIES).map((e) => {
    const names = (Array.isArray(e?.monsters) ? e.monsters : [])
      .map((p) => ({ m: resolve(p?.name), count: Math.min(30, Math.max(1, whole(Number(p?.count), 1))) }))
      .filter((p) => p.m)
      .flatMap((p) => Array(p.count).fill(p.m.name)).slice(0, 30);
    if (!names.length) return null;
    return { group, name: text(e.name, 80) || 'Encounter', weight: Math.min(6, Math.max(1, whole(Number(e.weight), 1))), note: text(e.note, 300), monsters: names };
  }).filter(Boolean);

  // Only keep new monsters that an entry uses.
  const used = monsters.filter((m) => table.some((e) => e.monsters.includes(m.name)));
  return { group, encounters: table, monsters: used, dropped: [...dropped] };
}

// Without a key (ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN) the feature is off.
// model and effort are what the site uses unless set otherwise (evals/run-monsters.js tries others).
// onResponse(response, request), if given, sees each reply from Claude, refusals included.
export function createMonsterGenerator({ client = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null, model = AI_MODEL, effort = 'medium', onResponse } = {}) {
  // One request for JSON in the schema's shape. what says what was being made, for error messages.
  async function ask({ system, content, schema, what }) {
    const request = {
      model,
      max_tokens: 16000,
      output_config: { effort, format: { type: 'json_schema', schema } },
      // If a safety classifier declines, the API retries on Anthropic's recommended fallback model.
      // Haiku has no fallback, and a request that asks for one is refused.
      ...(!model.startsWith('claude-haiku') && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
      system,
      messages: [{ role: 'user', content }],
    };
    let response;
    try {
      response = await client.beta.messages.create(request);
      onResponse?.(response, request);
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
        throw new GenerateError('busy', 'Claude is out of capacity right now. Try again later.');
      }
      if (e instanceof Anthropic.APIError) {
        console.error(`[ai] Claude API error ${e.status}:`, e.message);
        throw new GenerateError('unavailable', `AI ${what} aren't available right now.`);
      }
      throw e;
    }
    if (response.stop_reason === 'refusal') throw new GenerateError('refused', `Claude couldn't make ${what} from that prompt. Try rewording it.`);
    const block = response.content.find((b) => b.type === 'text');
    try {
      return JSON.parse(block?.text ?? '');
    } catch {
      throw new GenerateError('invalid', "Claude's reply couldn't be read. Try again.");
    }
  }

  return {
    enabled: Boolean(client),
    async generate(prompt, { xpTable } = {}) {
      const parsed = await ask({ system: SYSTEM, content: prompt, schema: MONSTER_SCHEMA, what: 'monsters' });
      const monsters = toBestiaryEntries(parsed.monsters, { prompt, xpTable });
      if (!monsters.length) throw new GenerateError('invalid', "Claude didn't return any monsters. Try again.");
      return monsters;
    },
    // Claude's raw table ({ group, entries, newMonsters }); toEncounterTable checks it against the bestiary.
    // levels: each character's level, which sets the XP targets.
    async table(prompt, { bestiary, levels, entries = 8 }) {
      const parsed = await ask({
        // The bestiary goes last in the system prompt, marked for caching: a DM's next table within a few
        // minutes reads it from the cache at a tenth of the price.
        system: [
          { type: 'text', text: TABLE_SYSTEM },
          { type: 'text', text: `The DM's bestiary (name | CR | XP | attacks | traits):\n${bestiaryListing(bestiary)}`, cache_control: { type: 'ephemeral' } },
        ],
        content: `Party: ${levels.length} characters, level ${[...new Set(levels)].sort((a, b) => a - b).join('/')}. Adjusted XP targets for the whole party: ${targets(levels)}. Make ${entries} entries.\n\nThe DM asks for: ${prompt}`,
        schema: TABLE_SCHEMA,
        what: 'encounter tables',
      });
      if (!Array.isArray(parsed?.entries) || !parsed.entries.length) throw new GenerateError('invalid', "Claude didn't return a table. Try again.");
      return parsed;
    },
  };
}
