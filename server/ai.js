import Anthropic from '@anthropic-ai/sdk';

export const AI_MODEL = 'claude-opus-5-5';
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
const MONSTER_SCHEMA = {
  type: 'object',
  properties: {
    monsters: {
      type: 'array',
      items: {
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
      },
    },
  },
  required: ['monsters'],
  additionalProperties: false,
};

// How fields are written in the bestiary. Shared by Claude's prompt and the instructions DMs copy for their own AI.
export const FIELD_RULES = `- name: a short name a DM can read aloud.
- cr: challenge rating: 0, 0.125, 0.25, 0.5, or a whole number from 1 to 30.
- hp, ac, init: whole numbers; init is the initiative modifier (the Dex modifier).
- speed: in feet, e.g. "30" or "30, fly 60".
- saves: the saving throw modifier for each of str, dex, con, int, wis, cha (proficient saves include the proficiency bonus).
- attacks: one short line per action, e.g. "Multiattack: 2× Claw", "Claw +5 5ft 2d6+3 slashing", "Longbow +4 150/600ft 1d8+2 piercing", "Fire Breath (Recharge 5-6) DC13 Dex 6d6 fire".
- special: traits, resistances and senses in one compact paragraph, e.g. "Pack Tactics. Resist cold. Darkvision 60 ft., PP 13. Legendary: Detect, Tail Swipe".`;

export const BALANCE = `Balance hit points, armor class, attack bonuses, damage and save DCs for the challenge rating using the 5e monster creation guidelines. Don't copy monsters from published books other than the 5e System Reference Document.`;

const SYSTEM = `You design monsters for a Dungeons & Dragons 5th edition DM's bestiary, used at the table to run combat.

Make original monsters that fit the DM's request. Make ${MAX_MONSTERS} at most; if the request doesn't say how many, make one. ${BALANCE}

Write fields the way the rest of the bestiary does:
${FIELD_RULES}`;

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

// Without a key (ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN) the feature is off.
// model and effort are what the site uses unless set otherwise (evals/run-monsters.js tries others).
// onResponse(response, request), if given, sees each reply from Claude, refusals included.
export function createMonsterGenerator({ client = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null, model = AI_MODEL, effort = 'medium', onResponse } = {}) {
  return {
    enabled: Boolean(client),
    async generate(prompt, { xpTable } = {}) {
      const request = {
        model,
        max_tokens: 16000,
        output_config: { effort, format: { type: 'json_schema', schema: MONSTER_SCHEMA } },
        // If a safety classifier declines, the API retries on Anthropic's recommended fallback model.
        // Haiku has no fallback, and a request that asks for one is refused.
        ...(!model.startsWith('claude-haiku') && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
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
          throw new GenerateError('unavailable', "AI monsters aren't available right now.");
        }
        throw e;
      }
      if (response.stop_reason === 'refusal') throw new GenerateError('refused', "Claude couldn't make monsters from that prompt. Try rewording it.");
      const block = response.content.find((b) => b.type === 'text');
      let parsed;
      try {
        parsed = JSON.parse(block?.text ?? '');
      } catch {
        throw new GenerateError('invalid', "Claude's reply couldn't be read. Try again.");
      }
      const monsters = toBestiaryEntries(parsed.monsters, { prompt, xpTable });
      if (!monsters.length) throw new GenerateError('invalid', "Claude didn't return any monsters. Try again.");
      return monsters;
    },
  };
}
