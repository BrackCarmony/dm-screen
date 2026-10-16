import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../server/app.js';
import { AI_MODEL, GenerateError, createMonsterGenerator, parseImport, toBestiaryEntries } from '../server/ai.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const XP = [{ cr: 0.5, xp: 100 }, { cr: 2, xp: 450 }, { cr: 5, xp: 1800 }];

function client(base) {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

const monster = (name, extra = {}) => ({ name, hp: 30, ac: 13, speed: '30', saves: { str: 2, dex: 1, con: 2, int: -2, wis: 0, cha: -1 }, init: 1, attacks: ['Bite +4 5ft 1d8+2 piercing'], cr: 2, xp: 450, special: 'Darkvision 60 ft.', url: '', ai: true, aiPrompt: 'p', ...extra });

async function start(t, generator, opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-screen-'));
  const app = createApp({ dataDir, seedDir: path.join(root, 'data', 'seed'), generator, ...opts });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  t.after(() => server.close());
  const dm = client(`http://127.0.0.1:${server.address().port}`);
  await dm('POST', '/api/signup', { email: 'dm@example.com', name: 'Dee', password: 'longenough' });
  return dm;
}

test('a generation adds AI monsters to the bestiary and uses one of the 5', async (t) => {
  const calls = [];
  const dm = await start(t, { enabled: true, generate: async (prompt) => { calls.push(prompt); return [monster('Aboleth'), monster('Ash Wraith')]; } });
  assert.deepEqual((await dm('GET', '/api/me')).body.ai, { enabled: true, used: 0, limit: 100 });

  const r = await dm('POST', '/api/bestiary/generate', { prompt: '  two swamp horrors  ' });
  assert.equal(r.status, 200);
  assert.deepEqual(calls, ['two swamp horrors']);
  // Aboleth is already in the starter bestiary, so the new one is renamed.
  assert.deepEqual(r.body.monsters.map((m) => m.name), ['Aboleth 2', 'Ash Wraith']);
  assert.deepEqual(r.body.ai, { enabled: true, used: 1, limit: 100 });

  const { bestiary } = (await dm('GET', '/api/state')).body;
  const ai = bestiary.filter((m) => m.ai);
  assert.deepEqual(ai.map((m) => m.name), ['Aboleth 2', 'Ash Wraith']);
  assert.equal(bestiary.filter((m) => m.name === 'Aboleth').length, 1);
  assert.equal((await dm('GET', '/api/me')).body.ai.used, 1);
});

test('failed generations do not use one up', async (t) => {
  const failures = [new GenerateError('busy', 'Claude is out of capacity right now. Try again later.'), new GenerateError('refused', 'no'), new GenerateError('invalid', 'bad'), new Error('boom')];
  const dm = await start(t, { enabled: true, generate: async () => { throw failures.shift(); } });
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    const r = await dm('POST', '/api/bestiary/generate', { prompt: 'a dragon' });
    statuses.push(r.status);
    assert.match(r.body.error, /didn't use one of your generations/);
    assert.equal(r.body.ai.used, 0);
  }
  assert.deepEqual(statuses, [503, 422, 502, 500]);
  assert.equal((await dm('GET', '/api/me')).body.ai.used, 0);
  assert.equal((await dm('GET', '/api/state')).body.bestiary.some((m) => m.ai), false);
});

test('the beta limit stops generations before calling Claude', async (t) => {
  let calls = 0;
  const dm = await start(t, { enabled: true, generate: async () => { calls++; return [monster(`Imp ${calls}`)]; } }, { aiUses: 2 });
  assert.equal((await dm('POST', '/api/bestiary/generate', { prompt: 'imp' })).status, 200);
  assert.equal((await dm('POST', '/api/bestiary/generate', { prompt: 'imp' })).status, 200);
  const r = await dm('POST', '/api/bestiary/generate', { prompt: 'imp' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /used all 2/);
  assert.equal(calls, 2);
});

test('one generation at a time per account, prompts are checked, and it can be off', async (t) => {
  let release;
  const dm = await start(t, { enabled: true, generate: () => new Promise((r) => { release = () => r([monster('Slow One')]); }) });
  assert.equal((await dm('POST', '/api/bestiary/generate', { prompt: '' })).status, 400);
  assert.equal((await dm('POST', '/api/bestiary/generate', { prompt: 'x'.repeat(501) })).status, 400);
  const first = dm('POST', '/api/bestiary/generate', { prompt: 'slow' });
  while (!release) await new Promise((r) => setTimeout(r, 5));
  const second = await dm('POST', '/api/bestiary/generate', { prompt: 'again' });
  assert.equal(second.status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await dm('GET', '/api/me')).body.ai.used, 1);

  const off = await start(t, { enabled: false, generate: async () => assert.fail('should not be called') });
  assert.equal((await off('POST', '/api/bestiary/generate', { prompt: 'x' })).status, 503);
  assert.equal((await off('GET', '/api/me')).body.ai.enabled, false);
});

test('Claude replies become bestiary entries', () => {
  const [m] = toBestiaryEntries([
    { name: '  Bog Hag  ', cr: 1.7, hp: 44.6, ac: 0, speed: '', init: 1, saves: { str: 3 }, attacks: ['Claw +5 5ft 2d6+3 slashing', ''], special: 'Amphibious.' },
    { name: '' },
  ], { prompt: 'hag', xpTable: XP });
  assert.deepEqual(m, {
    name: 'Bog Hag', hp: 45, ac: 1, speed: '30', saves: { str: 3, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, init: 1,
    attacks: ['Claw +5 5ft 2d6+3 slashing'], cr: 2, xp: 450, special: 'Amphibious.', url: '', ai: true, aiPrompt: 'hag',
  });
  assert.equal(toBestiaryEntries(Array.from({ length: 9 }, (_, i) => ({ name: `M${i}` })), { prompt: 'p' }).length, 4);
});

function fakeClient(respond) {
  const requests = [];
  return { requests, beta: { messages: { create: async (req) => { requests.push(req); return respond(req); } } } };
}
const reply = (body, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text: JSON.stringify(body) }] });

test('the generator asks Claude for JSON monsters and sorts out failures', async () => {
  const ok = fakeClient(() => reply({ monsters: [{ name: 'Cinder Imp', cr: 0.5, hp: 10, ac: 13, speed: '20, fly 40', init: 3, saves: { str: -2, dex: 3, con: 1, int: 0, wis: 1, cha: 2 }, attacks: ['Sting +5 5ft 1d4+3 piercing'], special: 'Imm fire.' }] }));
  const [imp] = await createMonsterGenerator({ client: ok }).generate('a fire imp', { xpTable: XP });
  assert.equal(imp.name, 'Cinder Imp');
  assert.equal(imp.xp, 100);
  const [req] = ok.requests;
  assert.equal(req.model, AI_MODEL);
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.model, 'claude-haiku-5-5');
  assert.equal(req.fallbacks, undefined); // Haiku has no refusal fallback
  assert.deepEqual(req.messages, [{ role: 'user', content: 'a fire imp' }]);

  const fails = async (respond) => {
    try {
      await createMonsterGenerator({ client: fakeClient(respond) }).generate('x');
    } catch (e) {
      return e.code;
    }
    assert.fail('expected a failure');
  };
  const headers = new Headers();
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(await fails(() => { throw new Anthropic.RateLimitError(429, {}, 'rate limited', headers); }), 'busy');
    assert.equal(await fails(() => { throw Anthropic.APIError.generate(529, {}, 'overloaded', headers); }), 'busy');
    assert.equal(await fails(() => { throw new Anthropic.APIConnectionError({ message: 'down' }); }), 'busy');
    assert.equal(await fails(() => { throw Anthropic.APIError.generate(400, {}, 'credit balance is too low', headers); }), 'unavailable');
    assert.equal(await fails(() => { throw Anthropic.APIError.generate(401, {}, 'bad key', headers); }), 'unavailable');
  } finally {
    console.error = quiet;
  }
  assert.equal(await fails(() => ({ stop_reason: 'refusal', content: [] })), 'refused');
  assert.equal(await fails(() => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"monsters": [{"na' }] })), 'invalid');
  assert.equal(await fails(() => reply({ monsters: [] })), 'invalid');
  assert.equal(createMonsterGenerator({ client: null }).enabled, false);
});

test('DMs import monsters as JSON, free, and can copy instructions for their own AI', async (t) => {
  const dm = await start(t, { enabled: false, generate: async () => assert.fail('import never calls Claude') });
  const guide = await dm('GET', '/api/bestiary/agent-instructions');
  assert.equal(guide.status, 200);
  assert.match(guide.body.text, /Reply with only JSON/);
  assert.match(guide.body.text, /"monsters"/);
  // The example in the instructions imports cleanly.
  const example = guide.body.text.slice(guide.body.text.indexOf('{'), guide.body.text.lastIndexOf('}') + 1);

  const reply = `Here you go!\n\`\`\`json\n${JSON.stringify({ monsters: [
    { name: 'Aboleth', cr: 10, hp: 135, ac: 17 },
    { name: 'Grave Moth', cr: '2', hp: '18', ac: 12, saves: { dex: 3 }, attacks: ['Bite +5 5ft 1d6+3 piercing'], special: 'Flyby.', url: 'javascript:alert(1)' },
    { hp: 4 },
  ] })}\n\`\`\`\nLet me know if you want more.`;
  const r = await dm('POST', '/api/bestiary/import', { json: reply });
  assert.equal(r.status, 200);
  assert.equal(r.body.skipped, 1);
  assert.deepEqual(r.body.monsters.map((m) => m.name), ['Aboleth 2', 'Grave Moth']);
  const moth = r.body.monsters[1];
  assert.equal(moth.imported, true);
  assert.equal(moth.ai, undefined);
  assert.equal(moth.hp, 18);
  assert.equal(moth.cr, 2);
  assert.equal(moth.xp, 450);
  assert.equal(moth.url, '');
  assert.deepEqual(moth.saves, { str: 0, dex: 3, con: 0, int: 0, wis: 0, cha: 0 });

  assert.equal((await dm('POST', '/api/bestiary/import', { json: example })).body.monsters[0].name, 'Cinder Imp');
  const { bestiary } = (await dm('GET', '/api/state')).body;
  assert.deepEqual(bestiary.filter((m) => m.imported).map((m) => m.name), ['Aboleth 2', 'Grave Moth', 'Cinder Imp']);
  assert.equal((await dm('GET', '/api/me')).body.ai.used, 0);

  assert.equal((await dm('POST', '/api/bestiary/import', { json: '' })).status, 400);
  assert.match((await dm('POST', '/api/bestiary/import', { json: '{"monsters": [' })).body.error, /isn't valid JSON/);
  assert.match((await dm('POST', '/api/bestiary/import', { json: '[{"hp": 3}]' })).body.error, /No monsters with a name/);
  assert.match((await dm('POST', '/api/bestiary/import', { json: JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ name: `M${i}` }))) })).body.error, /at most 200/);
});

test('a single monster or a bare list imports too', () => {
  assert.equal(parseImport('{"name": "Lone Wolf", "cr": 0.25}').monsters[0].name, 'Lone Wolf');
  assert.equal(parseImport('[{"name": "A"}, {"name": "B"}]').monsters.length, 2);
});

test('the generator can try another model and effort; Haiku is asked without a fallback; onResponse sees each reply', async () => {
  const monster = { name: 'Bog Hag', cr: 2, hp: 45, ac: 13, speed: '30', init: 1, saves: { str: 3, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, attacks: ['Claw +5 5ft 2d6+3 slashing'], special: '' };
  const seen = [];
  const client = fakeClient(() => reply({ monsters: [monster] }));
  await createMonsterGenerator({ client, model: 'claude-haiku-5-5', effort: 'low', onResponse: (res, req) => seen.push([res.stop_reason, req.model]) }).generate('hag');
  await createMonsterGenerator({ client, model: 'claude-sonnet-5-5' }).generate('hag');
  const [haiku, sonnet] = client.requests;
  assert.equal(haiku.output_config.effort, 'low');
  assert.equal(haiku.fallbacks, undefined);
  assert.equal(haiku.betas, undefined);
  assert.equal(sonnet.fallbacks, 'default');
  assert.equal(sonnet.output_config.effort, 'medium');
  assert.deepEqual(seen, [['end_turn', 'claude-haiku-5-5']]);
});

test('the typical numbers in the generator prompt match the CR calibration the evals grade with', async () => {
  const { TYPICAL_BY_CR } = await import('../server/ai.js');
  const { srdTable, crIndex } = await import('../evals/balance.js');
  const t = srdTable();
  for (const [cr, hp, ac, bonus, dc, dpr] of TYPICAL_BY_CR) {
    const i = crIndex(cr);
    assert.deepEqual([hp, ac, bonus, dc, dpr], [t.hp[i], t.ac[i], t.bonus[i], t.dc[i], t.dpr[i]].map(Math.round), `CR ${cr}`);
  }
});

test('the Admin page shows each DM\'s AI use against the limit, their AI monsters, and who is near it', async (t) => {
  let calls = 0;
  const dm = await start(t, { enabled: true, generate: async () => { calls++; return [monster(`Imp ${calls}`)]; } }, { aiUses: 5 });
  for (let i = 0; i < 4; i++) assert.equal((await dm('POST', '/api/bestiary/generate', { prompt: 'an imp' })).status, 200);
  // The first account is the admin, so this DM sees the Admin page's data.
  const { totals, dms: [me] } = (await dm('GET', '/api/admin/dms')).body;
  assert.deepEqual({ ...me.ai, lastUsed: typeof me.ai.lastUsed }, { used: 4, limit: 5, lastUsed: 'string', monsters: 4, apps: 0 });
  assert.ok(Date.now() - Date.parse(me.ai.lastUsed) < 60_000);
  assert.deepEqual([totals.aiUsers, totals.aiGenerations, totals.aiNearLimit], [1, 4, 1]);
});
