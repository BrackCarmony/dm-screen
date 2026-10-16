// DM Screen as an OAuth 2.1 authorization server, so AI apps (Claude Code, a claude.ai connector) can use
// a DM's campaign over MCP at /mcp. The SDK's mcpAuthRouter serves the protocol endpoints (/authorize,
// /token, /register, /revoke, /.well-known/...); this is the part it leaves to us: who the clients are,
// asking the DM, and issuing and checking tokens.
//
// The flow: an app registers itself (/register), sends the DM to /authorize, which we redirect to the app's
// /connect page. The DM signs in if needed and allows it; we redirect back to the app with a one-time code,
// which the app trades at /token (proving it with PKCE) for an access token and a refresh token.
//
// Each allowed app is a grant in $DATA_DIR/oauth.json. Access tokens are signed, last an hour and aren't
// stored; refresh tokens are stored hashed and replaced on every use. Every access token is checked against
// its grant, so disconnecting the app (Account page) or changing the password (sessionVersion) cuts it off at once.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

const ACCESS_TTL_S = 60 * 60;
const REFRESH_IDLE_MS = 90 * 24 * 60 * 60 * 1000; // a refresh token unused this long stops working
const REQUEST_TTL_MS = 15 * 60 * 1000; // time for the DM to sign in and allow
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_CLIENTS = 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const sameString = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function createOAuthStore(dataDir) {
  const file = path.join(dataDir, 'oauth.json');
  let data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { clients: [], grants: [] };
  const save = () => {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };
  return {
    client: (id) => data.clients.find((c) => c.client_id === id),
    addClient(client) {
      // Registration is open to anyone, so drop the oldest clients nobody ever connected once there are many.
      const used = new Set(data.grants.map((g) => g.clientId));
      const unused = data.clients.filter((c) => !used.has(c.client_id));
      if (data.clients.length >= MAX_CLIENTS && unused.length) data.clients = data.clients.filter((c) => c !== unused[0]);
      data.clients.push(client);
      save();
      return client;
    },
    grant: (id) => data.grants.find((g) => g.id === id),
    grantByRefresh: (hash) => data.grants.find((g) => g.refreshHash && sameString(g.refreshHash, hash)),
    grantsFor: (userId) => data.grants.filter((g) => g.userId === userId),
    addGrant(grant) {
      data.grants.push(grant);
      save();
    },
    updateGrant(id, patch) {
      data.grants = data.grants.map((g) => (g.id === id ? { ...g, ...patch } : g));
      save();
    },
    removeGrant(id) {
      data.grants = data.grants.filter((g) => g.id !== id);
      save();
    },
  };
}

// mcpUrl is the MCP endpoint (https://<site>/mcp): every token is issued for it alone.
export function createOAuthProvider({ dataDir, secret, users, mcpUrl }) {
  const store = createOAuthStore(dataDir);
  const requests = new Map(); // request id -> { clientId, params, expires }: waiting for the DM to answer
  const codes = new Map(); // sha256(code) -> { clientId, userId, codeChallenge, redirectUri, expires }
  const sweep = (map) => { for (const [k, v] of map) if (v.expires < Date.now()) map.delete(k); };

  const sign = (body) => crypto.createHmac('sha256', `${secret}:oauth`).update(body).digest('base64url');
  function issueTokens(grant) {
    const refresh = random();
    store.updateGrant(grant.id, { refreshHash: sha256(refresh), lastUsed: new Date().toISOString() });
    const body = Buffer.from(JSON.stringify({ g: grant.id, e: Math.floor(Date.now() / 1000) + ACCESS_TTL_S })).toString('base64url');
    return { access_token: `${body}.${sign(body)}`, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh };
  }
  // A grant is good while it exists and the DM hasn't changed their password since allowing it.
  const liveGrant = (grant) => {
    const user = grant && users.byId(grant.userId);
    return user && (user.sessionVersion ?? 0) === grant.sessionVersion ? user : null;
  };

  const provider = {
    clientsStore: {
      getClient: (id) => store.client(id),
      registerClient: (client) => store.addClient({ ...client, client_id: crypto.randomUUID(), client_id_issued_at: Math.floor(Date.now() / 1000) }),
    },

    // The SDK has checked the client and its redirect URI. Hand over to the app's page, which asks the DM.
    async authorize(client, params, res) {
      sweep(requests);
      const id = random();
      requests.set(id, { clientId: client.client_id, params, expires: Date.now() + REQUEST_TTL_MS });
      res.redirect(`/connect?request=${id}`);
    },

    async challengeForAuthorizationCode(client, code) {
      const c = codes.get(sha256(code));
      if (!c || c.clientId !== client.client_id || c.expires < Date.now()) throw new InvalidGrantError('Unknown or expired code');
      return c.codeChallenge;
    },

    // The SDK has already checked the PKCE verifier against the challenge above.
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
      const key = sha256(code);
      const c = codes.get(key);
      codes.delete(key); // one use only
      if (!c || c.clientId !== client.client_id || c.expires < Date.now()) throw new InvalidGrantError('Unknown or expired code');
      if (redirectUri && redirectUri !== c.redirectUri) throw new InvalidGrantError('redirect_uri does not match');
      const user = users.byId(c.userId);
      if (!user) throw new InvalidGrantError('Unknown account');
      // The app is connected once it has its tokens, not when the DM clicks Allow.
      const grant = {
        id: crypto.randomUUID(),
        userId: user.id,
        clientId: client.client_id,
        clientName: client.client_name || 'An unnamed app',
        redirectHost: new URL(c.redirectUri).host,
        sessionVersion: user.sessionVersion ?? 0,
        createdAt: new Date().toISOString(),
      };
      store.addGrant(grant);
      return issueTokens(grant);
    },

    async exchangeRefreshToken(client, refreshToken) {
      const grant = store.grantByRefresh(sha256(refreshToken));
      if (!grant || grant.clientId !== client.client_id || !liveGrant(grant)) throw new InvalidGrantError('Unknown refresh token');
      if (Date.now() - Date.parse(grant.lastUsed) > REFRESH_IDLE_MS) throw new InvalidGrantError('Refresh token expired');
      return issueTokens(grant);
    },

    async verifyAccessToken(token) {
      const [body, sig] = String(token).split('.');
      if (!body || !sig || !sameString(sig, sign(body))) throw new InvalidTokenError('Invalid token');
      const { g, e } = JSON.parse(Buffer.from(body, 'base64url').toString());
      const grant = store.grant(g);
      const user = liveGrant(grant);
      if (!user) throw new InvalidTokenError('Access was removed');
      if (e < Date.now() / 1000) throw new InvalidTokenError('Token expired');
      return { token, clientId: grant.clientId, scopes: [], expiresAt: e, resource: new URL(mcpUrl), extra: { userId: user.id, grantId: grant.id, clientName: grant.clientName } };
    },

    async revokeToken(client, { token }) {
      const grant = store.grantByRefresh(sha256(token));
      if (grant?.clientId === client.client_id) store.removeGrant(grant.id);
    },
  };

  return {
    provider,
    // For the /connect page: what's asking, or null if the request is unknown or expired.
    request(id) {
      const r = requests.get(String(id));
      if (!r || r.expires < Date.now()) return null;
      const client = store.client(r.clientId);
      return client && { clientName: client.client_name || 'An unnamed app', redirectHost: new URL(r.params.redirectUri).host };
    },
    // The DM's answer. Returns the URL to send the browser back to the app.
    answer(id, user, allow) {
      const r = requests.get(String(id));
      requests.delete(String(id));
      if (!r || r.expires < Date.now()) return null;
      const back = new URL(r.params.redirectUri);
      if (r.params.state !== undefined) back.searchParams.set('state', r.params.state);
      if (!allow) {
        back.searchParams.set('error', 'access_denied');
        return back.href;
      }
      sweep(codes);
      const code = random();
      codes.set(sha256(code), { clientId: r.clientId, userId: user.id, codeChallenge: r.params.codeChallenge, redirectUri: r.params.redirectUri, expires: Date.now() + CODE_TTL_MS });
      back.searchParams.set('code', code);
      return back.href;
    },
    // The DM's connected apps. Grants a password change has cut off are dropped here rather than listed.
    grants(userId) {
      const [live, dead] = store.grantsFor(userId).reduce(([l, d], g) => (liveGrant(g) ? [[...l, g], d] : [l, [...d, g]]), [[], []]);
      for (const g of dead) store.removeGrant(g.id);
      return live.map(({ id, clientName, redirectHost, createdAt, lastUsed }) => ({ id, clientName, redirectHost, createdAt, lastUsed }));
    },
    removeGrant(userId, id) {
      const g = store.grant(id);
      if (!g || g.userId !== userId) return false;
      store.removeGrant(id);
      return true;
    },
  };
}
