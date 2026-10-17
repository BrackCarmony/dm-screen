import React from 'react';

const CONTACT = 'brackcarmony@gmail.com';
const UPDATED = 'October 15, 2026';

// Public page at /privacy, readable without an account. Keep it in step with what the server does.
export default function Privacy() {
  return (
    <div className="privacy">
      <a href="/" className="brand">DM Screen</a>
      <h1>Privacy Policy</h1>
      <p className="muted">Last updated {UPDATED}</p>

      <p>
        DM Screen (<a href="https://dm-screen.brackcarmony.com">dm-screen.brackcarmony.com</a>) is a tool for running tabletop
        game sessions, made and run by Brack Carmony. This page explains what information it keeps, why, and what you can do about it.
        Questions go to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>What DM Screen collects</h2>
      <ul>
        <li><strong>Your account:</strong> your name, your email address, and your player link. If you sign up with a password, only a salted hash of it is stored, never the password itself.</li>
        <li><strong>Google sign-in:</strong> if you sign in with Google, DM Screen receives your Google account ID, name and email address, and whether Google has verified that email. Nothing else from your Google account is requested.</li>
        <li><strong>What you make:</strong> your party, bestiary, encounters, battles, magic shops and settings.</li>
        <li><strong>Feedback:</strong> what you write on the Feedback page, which page it's about, and your name and email with it.</li>
        <li><strong>Activity:</strong> when you signed up, last logged in and last used the site, and how many AI generations you've used.</li>
        <li><strong>Server logs:</strong> like most websites, the server logs each request with your IP address, browser type and the page requested. Logs are deleted after about 52 days. Your IP address is also held briefly in memory to limit repeated login attempts.</li>
      </ul>

      <h2>Cookies</h2>
      <p>
        DM Screen sets one cookie to keep you logged in, and a second, short-lived one (10 minutes) while you sign in with Google.
        There are no advertising, analytics or tracking cookies, and no third-party scripts.
      </p>

      <h2>How your email is used</h2>
      <ul>
        <li>To sign you in, and to send a password reset link when you ask for one.</li>
        <li>To contact you about updates to, or problems with, the app, including replies about feedback you've sent.</li>
      </ul>
      <p>Your email is never sold, rented or added to marketing lists.</p>

      <h2>Information from Google</h2>
      <p>
        DM Screen asks Google only for your basic profile (name), your email address and your Google account ID (the
        <code> openid</code>, <code>email</code> and <code>profile</code> scopes). They are used only to sign you in, to create your
        account, and to connect your Google sign-in to an existing DM Screen account with the same email when Google has verified it.
        Information from Google is not used for advertising, not sold, and not shared with anyone except as this policy describes.
        DM Screen's use and transfer of information received from Google APIs adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
        including the Limited Use requirements.
      </p>

      <h2>What other people can see</h2>
      <p>
        Your player link (for example <code>/p/your-name</code>) is public so your players can follow along. Anyone with it can see
        your name and the battle you've marked "Show to players": its name, the round, the initiative order, combatant names (monsters
        show the name you set for players) and a health bar for each monster. Everything else in your account is private to you.
      </p>

      <h2>Services that handle your information</h2>
      <ul>
        <li><strong>DigitalOcean</strong> hosts the server where all of DM Screen's data is stored.</li>
        <li><strong>Google</strong> handles sign-in if you choose "Continue with Google".</li>
        <li><strong>Mailgun</strong> sends password reset emails, so it receives your email address and the reset link.</li>
        <li><strong>Anthropic</strong> runs the Claude model behind "Generate with AI" and "Generate table". When you use them, the prompt you write is sent to Anthropic; for an encounter table, so are the party's size and level and your bestiary's monster names, challenge ratings, attacks and traits. Your name, email and players' names are not sent.</li>
      </ul>
      <p>DM Screen doesn't otherwise share your information, except if required by law.</p>

      <h2>Who can see your data</h2>
      <p>
        The site's administrator can see an admin page listing each account's name, email, player link, sign-up and activity dates,
        how many battles, monsters and other items it has, and all feedback. As the operator of the server, the administrator can also
        access the stored data, and only does so to run the site, fix problems, or respond to you.
      </p>

      <h2>Keeping and deleting your data</h2>
      <p>
        Your account and everything in it is kept until you ask for it to be deleted. To delete your account, its contents and your
        feedback, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address on your account; it will be done within 30 days.
        Server logs are removed on their own after about 52 days. You can change your name, email and password at any time on the Account page.
      </p>

      <h2>Security</h2>
      <p>
        The site is served over HTTPS, passwords are stored only as salted hashes, and the login cookie can't be read by scripts on the
        page. No system is perfectly secure, but these measures protect your information against common risks.
      </p>

      <h2>Children</h2>
      <p>DM Screen isn't intended for children under 13 and doesn't knowingly collect information from them.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the new version will be posted here with a new date. For significant changes, account holders will be
        told by email or on the site.
      </p>

      <h2>Contact</h2>
      <p>Brack Carmony, <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
    </div>
  );
}
