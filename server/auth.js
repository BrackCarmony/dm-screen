import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const given = crypto.scryptSync(password, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// SESSION_SECRET from the environment, or a random one kept next to the data.
export function loadSecret(dataDir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, 'session-secret');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(file, 'utf8').trim();
}

export function sessionCookie(secret) {
  const sign = (value) => crypto.createHmac('sha256', secret).update(value).digest('hex');
  return {
    issue(userId) {
      return `${userId}.${sign(userId)}`;
    },
    read(cookieHeader) {
      const m = (cookieHeader || '').match(/(?:^|;\s*)sid=([^;]+)/);
      if (!m) return null;
      const raw = decodeURIComponent(m[1]);
      const dot = raw.lastIndexOf('.');
      if (dot < 1) return null;
      const id = raw.slice(0, dot);
      const sig = Buffer.from(raw.slice(dot + 1));
      const want = Buffer.from(sign(id));
      return sig.length === want.length && crypto.timingSafeEqual(sig, want) ? id : null;
    },
  };
}

// Small in-memory limiter for login and sign-up attempts per IP.
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
