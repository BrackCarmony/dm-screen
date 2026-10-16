// Re-score saved eval results after the grader changes, from each case's saved reply (traces/), so earlier
// runs stay comparable with new ones without paying for them again. Grading makes no model calls.
//
//   node evals/regrade.mjs .claude/hillclimb/monster-balance [--write]
//
// Without --write it only reports what would change. It first checks that the replies reproduce the stored
// metrics the grader change didn't touch; if they don't, the traces can't stand in for the original run.
import fs from 'node:fs';
import path from 'node:path';
import { toBestiaryEntries } from '../server/ai.js';
import { gradeCase, loadCases } from './run-monsters.mjs';

const [flow] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const write = process.argv.includes('--write');
if (!flow) {
  console.error('Usage: node evals/regrade.mjs <flow dir> [--write]');
  process.exit(1);
}
const xpTable = JSON.parse(fs.readFileSync(new URL('../data/seed/xp.json', import.meta.url), 'utf8')).cr;
const cases = new Map((await loadCases()).map((c) => [c.id, c]));
const UNCHANGED = ['count_ok', 'cr_ok', 'unsure']; // metrics this regrade's grader change leaves alone

let mismatches = 0;
for (const variant of fs.readdirSync(flow).filter((d) => /^(baseline|v\d+)$/.test(d)).sort()) {
  const file = path.join(flow, variant, 'results.jsonl');
  if (!fs.existsSync(file)) continue;
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const changed = {};
  for (const row of rows) {
    const trace = JSON.parse(fs.readFileSync(path.join(flow, variant, 'traces', `${row.prompt_id}_rep${row.rep}.json`), 'utf8'));
    const reply = trace.findLast((t) => t.role === 'assistant').content;
    const failure = reply.match(/^\((refused|invalid)\)/)?.[1] ?? null;
    const input = cases.get(row.prompt_id);
    const monsters = failure ? [] : toBestiaryEntries(JSON.parse(reply).monsters, { prompt: input.prompt, xpTable });
    const { grade, explanation } = await gradeCase(input, { monsters, failure }, null, {});
    for (const k of UNCHANGED) {
      if (row.grade[k] !== grade[k]) {
        mismatches++;
        console.error(`${variant} ${row.prompt_id} rep${row.rep}: stored ${k} ${row.grade[k]}, reply gives ${grade[k]}`);
      }
    }
    for (const k of new Set([...Object.keys(row.grade), ...Object.keys(grade)])) {
      if (row.grade[k] !== grade[k]) changed[k] = (changed[k] ?? 0) + 1;
    }
    row.grade = grade;
    row.explanation = explanation;
  }
  console.log(`${variant}: ${rows.length} rows; metrics changed: ${JSON.stringify(changed)}`);
  if (write && !mismatches) fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
if (mismatches) {
  console.error(`${mismatches} stored metrics don't match their saved replies, so nothing was written.`);
  process.exit(1);
}
if (!write) console.log('Nothing written. Run again with --write to save the new grades.');
