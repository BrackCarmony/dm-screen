# DM Screen

A web version of *Brack's Battle Sheets*: the bestiary, battle tracker, encounter presets, magic shop roller and XP tables from the Google Sheet, plus a live initiative page for players.

## Accounts

Any DM can sign up with an email and password and gets their own party, bestiary, encounters, battles and shops.

- The **first account** created on a server gets the full campaign seed (or an existing `$DATA_DIR/state.json` from the single-DM version). Create yours first.
- Later accounts start with a copy of the bestiary, XP tables and magic item tables, and an empty party, encounters, battles and shops.
- Each DM's players follow `/p/<link>`, for example `/p/brack`. The link is set on the Account page.

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
- **/p/&lt;link&gt;**: read-only initiative order for the battle marked "Show to players". It updates live, shows monster names as their player-facing name, and shows monster health as a bar.

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

All data lives in `$DATA_DIR`: `users.json` (accounts, with scrypt-hashed passwords) and `dms/<id>.json` (one file per DM). Back that folder up. If `SESSION_SECRET` is unset, a random one is created in `$DATA_DIR/session-secret`. Run it behind HTTPS so login cookies are sent securely. `deploy/` has a systemd unit, an nginx site and an env file example for a droplet.

## Re-importing the sheet

`data/seed/` was generated from an xlsx export of the sheet:

```sh
pip install openpyxl
python3 scripts/import_sheet.py export.xlsx
```

Seed files only apply to accounts created afterwards.
