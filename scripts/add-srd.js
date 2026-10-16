// Add the SRD starter bestiary (data/seed/bestiary.json) to a DM's bestiary, for accounts that started
// from something else, such as the first account's campaign from the Google Sheet.
//
// A monster the DM already has is left alone: names match ignoring case and punctuation, so the sheet's
// "dire-wolf" counts as the SRD's "Dire Wolf". Without --apply it only prints what it would do, including
// SRD names that are close to one of the DM's without matching (often a typo, sometimes a different
// monster), so you can --skip the ones that are the same. With --apply it backs up the DM's file first.
//
//   DATA_DIR=/var/lib/dm-screen npm run add-srd -- someone@example.com [--skip "Name,Other Name"] [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDmStore, createUserStore } from '../server/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const seedDir = path.join(root, 'data', 'seed');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const skipAt = args.indexOf('--skip');
const skip = new Set(skipAt === -1 ? [] : String(args[skipAt + 1] ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const email = args.find((a, i) => !a.startsWith('--') && (skipAt === -1 || i !== skipAt + 1));
if (!email) {
  console.error('Usage: npm run add-srd -- <email> [--skip "Name,Other Name"] [--apply]');
  process.exit(1);
}
const user = createUserStore(dataDir).byEmail(email);
if (!user) {
  console.error(`No account for ${email}`);
  process.exit(1);
}

const loose = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '');
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}
// Another name close enough to look like the same monster: at most 3 edits, and under 15% of the name.
const near = (a, b) => { const d = distance(a, b); return d <= 3 && d / Math.max(a.length, b.length) < 0.15; };

const dms = createDmStore(dataDir, seedDir);
const bestiary = dms.get(user.id).bestiary;
const srd = JSON.parse(fs.readFileSync(path.join(seedDir, 'bestiary.json'), 'utf8'));
const have = new Map(bestiary.map((m) => [loose(m.name), m.name]));

const same = srd.filter((m) => have.has(loose(m.name)));
const skipped = srd.filter((m) => !have.has(loose(m.name)) && skip.has(m.name.toLowerCase()));
const add = srd.filter((m) => !have.has(loose(m.name)) && !skip.has(m.name.toLowerCase()));
const close = add
  .map((m) => [m.name, bestiary.find((b) => near(loose(m.name), loose(b.name)))?.name])
  .filter(([, other]) => other);
const unknownSkips = [...skip].filter((s) => !srd.some((m) => m.name.toLowerCase() === s));

console.log(`${user.name} (${user.email}): ${bestiary.length} monsters. The SRD has ${srd.length}.`);
console.log(`Already there (kept as they are): ${same.length}`);
if (skipped.length) console.log(`Skipped with --skip: ${skipped.map((m) => m.name).join(', ')}`);
if (unknownSkips.length) console.log(`Not SRD names, so --skip did nothing for: ${unknownSkips.join(', ')}`);
console.log(`To add: ${add.length}`);
if (close.length) {
  console.log('\nThese would be added, but are close to a monster already there. --skip the ones that are the same:');
  for (const [name, other] of close) console.log(`  ${name}  (you have "${other}")`);
}

if (!apply) {
  console.log('\nNothing changed. Run again with --apply to add them.');
} else if (add.length) {
  const file = path.join(dataDir, 'dms', `${user.id}.json`);
  const backup = `${file}.before-srd-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, backup);
  dms.set(user.id, 'bestiary', [...bestiary, ...add], { by: 'The SRD import' });
  console.log(`\nAdded ${add.length}. Now ${bestiary.length + add.length} monsters. Backup: ${backup}`);
}
