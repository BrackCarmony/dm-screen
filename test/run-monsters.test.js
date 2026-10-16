// The monster eval's runner and grader, end to end against a fake Claude API on localhost: an answer that
// should score 100% does, and empty, refused and wrong answers score 0. Costs nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grade, srdTable } from '../evals/balance.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srd = JSON.parse(fs.readFileSync(path.join(root, 'data', 'seed', 'bestiary.json'), 'utf8'));
const table = srdTable();
// An SRD monster at CR 3 that the grader passes: the "right answer" to a request for CR 3 monsters.
const wolfStandIn = srd.find((m) => m.cr === 3 && grade(m, table).verdict === 'pass');

let respond = () => ({ text: '{"monsters": []}' });
const requests = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const request = JSON.parse(body);
    requests.push(request);
    const { text, stop_reason = 'end_turn' } = respond(request);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_fake', type: 'message', role: 'assistant', model: request.model,
      content: [{ type: 'text', text }], stop_reason, stop_sequence: null,
      usage: { input_tokens: 900, output_tokens: 700 },
    }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.ANTHROPIC_API_KEY = 'test-key-for-the-fake-api';
const { gradeCase, loadCases, runCase } = await import('../evals/run-monsters.mjs');
test.after(() => server.close());

const cases = await loadCases();
const wolves = cases.find((c) => c.id === 'mid-frost-wolves'); // 3 monsters, CR 3 each
const baseline = { variant: 'baseline', model: 'claude-opus-5-5' };
const monstersJson = (list) => JSON.stringify({ monsters: list });
const run = async (ctx = baseline) => {
  const r = await runCase(wolves, ctx);
  return { r, g: (await gradeCase(wolves, r, null, ctx)).grade };
};

test('a perfect answer scores 1 on everything, with the model and usage the report needs', async () => {
  respond = () => ({ text: monstersJson([1, 2, 3].map((n) => ({ ...wolfStandIn, name: `Frost Wolf ${n}` }))) });
  const { r, g } = await run();
  assert.deepEqual(g, { balanced: 1, count_ok: 1, cr_ok: 1, unsure: 0 });
  assert.equal(r.model, 'claude-opus-5-5');
  assert.deepEqual(r.usage, { input_tokens: 900, output_tokens: 700 });
  assert.equal(r.transcript[1].content, wolves.prompt);
});

test('an empty answer, a refusal, and the wrong count and CR all score 0', async () => {
  respond = () => ({ text: '{"monsters": []}' });
  assert.deepEqual((await run()).g, { balanced: 0, count_ok: 0, cr_ok: 0 });
  respond = () => ({ text: '', stop_reason: 'refusal' });
  const refused = await run();
  assert.equal(refused.r.failure, 'refused');
  assert.deepEqual(refused.g, { balanced: 0, count_ok: 0, cr_ok: 0 });
  // One overpowered CR 3 "wolf" (an ogre's HP doubled, its damage tripled) where three were asked for.
  const ogre = srd.find((m) => m.name === 'Ogre');
  respond = () => ({ text: monstersJson([{ ...ogre, name: 'Dire Frost Wolf', cr: 3, hp: 240, attacks: ['Multiattack: 3× Greatclub', ...ogre.attacks] }]) });
  assert.deepEqual((await run()).g, { balanced: 0, count_ok: 0, cr_ok: 1, unsure: 0 });
});

test('each variant asks for its own model and effort, and the model must match --model', async () => {
  respond = () => ({ text: monstersJson([wolfStandIn]) });
  requests.length = 0;
  await run({ variant: 'v3', model: 'claude-haiku-5-5' });
  await run({ variant: 'v1', model: 'claude-opus-5-5' });
  assert.deepEqual(requests.map((q) => [q.model, q.output_config.effort, q.fallbacks ?? 'none']), [
    ['claude-haiku-5-5', 'medium', 'none'],
    ['claude-opus-5-5', 'low', 'default'],
  ]);
  await assert.rejects(runCase(wolves, { variant: 'v3', model: 'claude-opus-5-5' }), /pass --model claude-haiku-5-5/);
});
