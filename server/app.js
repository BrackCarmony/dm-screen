import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { FEEDBACK_STATUSES, createDmStore, createFeedbackStore, createUserStore } from './store.js';
import { publicView } from './public.js';
import { createResetToken, findByResetToken, hashPassword, loadSecret, rateLimit, resetLink, sessionCookie, verifyPassword } from './auth.js';
import { createMailer } from './mailer.js';
import { AGENT_INSTRUCTIONS, MAX_PROMPT, createMonsterGenerator, parseImport } from './ai.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'dm';

export function createApp({ dataDir, seedDir, distDir, appUrl = process.env.APP_URL, mailer = createMailer(), adminEmails = process.env.ADMIN_EMAILS, generator = createMonsterGenerator(), aiUses = Number(process.env.AI_BETA_USES) || 5 }) {
  const extraAdmins = new Set(String(adminEmails ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
  const users = createUserStore(dataDir);
  const dms = createDmStore(dataDir, seedDir);
  const feedback = createFeedbackStore(dataDir);
  const session = sessionCookie(loadSecret(dataDir));
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
    res.setHeader('Set-Cookie', `sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${user ? 31536000 : 0}${secure}`);
  };
  // New password: bump sessionVersion so other devices are signed out, and drop any reset token.
  const changePassword = (user, password) =>
    users.update(user.id, { password: hashPassword(password), sessionVersion: (user.sessionVersion ?? 0) + 1, resetHash: null, resetExpires: null });
  const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, slug: u.slug, admin: isAdmin(u) };

  function uniqueSlug(base) {
    let slug = slugify(base);
    if (slug.length < 2) slug = `dm-${slug}`;
    for (let n = 2; users.bySlug(slug); n++) slug = `${slugify(base).slice(0, 26)}-${n}`;
    return slug;
  }

  const limiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });

  // AI monsters (beta): each account gets aiUses generations. A use only counts once the monsters are saved.
  const aiStatus = (u) => ({ enabled: generator.enabled, used: u.aiUses ?? 0, limit: aiUses });

  app.get('/api/me', (req, res) => {
    const user = currentUser(req);
    res.json({ user: publicUser(user), firstAccount: users.count() === 0, ai: user ? aiStatus(user) : null });
  });

  app.post('/api/signup', limiter, (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const name = String(req.body?.name ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    if (!name) return res.status(400).json({ error: 'Enter your name.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (users.byEmail(email)) return res.status(409).json({ error: 'That email already has an account.' });
    const first = users.count() === 0;
    const user = users.add({
      id: crypto.randomUUID(),
      email,
      name,
      slug: uniqueSlug(name),
      password: hashPassword(password),
      sessionVersion: 0,
      admin: first,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });
    dms.create(user.id, { full: first });
    setSession(req, res, user);
    res.json({ user: publicUser(user) });
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
  function addToBestiary(userId, made) {
    const bestiary = dms.get(userId).bestiary;
    const taken = new Set(bestiary.map((m) => m.name.toLowerCase()));
    const monsters = made.map((m) => {
      let name = m.name;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${m.name} ${n}`;
      taken.add(name.toLowerCase());
      return { ...m, name };
    });
    dms.set(userId, 'bestiary', [...bestiary, ...monsters]);
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
    res.json({ monsters: addToBestiary(req.user.id, parsed.monsters), skipped: parsed.skipped });
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
      const monsters = addToBestiary(req.user.id, made);
      const user = users.update(req.user.id, { aiUses: status.used + 1 });
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
    dms.set(req.user.id, req.params.key, req.body);
    broadcast(req.user.slug);
    res.json({ ok: true });
  });

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
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify(view)}\n\n`);
    if (!streams.has(slug)) streams.set(slug, new Set());
    streams.get(slug).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      streams.get(slug)?.delete(res);
    });
  });

  if (distDir && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  return app;
}
