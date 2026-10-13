// Make a one-hour password reset link for a DM, for when email isn't set up.
// Usage: DATA_DIR=/var/lib/dm-screen APP_URL=https://dm.example.com npm run reset-link -- someone@example.com
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUserStore } from '../server/store.js';
import { createResetToken, resetLink } from '../server/auth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run reset-link -- <email>');
  process.exit(1);
}
const users = createUserStore(process.env.DATA_DIR || path.join(root, 'data'));
const user = users.byEmail(email);
if (!user) {
  console.error(`No account for ${email}`);
  process.exit(1);
}
console.log(resetLink(process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`, createResetToken(users, user)));
