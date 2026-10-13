import nodemailer from 'nodemailer';

// SMTP_URL like smtps://user:pass@smtp.example.com:465 turns on email.
// Without it, reset links are written to the server log for the operator.
export function createMailer({ smtpUrl = process.env.SMTP_URL, from = process.env.MAIL_FROM, log = console } = {}) {
  const transport = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
  return {
    enabled: !!transport,
    async sendReset(to, link) {
      if (!transport) {
        log.info(`[password reset] ${to}: ${link}`);
        return;
      }
      await transport.sendMail({
        from: from || 'DM Screen <no-reply@localhost>',
        to,
        subject: 'Reset your DM Screen password',
        text: `Someone asked to reset the password for your DM Screen account.\n\nTo choose a new password, open this link within an hour:\n${link}\n\nIf this wasn't you, ignore this email and your password stays the same.\n`,
      });
    },
  };
}
