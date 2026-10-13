import nodemailer from 'nodemailer';

// Pick a way to send email from the environment:
//   MAILGUN_API_KEY + MAILGUN_DOMAIN (+ MAILGUN_BASE_URL for the EU region) → Mailgun's HTTP API
//   SMTP_URL like smtps://user:pass@smtp.example.com:465 → SMTP
// With neither, reset links are written to the server log for the operator.
export function createMailer({ env = process.env, log = console, fetchImpl = fetch } = {}) {
  const from = env.MAIL_FROM || (env.MAILGUN_DOMAIN ? `DM Screen <postmaster@${env.MAILGUN_DOMAIN}>` : 'DM Screen <no-reply@localhost>');
  let send = null;

  if (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN) {
    const base = (env.MAILGUN_BASE_URL || 'https://api.mailgun.net').replace(/\/+$/, '');
    const auth = Buffer.from(`api:${env.MAILGUN_API_KEY}`).toString('base64');
    send = async (msg) => {
      const res = await fetchImpl(`${base}/v3/${env.MAILGUN_DOMAIN}/messages`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}` },
        body: new URLSearchParams(msg),
      });
      if (!res.ok) throw new Error(`Mailgun ${res.status}: ${(await res.text()).slice(0, 200)}`);
    };
  } else if (env.SMTP_URL) {
    const transport = nodemailer.createTransport(env.SMTP_URL);
    send = (msg) => transport.sendMail(msg);
  }

  return {
    enabled: !!send,
    async sendReset(to, link) {
      if (!send) {
        log.info(`[password reset] ${to}: ${link}`);
        return;
      }
      await send({
        from,
        to,
        subject: 'Reset your DM Screen password',
        text: `Someone asked to reset the password for your DM Screen account.\n\nTo choose a new password, open this link within an hour:\n${link}\n\nIf this wasn't you, ignore this email and your password stays the same.\n`,
      });
    },
  };
}
