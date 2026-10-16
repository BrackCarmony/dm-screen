import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { FEEDBACK_STATUSES, createDmStore, createFeedbackStore, createUserStore } from './store.js';
import { publicView } from './public.js';
import { createResetToken, findByResetToken, hashPassword, loadSecret, rateLimit, resetLink, sessionCookie, verifyPassword } from './auth.js';
import { createMailer } from './mailer.js';
import { AGENT_INSTRUCTIONS, MAX_PROMPT, createMonsterGenerator, parseImport, withUniqueNames } from './ai.js';
import { createGoogleAuth, pkcePair } from './google.js';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createOAuthProvider } from './oauth.js';
import { createMcpServer } from './mcp.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'dm';

export function createApp({ dataDir, seedDir, distDir, appUrl = process.env.APP_URL, mailer = createMailer(), adminEmails = process.env.ADMIN_EMAILS, generator = createMonsterGenerator(), aiUses = Number(process.env.AI_BETA_USES) || 100, google = createGoogleAuth() }) {
  const extraAdmins = new Set(String(adminEmails ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
  const users = createUserStore(dataDir);
  const dms = createDmStore(dataDir, seedDir);
  const feedback = createFeedbackStore(dataDir);
  const secret = loadSecret(dataDir);
  const session = sessionCookie(secret);
  const mcpUrl = appUrl ? new URL('/mcp', appUrl) : null;
  const oauth = mcpUrl && createOAuthProvider({ dataDir, secret, users, mcpUrl: mcpUrl.href });
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '5mb' }));

  const ACTIVE_WRITE_MS = 10 * 60 * 1000;
  // Records when a DM was last seen, at most every few minutes so it doesn't rewrite users.json on every click.
  const touch = (user) => {
    const now = Date.now();
    if (user.lastSeen && now - Date.parse(user.lastSeen) < ACTIVE_WRITE_MS) return user;
    return users.update(user.id, { lastSeen: new Date(now).toISOString() });
  };
  const currentUser = (req) => {
    const user = session.read(req.headers.cookie, users.byId);
    return user ? touch(user) : null;
  };
  // Admins: the first account (flagged at sign-up, or the oldest account on data made before admins existed) and ADMIN_EMAILS.
  const isAdmin = (u) => {
    if (!u) return false;
    if (u.admin === true || extraAdmins.has(u.email)) return true;
    const all = users.all();
    return !all.some((x) => x.admin === true) && all[0]?.id === u.id;
  };
  const requireDm = (req, res, next) => {
    req.user = currentUser(req);
    if (req.user) return next();
    res.status(401).json({ error: 'login required' });
  };
  const requireAdmin = (req, res, next) =>
    requireDm(req, res, () => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'admins only' })));
  const setSession = (req, res, user) => {
    const secure = req.secure ? '; Secure' : '';
    const value = user ? encodeURIComponent(session.issue(user)) : '';
    res.append('Set-Cookie', `sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${user ? 31536000 : 0}${secure}`);
  };
  // New password: bump sessionVersion so other devices are signed out, and drop any reset token.
  const changePassword = (user, password) =>
    users.update(user.id, { password: hashPassword(password), sessionVersion: (user.sessionVersion ?? 0) + 1, resetHash: null, resetExpires: null });
  const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, slug: u.slug, admin: isAdmin(u) };

  // A new DM: the first account on a server is the admin and gets the full campaign seed.
  function createAccount({ email, name, password, googleId }) {
    const first = users.count() === 0;
    const now = new Date().toISOString();
    const user = users.add({
      id: crypto.randomUUID(),
      email,
      name,
      slug: uniqueSlug(name),
      password,
      ...(googleId && { googleId }),
      sessionVersion: 0,
      admin: first,
      createdAt: now,
      lastSeen: now,
    });
    dms.create(user.id, { full: first });
    return user;
  }

  function uniqueSlug(base) {
    let slug = slugify(base);
    if (slug.length < 2) slug = `dm-${slug}`;
    for (let n = 2; users.bySlug(slug); n++) slug = `${slugify(base).slice(0, 26)}-${n}`;
    return slug;
  }

  const limiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });
  // Browser tabs send their id with each save, so a tab can ignore the change events for its own saves.
  const fromTab = (req) => ({ tab: String(req.get('x-tab-id') ?? '').slice(0, 64) || undefined });

  // AI monsters (beta): each account gets aiUses generations. A use only counts once the monsters are saved.
  const aiStatus = (u) => ({ enabled: generator.enabled, used: u.aiUses ?? 0, limit: aiUses });

  app.get('/api/me', (req, res) => {
    const user = currentUser(req);
    res.json({ user: publicUser(user), firstAccount: users.count() === 0, google: google.enabled, ai: user ? aiStatus(user) : null, mcp: mcpUrl?.href ?? null });
  });

  app.post('/api/signup', limiter, (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const name = String(req.body?.name ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    if (!name) return res.status(400).json({ error: 'Enter your name.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (users.byEmail(email)) return res.status(409).json({ error: 'That email already has an account.' });
    const user = createAccount({ email, name, password: hashPassword(password) });
    setSession(req, res, user);
    res.json({ user: publicUser(user) });
  });

  // Sign in with Google. An account is found by its Google id, then by a verified email (so a DM who
  // signed up with a password can use Google for the same account); otherwise a new account is made.
  const googleRedirect = (req) => `${(appUrl || `${req.protocol}://${req.get('host')}`).trim().replace(/\/+$/, '')}/api/auth/google/callback`;
  const googleCookie = (req, value, maxAge) =>
    `g_oauth=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`;
  const loginError = (res, message) => res.redirect(`/?login_error=${encodeURIComponent(message)}`);
  // Where to land after signing in (such as the page allowing an AI app): a path on this site only.
  const safeNext = (next) => (typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '');

  app.get('/api/auth/google', limiter, (req, res) => {
    if (!google.enabled) return loginError(res, "Google sign-in isn't set up on this server.");
    const state = crypto.randomBytes(16).toString('base64url');
    const { verifier, challenge } = pkcePair();
    const next = Buffer.from(safeNext(req.query.next)).toString('base64url');
    res.setHeader('Set-Cookie', googleCookie(req, `${state}.${verifier}.${next}`, 600));
    res.redirect(google.authUrl({ redirectUri: googleRedirect(req), state, challenge }));
  });

  app.get('/api/auth/google/callback', limiter, async (req, res) => {
    const [state, verifier, nextB64 = ''] = (req.headers.cookie?.match(/(?:^|;\s*)g_oauth=([^;]+)/)?.[1] ?? '').split('.');
    res.setHeader('Set-Cookie', googleCookie(req, '', 0));
    if (req.query.error) return loginError(res, 'Google sign-in was cancelled.');
    const given = Buffer.from(String(req.query.state ?? ''));
    if (!state || !verifier || !req.query.code || given.length !== state.length || !crypto.timingSafeEqual(given, Buffer.from(state))) {
      return loginError(res, 'Google sign-in expired. Try again.');
    }
    let profile;
    try {
      profile = await google.profile({ code: String(req.query.code), redirectUri: googleRedirect(req), verifier });
    } catch (e) {
      console.error('[google]', e.message);
      return loginError(res, "Couldn't sign in with Google. Try again.");
    }
    let user = users.all().find((u) => u.googleId === profile.sub);
    let created = false;
    if (!user) {
      if (!profile.email || !profile.emailVerified) return loginError(res, "Google hasn't verified that account's email, so it can't be used to sign in.");
      user = users.byEmail(profile.email);
      if (user) {
        user = users.update(user.id, { googleId: profile.sub });
      } else {
        user = createAccount({ email: profile.email, name: profile.name || profile.email.split('@')[0], password: null, googleId: profile.sub });
        created = true;
      }
    }
    user = users.update(user.id, { lastLogin: new Date().toISOString(), lastSeen: new Date().toISOString() });
    setSession(req, res, user);
    // New accounts start on the getting-started guide, as with sign-up, unless they were on their way somewhere.
    res.redirect(safeNext(Buffer.from(nextB64, 'base64url').toString()) || (created ? '/#help' : '/'));
  });

  app.post('/api/login', limiter, (req, res) => {
    const login = String(req.body?.email ?? '').trim();
    const user = login.includes('@') ? users.byEmail(login) : users.byName(login);
    if (!user || !verifyPassword(String(req.body?.password ?? ''), user.password)) {
      return res.status(401).json({ error: 'Wrong email, name or password.' });
    }
    const updated = users.update(user.id, { lastLogin: new Date().toISOString(), lastSeen: new Date().toISOString() });
    setSession(req, res, updated);
    res.json({ user: publicUser(updated) });
  });

  // Always answers the same way, so it doesn't reveal which emails have accounts.
  app.post('/api/forgot', limiter, async (req, res) => {
    const user = users.byEmail(String(req.body?.email ?? '').trim());
    if (user) {
      // Links are only emailed when APP_URL is set, so a forged Host header can't redirect them.
      const base = appUrl || `http://localhost:${req.socket.localPort}`;
      const link = resetLink(base, createResetToken(users, user));
      try {
        if (appUrl || !mailer.enabled) await mailer.sendReset(user.email, link);
        else console.warn('[password reset] APP_URL is not set, so no email was sent. Run: npm run reset-link --', user.email);
      } catch (e) {
        console.error('[password reset] email failed:', e.message);
      }
    }
    res.json({ ok: true });
  });

  app.post('/api/reset', limiter, (req, res) => {
    const user = findByResetToken(users, req.body?.token);
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired. Ask for a new one.' });
    const password = String(req.body?.password ?? '');
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const updated = changePassword(user, password);
    setSession(req, res, updated);
    res.json({ user: publicUser(updated) });
  });

  app.post('/api/logout', (req, res) => {
    setSession(req, res, null);
    res.json({ user: null });
  });

  app.put('/api/account', requireDm, (req, res) => {
    const patch = {};
    const { name, email, slug, currentPassword, newPassword } = req.body ?? {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Name cannot be empty.' });
      patch.name = String(name).trim();
    }
    if (email !== undefined) {
      const e = String(email).trim().toLowerCase();
      if (!EMAIL_RE.test(e)) return res.status(400).json({ error: 'Enter a valid email.' });
      const owner = users.byEmail(e);
      if (owner && owner.id !== req.user.id) return res.status(409).json({ error: 'That email already has an account.' });
      patch.email = e;
    }
    if (slug !== undefined && slug !== req.user.slug) {
      const s = String(slug).toLowerCase();
      if (!SLUG_RE.test(s)) return res.status(400).json({ error: 'Player link must be 2-31 letters, numbers or dashes.' });
      if (users.bySlug(s)) return res.status(409).json({ error: 'That player link is taken.' });
      patch.slug = s;
    }
    if (newPassword !== undefined) {
      if (!verifyPassword(String(currentPassword ?? ''), req.user.password)) return res.status(401).json({ error: 'Current password is wrong.' });
      if (String(newPassword).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const oldSlug = req.user.slug;
    let user = users.update(req.user.id, patch);
    if (newPassword !== undefined) {
      user = changePassword(user, String(newPassword));
      setSession(req, res, user);
    }
    if (patch.slug) broadcast(oldSlug, { battle: null, order: [], moved: true });
    broadcast(user.slug); // the player view shows the DM's name
    res.json({ user: publicUser(user) });
  });

  // Admin: who has signed up and whether they use it, and all feedback. No campaign contents.
  const adminFeedback = (f) => ({ id: f.id, name: f.name, email: f.email ?? null, page: f.page, message: f.message, status: f.status, note: f.note ?? '', createdAt: f.createdAt, updatedAt: f.updatedAt });

  app.get('/api/admin/dms', requireAdmin, (req, res) => {
    const now = Date.now();
    const within = (iso, days) => !!iso && now - Date.parse(iso) < days * 86400000;
    const allFeedback = feedback.all();
    const dmsList = users.all().map((u) => {
      const st = dms.get(u.id) ?? {};
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        slug: u.slug,
        admin: isAdmin(u),
        createdAt: u.createdAt ?? null,
        lastSeen: u.lastSeen ?? null,
        lastLogin: u.lastLogin ?? null,
        counts: {
          battles: st.battles?.length ?? 0,
          party: st.party?.length ?? 0,
          monsters: st.bestiary?.length ?? 0,
          encounters: st.encounters?.length ?? 0,
          shops: st.shop?.saved?.length ?? 0,
        },
        live: !!st.settings?.activeBattleId,
        feedback: allFeedback.filter((f) => f.userId === u.id).length,
        // AI: in-app generations against the limit, the monsters they made, and AI apps connected over MCP.
        ai: {
          used: u.aiUses ?? 0,
          limit: aiUses,
          lastUsed: u.aiLastUsed ?? null,
          monsters: st.bestiary?.filter((m) => m.ai).length ?? 0,
          apps: oauth ? oauth.grants(u.id).length : 0,
        },
      };
    });
    dmsList.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({
      totals: {
        dms: dmsList.length,
        signups7: dmsList.filter((d) => within(d.createdAt, 7)).length,
        signups30: dmsList.filter((d) => within(d.createdAt, 30)).length,
        active7: dmsList.filter((d) => within(d.lastSeen, 7)).length,
        withBattles: dmsList.filter((d) => d.counts.battles > 0).length,
        openFeedback: allFeedback.filter((f) => f.status === 'open').length,
        aiUsers: dmsList.filter((d) => d.ai.used > 0).length,
        aiGenerations: dmsList.reduce((s, d) => s + d.ai.used, 0),
        aiNearLimit: dmsList.filter((d) => d.ai.used >= 0.8 * d.ai.limit).length,
      },
      dms: dmsList,
      feedback: [...allFeedback].reverse().map(adminFeedback),
    });
  });

  // Mark feedback from the Admin page, as scripts/feedback.js does. The DM sees the status and note.
  app.put('/api/admin/feedback/:id', requireAdmin, (req, res) => {
    const { status, note } = req.body ?? {};
    if (!FEEDBACK_STATUSES.includes(status)) return res.status(400).json({ error: `Status must be one of: ${FEEDBACK_STATUSES.join(', ')}.` });
    if (note !== undefined && String(note).length > 2000) return res.status(400).json({ error: 'Keep the reply under 2,000 characters.' });
    const item = feedback.update(req.params.id, { status, ...(note !== undefined ? { note: String(note).trim() } : {}) });
    if (!item) return res.status(404).json({ error: 'No feedback with that id.' });
    res.json(adminFeedback(item));
  });

  // Feedback: DMs send it and see what happened to theirs; scripts/feedback.js reviews it.
  const feedbackLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });
  const ownFeedback = (f) => ({ id: f.id, page: f.page, message: f.message, status: f.status, note: f.note, createdAt: f.createdAt, updatedAt: f.updatedAt });

  app.get('/api/feedback', requireDm, (req, res) => {
    res.json(feedback.forUser(req.user.id).map(ownFeedback).reverse());
  });

  app.post('/api/feedback', requireDm, feedbackLimiter, (req, res) => {
    const message = String(req.body?.message ?? '').trim();
    const page = String(req.body?.page ?? '').trim().slice(0, 40);
    if (!message) return res.status(400).json({ error: 'Write some feedback first.' });
    if (message.length > 4000) return res.status(400).json({ error: 'Keep it under 4,000 characters.' });
    const now = new Date().toISOString();
    let id;
    do id = crypto.randomBytes(4).toString('hex'); while (feedback.byId(id));
    const item = feedback.add({
      id,
      userId: req.user.id,
      name: req.user.name,
      email: req.user.email,
      page,
      message,
      status: 'open',
      note: '',
      createdAt: now,
      updatedAt: now,
    });
    res.json(ownFeedback(item));
  });

  // Add monsters to a DM's bestiary as it is now (they may have edited it meanwhile), keeping names unique.
  function addToBestiary(userId, made, meta) {
    const bestiary = dms.get(userId).bestiary;
    const monsters = withUniqueNames(bestiary, made);
    dms.set(userId, 'bestiary', [...bestiary, ...monsters], meta);
    return monsters;
  }

  // Monsters made elsewhere (another AI, a friend's export): pasted JSON in the bestiary's shape. Free and needs no key.
  app.get('/api/bestiary/agent-instructions', requireDm, (req, res) => res.json({ text: AGENT_INSTRUCTIONS }));

  const importLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30 });
  app.post('/api/bestiary/import', requireDm, importLimiter, (req, res) => {
    const json = req.body?.json;
    if (typeof json !== 'string' || !json.trim()) return res.status(400).json({ error: 'Paste the monsters JSON first.' });
    let parsed;
    try {
      parsed = parseImport(json, { xpTable: dms.get(req.user.id).xp?.cr ?? [] });
    } catch (e) {
      if (!e.code) throw e;
      return res.status(400).json({ error: e.message });
    }
    res.json({ monsters: addToBestiary(req.user.id, parsed.monsters, fromTab(req)), skipped: parsed.skipped });
  });

  const generating = new Set(); // user ids with a generation in progress
  const aiLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });

  app.post('/api/bestiary/generate', requireDm, aiLimiter, async (req, res) => {
    const prompt = String(req.body?.prompt ?? '').trim();
    const status = aiStatus(req.user);
    if (!status.enabled) return res.status(503).json({ error: "AI monsters aren't set up on this server.", ai: status });
    if (status.used >= status.limit) return res.status(403).json({ error: `You've used all ${status.limit} AI generations in the beta.`, ai: status });
    if (!prompt) return res.status(400).json({ error: 'Describe the monsters you want.', ai: status });
    if (prompt.length > MAX_PROMPT) return res.status(400).json({ error: `Keep the prompt under ${MAX_PROMPT} characters.`, ai: status });
    if (generating.has(req.user.id)) return res.status(409).json({ error: 'Already making monsters. Wait for that to finish.', ai: status });

    generating.add(req.user.id);
    try {
      const made = await generator.generate(prompt, { xpTable: dms.get(req.user.id).xp?.cr ?? [] });
      const monsters = addToBestiary(req.user.id, made, fromTab(req));
      const user = users.update(req.user.id, { aiUses: status.used + 1, aiLastUsed: new Date().toISOString() });
      res.json({ monsters, ai: aiStatus(user) });
    } catch (e) {
      if (!e.code) console.error('[ai] generation failed:', e);
      const code = { busy: 503, unavailable: 503, refused: 422, invalid: 502 }[e.code] ?? 500;
      res.status(code).json({ error: `${e.code ? e.message : 'Something went wrong making monsters.'} This didn't use one of your generations.`, ai: status });
    } finally {
      generating.delete(req.user.id);
    }
  });

  app.get('/api/state', requireDm, (req, res) => res.json(dms.get(req.user.id)));

  app.put('/api/state/:key', requireDm, (req, res) => {
    if (!dms.keys.includes(req.params.key)) return res.status(404).json({ error: 'unknown key' });
    dms.set(req.user.id, req.params.key, req.body, fromTab(req));
    res.json({ ok: true });
  });

  // Each DM's open tabs, told which collections changed and by whom, so they can reload them: an AI app over
  // MCP, another tab or device, or (watching the files) the local stdio MCP server. The player view follows too.
  const dmStreams = new Map(); // userId -> Set<res>
  dms.onChange((userId, keys, meta) => {
    const body = JSON.stringify({ keys, by: meta.by ?? null, tab: meta.tab ?? null });
    for (const res of dmStreams.get(userId) ?? []) res.write(`data: ${body}\n\n`);
    const user = users.byId(userId);
    if (user) broadcast(user.slug);
  });
  dms.watch();

  app.get('/api/events', requireDm, (req, res) => {
    if (!dmStreams.has(req.user.id)) dmStreams.set(req.user.id, new Set());
    eventStream(req, res, dmStreams.get(req.user.id));
  });

  // Remote MCP for AI apps (server/mcp.js) at $APP_URL/mcp, with DM Screen as the OAuth server that
  // signs them in (server/oauth.js). Needs APP_URL: tokens are issued for that exact address.
  if (oauth) {
    app.use(mcpAuthRouter({ provider: oauth.provider, issuerUrl: new URL(appUrl), resourceServerUrl: mcpUrl, resourceName: 'DM Screen' }));
    // No token, or a bad one: 401 with a WWW-Authenticate header pointing at our metadata, which is how
    // an app finds out where to sign in.
    const bearer = requireBearerAuth({ verifier: oauth.provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl), expectedResource: mcpUrl });

    // Stateless: a new server and transport for every request, so there are no sessions to lose on a restart.
    // Replies are plain JSON rather than an event stream, which nginx passes through as is.
    app.post('/mcp', bearer, async (req, res) => {
      // Changes made through the app's tools are marked with its name, so the DM's tabs can say who made them.
      const byApp = { ...dms, set: (userId, key, value) => dms.set(userId, key, value, { by: req.auth.extra.clientName }) };
      const server = createMcpServer({ dms: byApp, dm: touch(users.byId(req.auth.extra.userId)) });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); server.close(); });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (e) {
        console.error('[mcp]', e);
        if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
    });
    // Without sessions there's no stream to open (GET) or session to end (DELETE).
    app.all('/mcp', (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));

    // The /connect page: what's asking, and the DM's answer.
    app.get('/api/oauth/request/:id', requireDm, (req, res) => {
      const request = oauth.request(req.params.id);
      if (!request) return res.status(404).json({ error: 'This request has expired. Start connecting again from your AI app.' });
      res.json(request);
    });
    app.post('/api/oauth/request/:id', requireDm, (req, res) => {
      const redirect = oauth.answer(req.params.id, req.user, req.body?.allow === true);
      if (!redirect) return res.status(404).json({ error: 'This request has expired. Start connecting again from your AI app.' });
      res.json({ redirect });
    });
    app.get('/api/oauth/grants', requireDm, (req, res) => res.json(oauth.grants(req.user.id)));
    app.delete('/api/oauth/grants/:id', requireDm, (req, res) => {
      if (!oauth.removeGrant(req.user.id, req.params.id)) return res.status(404).json({ error: 'Not found.' });
      res.json({ ok: true });
    });
  }

  // Players' view: each DM's active battle, by the DM's player link, pushed live over SSE.
  const streams = new Map(); // slug -> Set<res>
  const last = new Map();

  const viewFor = (slug) => {
    const user = users.bySlug(slug);
    const state = user && dms.get(user.id);
    return state ? { dm: user.name, ...publicView(state) } : null;
  };

  function broadcast(slug, override) {
    const view = override ?? viewFor(slug);
    if (!view) return;
    const body = JSON.stringify(view);
    if (last.get(slug) === body) return;
    last.set(slug, body);
    for (const res of streams.get(slug) ?? []) res.write(`data: ${body}\n\n`);
  }

  app.get('/api/public/:slug', (req, res) => {
    const view = viewFor(req.params.slug);
    if (!view) return res.status(404).json({ error: 'No DM with that link.' });
    res.json(view);
  });

  app.get('/api/public/:slug/stream', (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const view = viewFor(slug);
    if (!view) return res.status(404).json({ error: 'No DM with that link.' });
    if (!streams.has(slug)) streams.set(slug, new Set());
    eventStream(req, res, streams.get(slug), view);
  });

  // A server-sent events response, kept in `set` until the browser goes away. X-Accel-Buffering tells nginx not
  // to hold events back, and the ping keeps proxies from closing a quiet connection.
  function eventStream(req, res, set, first) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (first) res.write(`data: ${JSON.stringify(first)}\n\n`);
    set.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      set.delete(res);
    });
  }

  if (distDir && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  return app;
}
