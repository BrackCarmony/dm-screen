import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function client(base) {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

test('DMs send feedback, see only their own, and see it marked by the review script', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-screen-'));
  const app = createApp({ dataDir, seedDir: path.join(root, 'data', 'seed') });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const a = client(base);
  const b = client(base);
  const review = (...args) => execFileSync(process.execPath, [path.join(root, 'scripts/feedback.js'), ...args], { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' });

  assert.equal((await a('POST', '/api/feedback', { message: 'hi' })).status, 401);
  await a('POST', '/api/signup', { email: 'a@example.com', name: 'A', password: 'longenough' });
  await b('POST', '/api/signup', { email: 'b@example.com', name: 'B', password: 'longenough' });

  assert.equal((await a('POST', '/api/feedback', { message: '   ' })).status, 400);
  const sent = await a('POST', '/api/feedback', { message: 'Sort the shop by price', page: 'Magic Shop' });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.status, 'open');
  assert.equal(sent.body.userId, undefined);

  assert.equal((await a('GET', '/api/feedback')).body.length, 1);
  assert.equal((await b('GET', '/api/feedback')).body.length, 0);

  assert.match(review('list'), /Sort the shop by price/);
  const [item] = JSON.parse(review('list', 'all', '--json'));
  assert.equal(item.email, 'a@example.com');
  review('addressed', sent.body.id, 'Added', 'in', 'v2');
  const [mine] = (await a('GET', '/api/feedback')).body;
  assert.equal(mine.status, 'addressed');
  assert.equal(mine.note, 'Added in v2');
  assert.match(review('list'), /No open feedback/);
  review('reopen', sent.body.id);
  assert.equal((await a('GET', '/api/feedback')).body[0].status, 'open');
});
