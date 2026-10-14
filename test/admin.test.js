import test from 'node:test';
import assert from 'node:assert/strict';
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

test('admins see all feedback with emails and mark it from the Admin page; other DMs cannot', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-screen-'));
  const app = createApp({ dataDir, seedDir: path.join(root, 'data', 'seed'), adminEmails: '' });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const boss = client(base);
  const dm = client(base);

  await boss('POST', '/api/signup', { email: 'boss@example.com', name: 'Boss', password: 'longenough' });
  const dee = (await dm('POST', '/api/signup', { email: 'dm@example.com', name: 'Dee', password: 'longenough' })).body.user;
  // More than the 20 the page used to show (written directly; the send limit is 10 per DM). The store reads the file on each call.
  const at = (i) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
  const seeded = Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, userId: dee.id, name: 'Dee', email: 'dm@example.com', page: 'Bestiary', message: `idea ${i}`, status: 'open', note: '', createdAt: at(i), updatedAt: at(i) }));
  fs.writeFileSync(path.join(dataDir, 'feedback.json'), JSON.stringify(seeded));
  const items = (await boss('GET', '/api/admin/dms')).body.feedback;
  assert.equal(items.length, 25);
  const newest = items[0];
  assert.equal(newest.message, 'idea 24');
  assert.equal(newest.email, 'dm@example.com');
  assert.equal(newest.note, '');

  assert.equal((await client(base)('PUT', `/api/admin/feedback/${newest.id}`, { status: 'addressed' })).status, 401);
  assert.equal((await dm('PUT', `/api/admin/feedback/${newest.id}`, { status: 'addressed' })).status, 403);
  assert.equal((await boss('PUT', `/api/admin/feedback/${newest.id}`, { status: 'done' })).status, 400);
  assert.equal((await boss('PUT', `/api/admin/feedback/${newest.id}`, { status: 'addressed', note: 'x'.repeat(2001) })).status, 400);
  assert.equal((await boss('PUT', '/api/admin/feedback/nope', { status: 'addressed' })).status, 404);

  const marked = await boss('PUT', `/api/admin/feedback/${newest.id}`, { status: 'addressed', note: '  Added a type filter  ' });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.status, 'addressed');
  assert.equal(marked.body.note, 'Added a type filter');
  assert.equal(marked.body.email, 'dm@example.com');

  const mine = (await dm('GET', '/api/feedback')).body.find((f) => f.id === newest.id);
  assert.equal(mine.status, 'addressed');
  assert.equal(mine.note, 'Added a type filter');
  const totals = (await boss('GET', '/api/admin/dms')).body.totals;
  assert.equal(totals.openFeedback, 24);

  // Reopening without a note keeps the reply.
  const reopened = await boss('PUT', `/api/admin/feedback/${newest.id}`, { status: 'open' });
  assert.equal(reopened.body.status, 'open');
  assert.equal(reopened.body.note, 'Added a type filter');
});
