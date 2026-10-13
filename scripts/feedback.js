// Review DM feedback. DMs see the status and note on their Feedback page.
//
//   npm run feedback -- list [open|addressed|rejected|all] [--json]   (default: open)
//   npm run feedback -- addressed <id> [note]
//   npm run feedback -- rejected <id> [note]
//   npm run feedback -- reopen <id>
//
// Uses $DATA_DIR (default ./data). For the live site, run scripts/prod-feedback.sh with the same arguments.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEEDBACK_STATUSES, createFeedbackStore } from '../server/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const feedback = createFeedbackStore(process.env.DATA_DIR || path.join(root, 'data'));

const [cmd = 'list', ...rest] = process.argv.slice(2);
const json = rest.includes('--json');
const args = rest.filter((a) => a !== '--json');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (cmd === 'list') {
  const which = args[0] ?? 'open';
  if (which !== 'all' && !FEEDBACK_STATUSES.includes(which)) fail(`Status must be one of: ${FEEDBACK_STATUSES.join(', ')}, all`);
  const items = feedback.all().filter((f) => which === 'all' || f.status === which);
  if (json) {
    console.log(JSON.stringify(items, null, 1));
  } else if (!items.length) {
    console.log(`No ${which === 'all' ? '' : `${which} `}feedback.`);
  } else {
    for (const f of items) {
      console.log(`[${f.id}] ${f.status.toUpperCase()}  ${f.createdAt.slice(0, 10)}  ${f.name} <${f.email ?? 'no email'}>${f.page ? `  on ${f.page}` : ''}`);
      console.log(f.message.replace(/^/gm, '    '));
      if (f.note) console.log(`    → ${f.note}`);
      console.log();
    }
  }
} else if (cmd === 'addressed' || cmd === 'rejected' || cmd === 'reopen') {
  const [id, ...note] = args;
  if (!id) fail(`Usage: npm run feedback -- ${cmd} <id>${cmd === 'reopen' ? '' : ' [note]'}`);
  if (!feedback.byId(id)) fail(`No feedback with id ${id}`);
  const patch = cmd === 'reopen' ? { status: 'open' } : { status: cmd, ...(note.length ? { note: note.join(' ') } : {}) };
  const f = feedback.update(id, patch);
  console.log(`[${f.id}] is now ${f.status}${f.note ? `: ${f.note}` : ''}`);
} else {
  fail('Usage: npm run feedback -- list [open|addressed|rejected|all] [--json] | addressed <id> [note] | rejected <id> [note] | reopen <id>');
}
