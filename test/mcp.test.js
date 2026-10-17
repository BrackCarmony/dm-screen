import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApp } from '../server/app.js';
import { createMcpServer } from '../server/mcp.js';
import { createDmStore, createUserStore } from '../server/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = path.join(root, 'data', 'seed');

const monster = (name, extra = {}) => ({ name, cr: 2, hp: 30, ac: 13, speed: '30', init: 1, saves: { str: 2, dex: 1, con: 2, int: -2, wis: 0, cha: -1 }, attacks: ['Bite +4 5ft 1d8+2 piercing'], special: 'Keen Smell.', ...extra });

// A web app and an MCP client on the same data folder, with one DM signed up in the app.
async function start(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-screen-'));
  const app = createApp({ dataDir, seedDir, generator: { enabled: false } });
  const http = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  t.after(() => http.close());
  let cookie = '';
  const web = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${http.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    cookie = res.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    return res.json();
  };
  await web('POST', '/api/signup', { email: 'dm@example.com', name: 'Dee', password: 'longenough' });

  const dm = createUserStore(dataDir).byEmail('dm@example.com');
  const server = createMcpServer({ dms: createDmStore(dataDir, seedDir), dm });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  t.after(() => client.close());
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    return { error: Boolean(r.isError), text: r.content[0].text };
  };
  return { web, call, client };
}

test('monsters added over MCP show up in the web app, tagged AI, and survive the app saving', async (t) => {
  const { web, call } = await start(t);
  const r = await call('add_monsters', { request: 'woods, level 5', monsters: [monster('Thornback Boar'), monster('Thornback Boar', { cr: 5 })] });
  assert.equal(r.error, false);
  assert.match(r.text, /Thornback Boar 2 .*renamed/);

  const added = (await web('GET', '/api/state')).bestiary.filter((m) => m.name.startsWith('Thornback'));
  assert.deepEqual(added.map((m) => [m.name, m.cr, m.xp, m.ai, m.aiPrompt]), [
    ['Thornback Boar', 2, 450, true, 'woods, level 5'],
    ['Thornback Boar 2', 5, 1800, true, 'woods, level 5'],
  ]);

  // The app saving another collection rewrites the whole file; the MCP's monsters must still be there.
  await web('PUT', '/api/state/party', [{ id: 'P1', name: 'Ulf', inParty: true }]);
  const after = await web('GET', '/api/state');
  assert.equal(after.bestiary.filter((m) => m.name.startsWith('Thornback')).length, 2);
  assert.equal(after.party.length, 1);
});

test('add_encounters saves nothing when a monster is unknown, and otherwise expands counts to exact names', async (t) => {
  const { web, call } = await start(t);
  const before = (await web('GET', '/api/state')).encounters.length;

  const bad = await call('add_encounters', { group: 'Woods (level 5)', encounters: [{ name: '1: Wolves', monsters: [{ name: 'Wolf', count: 3 }] }, { name: '2: ?', monsters: [{ name: 'Moss Horror' }] }] });
  assert.equal(bad.error, true);
  assert.match(bad.text, /Nothing saved.*Moss Horror/);
  assert.equal((await web('GET', '/api/state')).encounters.length, before);

  const ok = await call('add_encounters', { group: 'Woods (level 5)', encounters: [{ name: 'Wolves', weight: 2, note: 'They circle first.', monsters: [{ name: 'wolf', count: 3 }, { name: 'Dire Wolf' }] }] });
  assert.equal(ok.error, false);
  assert.match(ok.text, /1-2 +Wolves: 3× Wolf, Dire Wolf/);
  const saved = (await web('GET', '/api/state')).encounters.at(-1);
  assert.deepEqual([saved.group, saved.name, saved.weight, saved.note, saved.monsters], ['Woods (level 5)', 'Wolves', 2, 'They circle first.', ['Wolf', 'Wolf', 'Wolf', 'Dire Wolf']]);

  // Names are matched ignoring spacing and punctuation, and saved as the bestiary spells them.
  await web('PUT', '/api/state/bestiary', [...(await web('GET', '/api/state')).bestiary, monster('dire-boar')]);
  await call('add_encounters', { group: 'Woods (level 5)', encounters: [{ name: 'Boar', monsters: [{ name: 'Dire Boar' }] }] });
  assert.deepEqual((await web('GET', '/api/state')).encounters.at(-1).monsters, ['dire-boar']);

  // A second batch with the group in different case joins the same group.
  await call('add_encounters', { group: 'woods (LEVEL 5)', encounters: [{ name: 'Owlbear', monsters: [{ name: 'Owlbear' }] }] });
  assert.match((await call('list_encounters', {})).text, /3× Woods \(level 5\)/);
  const table = (await call('list_encounters', { group: 'Woods (level 5)' })).text;
  assert.match(table, /^3 +Boar: dire-boar/m);
  assert.match(table, /^4 +Owlbear: Owlbear - 700 XP\n/m); // no levels set, so no difficulty
  assert.match(table, /Roll 1-4/);

  // With levels on the Party page, entries and encounter_xp are rated.
  await web('PUT', '/api/state/party', [{ id: 'P1', name: 'Ulf', inParty: true, level: 3 }, { id: 'P2', name: 'Ada', inParty: true, level: 3 }, { id: 'P3', name: 'Pip', inParty: true }]);
  assert.match((await call('list_encounters', { group: 'Woods (level 5)' })).text, /Owlbear: Owlbear - 700 XP, Hard/); // hard 2 × 225, deadly 2 × 400
  const xp = await call('encounter_xp', { monsters: [{ name: 'Wolf', count: 2 }] });
  assert.match(xp.text, /Easy for the party \(levels 3, 3\)/); // 100 × 1.5 = 150: easy 150, medium 300
});

test('the random encounter table prompt names the tools and the place', async (t) => {
  const { client } = await start(t);
  const { messages } = await client.getPrompt({ name: 'random_encounter_table', arguments: { environment: 'the woods', entries: '6' } });
  const text = messages[0].content.text;
  for (const s of ['6 encounters', 'the woods', 'dm://party', 'weight', 'search_monsters', 'encounter_xp', 'add_encounters']) assert.ok(text.includes(s), s);
});

test('the store reports which collections another process changed, and not its own writes', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-screen-'));
  const dms = createDmStore(dataDir, seedDir);
  const seen = [];
  dms.onChange((userId, keys, meta) => seen.push([userId, keys, meta]));
  const stop = dms.watch();
  dms.create('dm1');
  dms.set('dm1', 'party', [{ id: 'P1', name: 'Ulf', inParty: true }], { tab: 't' });
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(seen, [['dm1', ['party'], { tab: 't' }]]);

  // Another process (the stdio MCP server) adds an encounter.
  const other = createDmStore(dataDir, seedDir);
  other.set('dm1', 'encounters', [...other.get('dm1').encounters, { id: 'e', group: 'G', name: 'N', note: '', monsters: ['Wolf'] }]);
  await new Promise((r) => setTimeout(r, 150));
  stop();
  assert.deepEqual(seen.at(-1), ['dm1', ['encounters'], {}]);
  assert.equal(seen.length, 2);
});
