import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { createGoogleAuth } from '../server/google.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A fake Google: authUrl records what it was asked for; profile returns whoever is "signing in".
function fakeGoogle() {
  const g = { enabled: true, as: null, fail: false, seen: [] };
  g.authUrl = (opts) => { g.last = opts; return `https://google.test/auth?state=${opts.state}`; };
  g.profile = async (opts) => { g.seen.push(opts); if (g.fail) throw new Error('nope'); return g.as; };
  return g;
}

async function start(t, google) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-screen-'));
  const app = createApp({ dataDir, seedDir: path.join(root, 'data', 'seed'), google, appUrl: 'https://dm.example.com ', adminEmails: '' });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

// A browser: keeps cookies, doesn't follow redirects.
function browser(base) {
  const jar = new Map();
  const go = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';');
      const [k, v] = kv.split('=');
      if (attrs.some((a) => a.trim() === 'Max-Age=0')) jar.delete(k); else jar.set(k, v);
    }
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, location: res.headers.get('location'), body: type.includes('json') ? await res.json() : null };
  };
  // Click "Sign in with Google", then come back from Google with the given state.
  go.signIn = async (state) => {
    const start = await go('GET', '/api/auth/google');
    const sent = new URL(start.location).searchParams.get('state');
    return go('GET', `/api/auth/google/callback?code=abc&state=${state ?? sent}`);
  };
  go.jar = jar;
  return go;
}

const errorOf = (r) => new URL(r.location, 'http://x').searchParams.get('login_error');

test('signing in with Google creates an account, then signs back into it', async (t) => {
  const google = fakeGoogle();
  const base = await start(t, google);
  const b = browser(base);
  assert.equal((await b('GET', '/api/me')).body.google, true);

  const startRes = await b('GET', '/api/auth/google');
  assert.equal(startRes.status, 302);
  assert.equal(google.last.redirectUri, 'https://dm.example.com/api/auth/google/callback');
  const [cookieState, cookieVerifier] = b.jar.get('g_oauth').split('.');
  assert.equal(cookieState, new URL(startRes.location).searchParams.get('state'));

  google.as = { sub: 'g-1', email: 'new@example.com', emailVerified: true, name: 'Nia Grey' };
  const back = await b('GET', `/api/auth/google/callback?code=abc&state=${new URL(startRes.location).searchParams.get('state')}`);
  assert.equal(back.status, 302);
  assert.equal(back.location, '/#help');
  assert.equal(b.jar.has('g_oauth'), false, 'the state cookie is cleared');
  assert.equal(google.seen[0].verifier, cookieVerifier, 'the PKCE verifier from the cookie goes to Google');
  assert.equal(google.seen[0].redirectUri, 'https://dm.example.com/api/auth/google/callback');
  const me = (await b('GET', '/api/me')).body.user;
  assert.equal(me.email, 'new@example.com');
  assert.equal(me.name, 'Nia Grey');
  assert.equal(me.slug, 'nia-grey');
  assert.equal(me.admin, true, 'the first account is the admin, however it signs up');
  assert.ok((await b('GET', '/api/state')).body.bestiary.length > 0);

  // Signing in again finds the same account, even if the Google email has changed since.
  const again = browser(base);
  google.as = { sub: 'g-1', email: 'renamed@example.com', emailVerified: true, name: 'Nia' };
  assert.equal((await again.signIn()).location, '/');
  assert.equal((await again('GET', '/api/me')).body.user.id, me.id);

  // A Google-only account has no password to log in with.
  assert.equal((await browser(base)('POST', '/api/login', { email: 'new@example.com', password: 'null' })).status, 401);
});

test('Google sign-in joins a password account with the same verified email', async (t) => {
  const google = fakeGoogle();
  const base = await start(t, google);
  const pw = browser(base);
  const { user } = (await pw('POST', '/api/signup', { email: 'dm@example.com', name: 'Dee', password: 'longenough' })).body;

  // Unverified email: not joined, and no account made.
  const sneaky = browser(base);
  google.as = { sub: 'g-x', email: 'dm@example.com', emailVerified: false, name: 'Not Dee' };
  assert.match(errorOf(await sneaky.signIn()), /hasn't verified/);
  assert.equal((await sneaky('GET', '/api/me')).body.user, null);

  const g = browser(base);
  google.as = { sub: 'g-2', email: 'dm@example.com', emailVerified: true, name: 'Dee G' };
  assert.equal((await g.signIn()).location, '/');
  const me = (await g('GET', '/api/me')).body.user;
  assert.equal(me.id, user.id);
  assert.equal(me.name, 'Dee', 'joining keeps the account as it was');
  // The password still works too.
  assert.equal((await browser(base)('POST', '/api/login', { email: 'dm@example.com', password: 'longenough' })).status, 200);
});

test('Google sign-in refuses bad state, cancellations and failures', async (t) => {
  const google = fakeGoogle();
  google.as = { sub: 'g-3', email: 'x@example.com', emailVerified: true, name: 'X' };
  const base = await start(t, google);

  const b = browser(base);
  assert.match(errorOf(await b('GET', '/api/auth/google/callback?code=abc&state=zzz')), /expired/);
  assert.match(errorOf(await b.signIn('wrong-state')), /expired/);
  assert.match(errorOf(await b('GET', '/api/auth/google/callback?error=access_denied')), /cancelled/);
  google.fail = true;
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.match(errorOf(await b.signIn()), /Couldn't sign in/);
  } finally {
    console.error = quiet;
  }
  assert.equal((await b('GET', '/api/me')).body.user, null);

  const off = browser(await start(t, { enabled: false }));
  assert.equal((await off('GET', '/api/me')).body.google, false);
  assert.match(errorOf(await off('GET', '/api/auth/google')), /isn't set up/);
});

test('the Google ID token is checked before it is trusted', async () => {
  const token = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  const good = { aud: 'cid', iss: 'https://accounts.google.com', exp: Date.now() / 1000 + 60, sub: '42', email: 'A@Example.com', email_verified: true, name: 'A' };
  const auth = (claims, ok = true) => createGoogleAuth({ clientId: 'cid', clientSecret: 'sec', fetchImpl: async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(init.body);
    assert.equal(form.get('code_verifier'), 'v');
    assert.equal(form.get('client_secret'), 'sec');
    return { ok, status: ok ? 200 : 400, json: async () => (ok ? { id_token: token(claims) } : { error: 'invalid_grant' }) };
  } });
  const args = { code: 'c', redirectUri: 'https://dm.example.com/api/auth/google/callback', verifier: 'v' };

  assert.deepEqual(await auth(good).profile(args), { sub: '42', email: 'a@example.com', emailVerified: true, name: 'A' });
  assert.equal((await auth({ ...good, email_verified: 'false' }).profile(args)).emailVerified, false);
  await assert.rejects(auth({ ...good, aud: 'other' }).profile(args), /failed its checks/);
  await assert.rejects(auth({ ...good, iss: 'evil.com' }).profile(args), /failed its checks/);
  await assert.rejects(auth({ ...good, exp: Date.now() / 1000 - 1 }).profile(args), /failed its checks/);
  await assert.rejects(auth(good, false).profile(args), /invalid_grant/);

  const url = new URL(createGoogleAuth({ clientId: 'cid', clientSecret: 'sec' }).authUrl({ redirectUri: 'https://dm.example.com/cb', state: 's', challenge: 'c' }));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(createGoogleAuth({ clientId: '', clientSecret: '' }).enabled, false);
});
