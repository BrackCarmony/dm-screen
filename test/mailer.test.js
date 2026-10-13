import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailer } from '../server/mailer.js';

test('Mailgun settings send through the Mailgun API', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true }; };
  const mailer = createMailer({ env: { MAILGUN_API_KEY: 'key-123', MAILGUN_DOMAIN: 'mg.example.com' }, fetchImpl });
  assert.equal(mailer.enabled, true);
  await mailer.sendReset('dm@example.com', 'https://dm.example.com/reset?token=abc');
  assert.equal(calls[0].url, 'https://api.mailgun.net/v3/mg.example.com/messages');
  assert.equal(calls[0].opts.headers.Authorization, `Basic ${Buffer.from('api:key-123').toString('base64')}`);
  const body = calls[0].opts.body;
  assert.equal(body.get('to'), 'dm@example.com');
  assert.equal(body.get('from'), 'DM Screen <postmaster@mg.example.com>');
  assert.match(body.get('text'), /reset\?token=abc/);
});

test('Mailgun errors are reported', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'Forbidden' });
  const mailer = createMailer({ env: { MAILGUN_API_KEY: 'k', MAILGUN_DOMAIN: 'd' }, fetchImpl });
  await assert.rejects(mailer.sendReset('a@b.c', 'x'), /Mailgun 403/);
});

test('without settings the link goes to the log', async () => {
  const lines = [];
  const mailer = createMailer({ env: {}, log: { info: (s) => lines.push(s) } });
  assert.equal(mailer.enabled, false);
  await mailer.sendReset('a@b.c', 'https://x/reset?token=t');
  assert.match(lines[0], /a@b\.c: https:\/\/x\/reset\?token=t/);
});
