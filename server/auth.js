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

// Cookie is "<userId>.<hmac>". The HMAC covers the user's sessionVersion, so bumping
// it (on a password change or reset) signs out every other device.
export function sessionCookie(secret) {
  const sign = (user) => crypto.createHmac('sha256', secret).update(`${user.id}:${user.sessionVersion ?? 0}`).digest('hex');
  return {
    issue(user) {
      return `${user.id}.${sign(user)}`;
    },
    read(cookieHeader, findUser) {
      const m = (cookieHeader || '').match(/(?:^|;\s*)sid=([^;]+)/);
      if (!m) return null;
      const raw = decodeURIComponent(m[1]);
      const dot = raw.lastIndexOf('.');
      if (dot < 1) return null;
      const user = findUser(raw.slice(0, dot));
      if (!user) return null;
      const sig = Buffer.from(raw.slice(dot + 1));
      const want = Buffer.from(sign(user));
      return sig.length === want.length && crypto.timingSafeEqual(sig, want) ? user : null;
    },
  };
}

const RESET_TTL_MS = 60 * 60 * 1000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Returns the raw token to put in a link; only its hash is stored on the user.
export function createResetToken(users, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  users.update(user.id, { resetHash: sha256(token), resetExpires: Date.now() + RESET_TTL_MS });
  return token;
}

export function findByResetToken(users, token) {
  if (!token) return null;
  const hash = sha256(String(token));
  const user = users.all().find((u) => u.resetHash && u.resetHash.length === hash.length &&
    crypto.timingSafeEqual(Buffer.from(u.resetHash), Buffer.from(hash)));
  return user && user.resetExpires > Date.now() ? user : null;
}

export const resetLink = (baseUrl, token) => `${baseUrl.replace(/\/+$/, '')}/reset?token=${token}`;

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
