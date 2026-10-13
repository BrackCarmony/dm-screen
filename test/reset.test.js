import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function setup(t, opts = {}) {
  const sent = [];
  const mailer = { enabled: true, sendReset: async (to, link) => sent.push({ to, link }) };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-screen-'));
  const app = createApp({ dataDir, seedDir: path.join(root, 'data', 'seed'), appUrl: 'https://dm.example.com', mailer, ...opts });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  };
  return { sent, client };
}

test('forgot password emails a one-time link that sets a new password', async (t) => {
  const { sent, client } = await setup(t);
  const laptop = client();
  await laptop('POST', '/api/signup', { email: 'sam@example.com', name: 'Sam', password: 'first-password' });

  const anon = client();
  assert.deepEqual((await anon('POST', '/api/forgot', { email: 'nobody@example.com' })).body, { ok: true });
  assert.equal(sent.length, 0);
  assert.deepEqual((await anon('POST', '/api/forgot', { email: 'SAM@example.com' })).body, { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'sam@example.com');
  assert.match(sent[0].link, /^https:\/\/dm\.example\.com\/reset\?token=/);
  const token = new URL(sent[0].link).searchParams.get('token');

  assert.equal((await anon('POST', '/api/reset', { token: 'bogus', password: 'new-password' })).status, 400);
  assert.equal((await anon('POST', '/api/reset', { token, password: 'short' })).status, 400);
  const r = await anon('POST', '/api/reset', { token, password: 'new-password' });
  assert.equal(r.status, 200);
  assert.equal((await anon('GET', '/api/state')).status, 200, 'reset logs you in');

  // The link is single use, the old session is signed out, and only the new password works.
  assert.equal((await anon('POST', '/api/reset', { token, password: 'another-one' })).status, 400);
  assert.equal((await laptop('GET', '/api/state')).status, 401);
  assert.equal((await client()('POST', '/api/login', { email: 'sam@example.com', password: 'first-password' })).status, 401);
  assert.equal((await client()('POST', '/api/login', { email: 'sam@example.com', password: 'new-password' })).status, 200);
});

test('changing password keeps this device and signs out others', async (t) => {
  const { client } = await setup(t);
  const phone = client();
  const laptop = client();
  await phone('POST', '/api/signup', { email: 'a@example.com', name: 'A', password: 'password-1' });
  await laptop('POST', '/api/login', { email: 'a@example.com', password: 'password-1' });
  assert.equal((await phone('PUT', '/api/account', { currentPassword: 'wrong', newPassword: 'password-2' })).status, 401);
  assert.equal((await phone('PUT', '/api/account', { currentPassword: 'password-1', newPassword: 'password-2' })).status, 200);
  assert.equal((await phone('GET', '/api/state')).status, 200);
  assert.equal((await laptop('GET', '/api/state')).status, 401);
});

test('without APP_URL a configured mailer sends nothing', async (t) => {
  const { sent, client } = await setup(t, { appUrl: '' });
  const c = client();
  await c('POST', '/api/signup', { email: 'b@example.com', name: 'B', password: 'password-1' });
  await c('POST', '/api/forgot', { email: 'b@example.com' });
  assert.equal(sent.length, 0);
});
