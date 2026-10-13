import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { createDmStore, createUserStore } from './store.js';
import { publicView } from './public.js';
import { createResetToken, findByResetToken, hashPassword, loadSecret, rateLimit, resetLink, sessionCookie, verifyPassword } from './auth.js';
import { createMailer } from './mailer.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'dm';

export function createApp({ dataDir, seedDir, distDir, appUrl = process.env.APP_URL, mailer = createMailer() }) {
  const users = createUserStore(dataDir);
  const dms = createDmStore(dataDir, seedDir);
  const session = sessionCookie(loadSecret(dataDir));
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '5mb' }));

  const currentUser = (req) => session.read(req.headers.cookie, users.byId);
  const requireDm = (req, res, next) => {
    req.user = currentUser(req);
    if (req.user) return next();
    res.status(401).json({ error: 'login required' });
  };
  const setSession = (req, res, user) => {
    const secure = req.secure ? '; Secure' : '';
    const value = user ? encodeURIComponent(session.issue(user)) : '';
    res.setHeader('Set-Cookie', `sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${user ? 31536000 : 0}${secure}`);
  };
  // New password: bump sessionVersion so other devices are signed out, and drop any reset token.
  const changePassword = (user, password) =>
    users.update(user.id, { password: hashPassword(password), sessionVersion: (user.sessionVersion ?? 0) + 1, resetHash: null, resetExpires: null });
  const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, slug: u.slug };

  function uniqueSlug(base) {
    let slug = slugify(base);
    if (slug.length < 2) slug = `dm-${slug}`;
    for (let n = 2; users.bySlug(slug); n++) slug = `${slugify(base).slice(0, 26)}-${n}`;
    return slug;
  }

  const limiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });

  app.get('/api/me', (req, res) => res.json({ user: publicUser(currentUser(req)), firstAccount: users.count() === 0 }));

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
      createdAt: new Date().toISOString(),
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
    setSession(req, res, user);
    res.json({ user: publicUser(user) });
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
