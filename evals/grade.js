// Grade monsters' CRs against their numbers (evals/balance.js). No model calls, so it's free to run.
//
//   node evals/grade.js monsters.json        a file of monsters: {"monsters": [...]}, a list, or eval results
//   node evals/grade.js --dm someone@example.com   a DM's bestiary (DATA_DIR, default ./data)
//   node evals/grade.js --srd                the SRD bestiary itself, as a check on the grader
//   add --all to list every monster, --json for machine-readable output
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDmStore, createUserStore } from '../server/store.js';
import { fmtCr, grade, srdTable } from './balance.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => args[args.indexOf(name) + 1];

function load() {
  if (flag('--srd')) return JSON.parse(fs.readFileSync(path.join(root, 'data', 'seed', 'bestiary.json'), 'utf8'));
  if (flag('--dm')) {
    const dataDir = process.env.DATA_DIR || path.join(root, 'data');
    const user = createUserStore(dataDir).byEmail(value('--dm'));
    if (!user) throw new Error(`No account for ${value('--dm')}`);
    return createDmStore(dataDir, path.join(root, 'data', 'seed')).get(user.id).bestiary;
  }
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Usage: node evals/grade.js <monsters.json> | --dm <email> | --srd  [--all] [--json]');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Eval results keep each case's monsters under "monsters" too, so flatten one level of {monsters}.
  const list = Array.isArray(data) ? data : data.monsters ?? data.results ?? [data];
  return list.flatMap((m) => (Array.isArray(m?.monsters) ? m.monsters : [m]));
}

const table = srdTable();
const graded = load().map((m) => grade(m, table));
const count = (v) => graded.filter((g) => g.verdict === v).length;
const judged = count('pass') + count('fail');

if (flag('--json')) {
  console.log(JSON.stringify({ pass: count('pass'), fail: count('fail'), unsure: count('unsure'), passRate: judged ? count('pass') / judged : null, monsters: graded }, null, 2));
} else {
  const line = (g) => {
    const est = `defense CR ${fmtCr(g.defensive)}, offense ${g.offensive === null ? 'unknown' : `CR ${fmtCr(g.offensive)}`}`;
    const why = g.verdict === 'fail' ? g.problems.join('; ') : g.verdict === 'unsure' ? g.caveats.join('; ') : '';
    return `  ${g.verdict.padEnd(6)} ${g.name} (CR ${fmtCr(g.claimed)}): ${est}${why ? `. ${why}` : ''}`;
  };
  console.log(`${graded.length} monsters: ${count('pass')} pass, ${count('fail')} fail, ${count('unsure')} unsure`
    + (judged ? `. Pass rate ${Math.round((100 * count('pass')) / judged)}% of those judged.` : '.'));
  const shown = flag('--all') ? graded : graded.filter((g) => g.verdict === 'fail');
  if (shown.length) console.log(`\n${flag('--all') ? 'All' : 'Failures'}:\n${shown.map(line).join('\n')}`);
  const lean = graded.filter((g) => g.verdict !== 'unsure' && g.offensive !== null);
  if (lean.length) {
    const avg = (f) => (lean.reduce((s, g) => s + f(g), 0) / lean.length).toFixed(1);
    const steps = (cr) => [0, 0.125, 0.25, 0.5].includes(cr) ? [0, 0.125, 0.25, 0.5].indexOf(cr) : cr + 3;
    console.log(`\nOn average, defense is ${avg((g) => steps(g.defensive) - steps(g.claimed))} and offense ${avg((g) => steps(g.offensive) - steps(g.claimed))} CR steps from the claimed CR (+ is stronger).`);
  }
}
