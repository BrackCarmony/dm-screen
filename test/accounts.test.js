import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startServer(dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-screen-'))) {
  const app = createApp({ dataDir, seedDir: path.join(root, 'data', 'seed') });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => server.close() };
}

function client(base) {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

test('each DM has their own data and player link', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  const brack = client(base);
  const other = client(base);
  const anon = client(base);

  assert.equal((await anon('GET', '/api/me')).body.firstAccount, true);
  assert.equal((await anon('GET', '/api/state')).status, 401);

  const a = await brack('POST', '/api/signup', { email: 'Brack@Example.com', name: 'Brack', password: 'longenough' });
  assert.equal(a.status, 200);
  assert.equal(a.body.user.slug, 'brack');
  const b = await other('POST', '/api/signup', { email: 'sam@example.com', name: 'Sam', password: 'longenough' });
  assert.equal(b.status, 200);
  assert.equal((await anon('POST', '/api/signup', { email: 'brack@example.com', name: 'X', password: 'longenough' })).status, 409);

  // First account gets the full campaign; later ones get starter data only.
  const sa = (await brack('GET', '/api/state')).body;
  const sb = (await other('GET', '/api/state')).body;
  assert.ok(sa.party.length > 0 && sa.battles.length > 0 && sa.shop.saved.length > 0);
  assert.equal(sb.party.length, 0);
  assert.equal(sb.battles.length, 0);
  assert.equal(sb.shop.saved.length, 0);
  assert.equal(sb.bestiary.length, sa.bestiary.length);
  assert.ok(sb.shop.tables.length > 0);
  assert.ok(sb.encounters.length > 0 && sb.encounters.every((e) => e.group === 'Examples'));
  const names = new Set(sb.bestiary.map((m) => m.name));
  assert.ok(sb.encounters.flatMap((e) => e.monsters).every((n) => names.has(n)));

  // Writes stay with their owner.
  await other('PUT', '/api/state/party', [{ id: 'P01', name: 'Mira', inParty: true }]);
  assert.equal((await other('GET', '/api/state')).body.party[0].name, 'Mira');
  assert.notEqual((await brack('GET', '/api/state')).body.party[0].name, 'Mira');

  // Player links show each DM's own live battle.
  await brack('PUT', '/api/state/settings', { activeBattleId: sa.battles[0].id });
  const pa = await anon('GET', '/api/public/brack');
  assert.equal(pa.body.battle, sa.battles[0].name);
  assert.equal((await anon('GET', '/api/public/sam')).body.battle, null);
  assert.equal((await anon('GET', '/api/public/nobody')).status, 404);

  // Login, wrong password, logout.
  const fresh = client(base);
  assert.equal((await fresh('POST', '/api/login', { email: 'sam@example.com', password: 'nope-nope' })).status, 401);
  assert.equal((await fresh('POST', '/api/login', { email: 'SAM@example.com', password: 'longenough' })).status, 200);
  assert.equal((await fresh('GET', '/api/state')).body.party[0].name, 'Mira');
  await fresh('POST', '/api/logout');
  assert.equal((await fresh('POST', '/api/login', { email: 'sam', password: 'longenough' })).status, 200);
  assert.equal((await fresh('GET', '/api/state')).body.party[0].name, 'Mira');
  await fresh('POST', '/api/logout');
  assert.equal((await fresh('GET', '/api/state')).status, 401);

  // Changing the player link.
  assert.equal((await other('PUT', '/api/account', { slug: 'brack' })).status, 409);
  assert.equal((await other('PUT', '/api/account', { slug: 'sams-table' })).body.user.slug, 'sams-table');
  assert.equal((await anon('GET', '/api/public/sams-table')).status, 200);
});

test('forged session cookies are rejected', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  const res = await fetch(`${base}/api/state`, { headers: { cookie: 'sid=someone.deadbeef' } });
  assert.equal(res.status, 401);
});

test('only admins can see the DM list', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  const brack = client(base);
  const sam = client(base);
  await brack('POST', '/api/signup', { email: 'brack@example.com', name: 'Brack', password: 'longenough' });
  const s = await sam('POST', '/api/signup', { email: 'sam@example.com', name: 'Sam', password: 'longenough' });
  assert.equal(s.body.user.admin, false);
  assert.equal((await brack('GET', '/api/me')).body.user.admin, true);

  assert.equal((await client(base)('GET', '/api/admin/dms')).status, 401);
  assert.equal((await sam('GET', '/api/admin/dms')).status, 403);

  const r = await brack('GET', '/api/admin/dms');
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.dms, 2);
  assert.equal(r.body.totals.signups7, 2);
  assert.equal(r.body.totals.active7, 2);
  assert.deepEqual(r.body.dms.map((d) => d.email).sort(), ['brack@example.com', 'sam@example.com']);
  const samRow = r.body.dms.find((d) => d.email === 'sam@example.com');
  assert.equal(samRow.counts.battles, 0);
  assert.ok(samRow.counts.monsters > 0);
  assert.ok(samRow.lastSeen);
  await sam('POST', '/api/feedback', { message: 'Love it', page: 'Battle' });
  const r2 = await brack('GET', '/api/admin/dms');
  assert.equal(r2.body.totals.openFeedback, 1);
  assert.equal(r2.body.feedback[0].message, 'Love it');
  assert.equal(r2.body.dms.find((d) => d.email === 'sam@example.com').feedback, 1);
  assert.equal(JSON.stringify(r.body).includes('scrypt'), false, 'no password hashes');
});

test('accounts from before email sign-up still log in by username', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-screen-'));
  const salt = 'abcd1234';
  const hash = crypto.scryptSync('longenough', salt, 64).toString('hex');
  const old = { id: 'u1', username: 'kedirech', displayName: 'Brack', salt, hash, createdAt: '2026-10-13T00:00:00.000Z' };
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify({ users: [old] }));
  const { base, close } = await startServer(dataDir);
  t.after(close);
  const dm = client(base);

  assert.equal((await dm('POST', '/api/login', { email: 'kedirech', password: 'wrong-one' })).status, 401);
  const res = await dm('POST', '/api/login', { email: 'Kedirech', password: 'longenough' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.user, { id: 'u1', email: null, name: 'Brack', slug: 'kedirech', admin: true });
  assert.equal((await dm('PUT', '/api/account', { email: 'brack@example.com' })).body.user.email, 'brack@example.com');
  await dm('POST', '/api/logout');
  assert.equal((await dm('POST', '/api/login', { email: 'brack@example.com', password: 'longenough' })).status, 200);
});
