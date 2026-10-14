# DM Screen

A web version of *Brack's Battle Sheets*: the bestiary, battle tracker, encounter presets, magic shop roller and XP tables from the Google Sheet, plus a live initiative page for players.

## Accounts

Any DM can sign up with an email and password and gets their own party, bestiary, encounters, battles and shops.

- The **first account** created on a server gets the full campaign seed (or an existing `$DATA_DIR/state.json` from the single-DM version). Create yours first.
- Later accounts start with the SRD starter bestiary, the XP tables and magic item tables, a few example encounters (`data/seed/starter-encounters.json`), and an empty party, battles and shops.
- Each DM's players follow `/p/<link>`, for example `/p/brack`. The link is set on the Account page.

### Admin

The first account is the admin and gets an **Admin** tab: totals (DMs, new sign-ups, active this week, DMs with a battle) a list of every DM with their sign-up date, last activity, how much they've built, and their player link, and all feedback, which can be marked addressed or won't do, with a reply the DM sees. It doesn't show anyone's campaign contents. To make more admins, list their emails in `ADMIN_EMAILS` (comma separated).

### Passwords

- **Change:** on the Account page. This signs the DM out on their other devices.
- **Forgot:** "Forgot password?" on the login screen emails a reset link that works once, for one hour. Email needs `APP_URL` (the site's public address, used to build the link) and either Mailgun (`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and `MAILGUN_BASE_URL=https://api.eu.mailgun.net` for EU accounts) or `SMTP_URL` (for example `smtps://user:pass@smtp.example.com:465`). `MAIL_FROM` sets the sender. Without either, the link is written to the server log instead.
- **By hand:** on the server, `DATA_DIR=/var/lib/dm-screen APP_URL=https://dm.example.com npm run reset-link -- someone@example.com` prints a reset link you can send yourself.

## Pages

- **Battle**: add monsters from the bestiary, track damage and healing per monster, set a name players see, roll and run initiative, and see the XP award (total XP ÷ party size × max(1, enemies ÷ party size), as on the sheet).
- **Bestiary**: search, sort, view and edit monsters.
- **Encounters**: the Dungeon Rooms and Combat Tables groups. "Start battle" creates a battle with those monsters and your party.
- **Magic Shop**: roll items under a gold target from the major and minor item tables, and keep named shops.
- **Party** and **XP Tables**.
- **Getting started** (the **?** in the top bar, and the first page after sign-up): a short guide to setting up a party, running a battle and sharing the player view.
- **Feedback**: DMs send suggestions or problems, and see whether each one was addressed or rejected, with any reply.
- **/p/&lt;link&gt;**: read-only initiative order for the battle marked "Show to players". It updates live, shows monster names as their player-facing name, and shows monster health as a bar.

## Reviewing feedback

Feedback is kept in `$DATA_DIR/feedback.json`. Review it on the Admin page or from the command line; DMs see the status and note on their Feedback page.

```sh
scripts/prod-feedback.sh list                  # open feedback on the live site (over ssh)
scripts/prod-feedback.sh list all --json
scripts/prod-feedback.sh addressed <id> "Added in the next release"
scripts/prod-feedback.sh rejected <id> "Out of scope for now"
scripts/prod-feedback.sh reopen <id>
npm run feedback -- list                       # the same against local data
```

## Run locally

```sh
npm install
npm run dev            # API on :3000, app on http://localhost:5173
```

Open http://localhost:5173 and sign up. Settings can go in a `.env` file in the project folder (it is git-ignored); see `deploy/dm-screen.env.example`.

## Production

```sh
npm ci && npm run build
SESSION_SECRET=... DATA_DIR=/var/lib/dm-screen npm start
```

All data lives in `$DATA_DIR`: `users.json` (accounts, with scrypt-hashed passwords) and `dms/<id>.json` (one file per DM). Back that folder up. If `SESSION_SECRET` is unset, a random one is created in `$DATA_DIR/session-secret`. Run it behind HTTPS so login cookies are sent securely.

### The droplet

dm-screen.brackcarmony.com runs on the `elo` droplet (Ubuntu 14.04, so upstart rather than systemd). To deploy the committed code:

```sh
scripts/deploy.sh          # or: scripts/deploy.sh <ssh-host>
```

It builds the client locally, uploads it, runs `npm ci --omit=dev`, restarts the app and checks that it answers. If the new release doesn't answer, it switches back to the previous one (kept in `/opt/dm-screen-prev`).

One-time setup on a server, using the files in `deploy/`:

- **Node 22** in `/opt/node22`. On Ubuntu 14.04 the official builds don't run; use the `linux-x64-glibc-217` build from unofficial-builds.nodejs.org.
- **A `dmscreen` user** that owns `/var/lib/dm-screen` (mode 700).
- **`/etc/dm-screen.env`** (root only, mode 600), based on `deploy/dm-screen.env.example`.
- **The service:** `deploy/dm-screen.upstart.conf` as `/etc/init/dm-screen.conf` (`start|stop|restart|status dm-screen`, log in `/var/log/upstart/dm-screen.log`), or `deploy/dm-screen.service` on a systemd server.
- **nginx:** `deploy/nginx.conf` as an nginx site, then `certbot --nginx -d <domain> --redirect` for HTTPS.

## Starter bestiary

`data/seed/bestiary.json` holds the monsters from the System Reference Document 5.1, converted from [5e-bits/5e-database](https://github.com/5e-bits/5e-database), with "Full stat block" links to [Open5e](https://open5e.com). To rebuild it:

```sh
python3 scripts/srd_bestiary.py
```

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

## Re-importing the sheet

The rest of `data/seed/` was generated from an xlsx export of the sheet:

```sh
pip install openpyxl
python3 scripts/import_sheet.py export.xlsx
```

Seed files only apply to accounts created afterwards.
