import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { createApp } from '../server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The app on a real port, with APP_URL set to that port so the MCP endpoint and OAuth are on. One DM signed in.
async function start(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-screen-'));
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createApp({ dataDir, seedDir: path.join(root, 'data', 'seed'), appUrl: base, generator: { enabled: false } }));
  let cookie = '';
  const web = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    cookie = res.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    return { status: res.status, body: await res.json() };
  };
  web.cookie = () => cookie;
  await web('POST', '/api/signup', { email: 'dm@example.com', name: 'Dee', password: 'longenough' });
  return { base, web };
}

// The DM's change events (/api/events), as a browser tab would get them. next() resolves with the next event.
export async function listen(t, base, cookie) {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const res = await fetch(`${base}/api/events`, { headers: { cookie }, signal: controller.signal });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  return {
    async next() {
      while (!buffer.includes('\n\n')) buffer += (await reader.read()).value;
      const [event, ...rest] = buffer.split('\n\n');
      buffer = rest.join('\n\n');
      return event.startsWith(':') ? this.next() : JSON.parse(event.replace(/^data: /, ''));
    },
  };
}

// An MCP client the way Claude does it: on a 401 it discovers the OAuth server, registers, and sends the DM
// to authorize. Here the "browser" is fetch: follow /authorize to /connect, then answer as the signed-in DM.
function aiApp(base, web, { allow = true } = {}) {
  const saved = {};
  const provider = {
    redirectUrl: 'http://127.0.0.1:9999/callback',
    clientMetadata: { client_name: 'Test AI', redirect_uris: ['http://127.0.0.1:9999/callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
    clientInformation: () => saved.client,
    saveClientInformation: (c) => { saved.client = c; },
    tokens: () => saved.tokens,
    saveTokens: (tk) => { saved.tokens = tk; },
    saveCodeVerifier: (v) => { saved.verifier = v; },
    codeVerifier: () => saved.verifier,
    async redirectToAuthorization(url) {
      const res = await fetch(url, { redirect: 'manual' });
      const connect = new URL(res.headers.get('location'), base);
      assert.equal(connect.pathname, '/connect');
      const id = connect.searchParams.get('request');
      saved.consent = (await web('GET', `/api/oauth/request/${id}`)).body;
      saved.callback = new URL((await web('POST', `/api/oauth/request/${id}`, { allow })).body.redirect);
    },
  };
  const connect = async () => {
    const client = new Client({ name: 'test-ai', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), { authProvider: provider }));
    return client;
  };
  // First connect: 401, sign in, then finish with the code and connect again.
  const signIn = async () => {
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', base), { authProvider: provider });
    await assert.rejects(new Client({ name: 'test-ai', version: '0' }).connect(transport), UnauthorizedError);
    if (saved.callback.searchParams.get('code')) await transport.finishAuth(saved.callback.searchParams.get('code'));
  };
  return { provider, saved, connect, signIn };
}

test('without a token /mcp answers 401 and points at the OAuth metadata', async (t) => {
  const { base } = await start(t);
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 401);
  const meta = res.headers.get('www-authenticate').match(/resource_metadata="([^"]+)"/)[1];
  const prm = await (await fetch(meta)).json();
  assert.equal(prm.resource, `${base}/mcp`);
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual([as.issuer, as.code_challenge_methods_supported, Boolean(as.registration_endpoint)], [prm.authorization_servers[0], ['S256'], true]);
});

test('an AI app signs in with OAuth, uses the tools, and its writes reach the DM', async (t) => {
  const { base, web } = await start(t);
  const app = aiApp(base, web);
  await app.signIn();
  assert.deepEqual(app.saved.consent, { clientName: 'Test AI', redirectHost: '127.0.0.1:9999' });
  assert.ok(app.saved.tokens.access_token && app.saved.tokens.refresh_token);

  const events = await listen(t, base, web.cookie());
  const client = await app.connect();
  t.after(() => client.close());
  const found = await client.callTool({ name: 'search_monsters', arguments: { query: 'wolf', maxCr: 1 } });
  assert.match(found.content[0].text, /Wolf/);
  const saved = await client.callTool({ name: 'add_encounters', arguments: { group: 'Woods (level 5)', encounters: [{ name: '1: Wolves', monsters: [{ name: 'Wolf', count: 4 }] }] } });
  assert.equal(saved.isError, undefined);
  assert.equal((await web('GET', '/api/state')).body.encounters.at(-1).group, 'Woods (level 5)');

  // The DM's open tab hears about it, with the app's name.
  assert.deepEqual(await events.next(), { keys: ['encounters'], by: 'Test AI', tab: null });

  const apps = (await web('GET', '/api/oauth/grants')).body;
  assert.deepEqual(apps.map((a) => a.clientName), ['Test AI']);
});

test('refresh tokens work once, and disconnecting the app or changing the password cuts it off', async (t) => {
  const { base, web } = await start(t);
  const app = aiApp(base, web);
  await app.signIn();
  const refresh = (token) => fetch(`${base}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: app.saved.client.client_id }) });
  const old = app.saved.tokens.refresh_token;
  const fresh = await refresh(old);
  assert.equal(fresh.status, 200);
  assert.equal((await refresh(old)).status, 400); // replaced, so the old one is spent
  const tokens = await fresh.json();
  const call = (token) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal((await call(tokens.access_token)).status, 200);

  await web('PUT', '/api/account', { currentPassword: 'longenough', newPassword: 'evenlonger' });
  assert.equal((await call(tokens.access_token)).status, 401);
  assert.equal((await refresh(tokens.refresh_token)).status, 400);

  const again = aiApp(base, web);
  await again.signIn();
  assert.equal((await call(again.saved.tokens.access_token)).status, 200);
  const grants = (await web('GET', '/api/oauth/grants')).body;
  assert.equal(grants.length, 1); // the one the password change cut off isn't listed
  const [grant] = grants;
  await web('DELETE', `/api/oauth/grants/${grant.id}`);
  assert.equal((await call(again.saved.tokens.access_token)).status, 401);
});

test('denying sends the app back with access_denied and connects nothing', async (t) => {
  const { base, web } = await start(t);
  const app = aiApp(base, web, { allow: false });
  await app.signIn();
  assert.equal(app.saved.callback.searchParams.get('error'), 'access_denied');
  assert.equal(app.saved.tokens, undefined);
  assert.deepEqual((await web('GET', '/api/oauth/grants')).body, []);
});

test('a forged access token is refused', async (t) => {
  const { base } = await start(t);
  const body = Buffer.from(JSON.stringify({ g: 'x', e: 9999999999 })).toString('base64url');
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body}.bogus` }, body: '{}' });
  assert.equal(res.status, 401);
});

test('a tab\'s own saves come back marked with its tab id, so it can ignore them', async (t) => {
  const { base, web } = await start(t);
  const events = await listen(t, base, web.cookie());
  await fetch(`${base}/api/state/party`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Tab-Id': 'tab-1', cookie: web.cookie() }, body: '[]' });
  assert.deepEqual(await events.next(), { keys: ['party'], by: null, tab: 'tab-1' });
});
