import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createStore } from './store.js';
import { publicView } from './public.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
const PASSWORD = process.env.DM_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || PASSWORD || 'dev';

if (!PASSWORD) console.warn('DM_PASSWORD is not set: DM pages are open to anyone. Set it before deploying.');

const store = createStore(DATA_DIR, path.join(root, 'data', 'seed'));
const app = express();
app.use(express.json({ limit: '5mb' }));

const token = crypto.createHmac('sha256', SECRET).update(`dm:${PASSWORD}`).digest('hex');

function isDm(req) {
  if (!PASSWORD) return true;
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)dm=([a-f0-9]+)/);
  return !!m && m[1].length === token.length && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(token));
}

function requireDm(req, res, next) {
  if (isDm(req)) return next();
  res.status(401).json({ error: 'login required' });
}

app.get('/api/me', (req, res) => res.json({ dm: isDm(req), passwordSet: !!PASSWORD }));

app.post('/api/login', (req, res) => {
  const given = String(req.body?.password ?? '');
  const ok = PASSWORD && given.length === PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(PASSWORD));
  if (!ok) return res.status(401).json({ error: 'wrong password' });
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `dm=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`);
  res.json({ dm: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'dm=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ dm: false });
});

app.get('/api/state', requireDm, (req, res) => res.json(store.get()));

app.put('/api/state/:key', requireDm, (req, res) => {
  if (!store.keys.includes(req.params.key)) return res.status(404).json({ error: 'unknown key' });
  store.set(req.params.key, req.body);
  broadcast();
  res.json({ ok: true });
});

// Players' view: initiative order of the active battle, pushed live over SSE.
const clients = new Set();
let lastPublic = '';

function broadcast() {
  const body = JSON.stringify(publicView(store.get()));
  if (body === lastPublic) return;
  lastPublic = body;
  for (const res of clients) res.write(`data: ${body}\n\n`);
}

app.get('/api/public', (req, res) => res.json(publicView(store.get())));

app.get('/api/public/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify(publicView(store.get()))}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

const dist = path.join(root, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`dm-screen listening on http://localhost:${PORT}`));
