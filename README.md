# DM Screen

A web version of *Brack's Battle Sheets*: the bestiary, battle tracker, encounter presets, magic shop roller and XP tables from the Google Sheet, plus a live initiative page for players.

## Accounts

Any DM can sign up with an email and password and gets their own party, bestiary, encounters, battles and shops.

- The **first account** created on a server gets the full campaign seed (or an existing `$DATA_DIR/state.json` from the single-DM version). Create yours first.
- Later accounts start with the SRD starter bestiary, the XP tables and magic item tables, a few example encounters (`data/seed/starter-encounters.json`), and an empty party, battles and shops.
- Each DM's players follow `/p/<link>`, for example `/p/brack`. The link is set on the Account page.

### Admin

The first account is the admin and gets an **Admin** tab: totals (DMs, new sign-ups, active this week, DMs with a battle) a list of every DM with their sign-up date, last activity, how much they've built, and their player link, and all feedback, which can be marked addressed or won't do, with a reply the DM sees. It doesn't show anyone's campaign contents. To make more admins, list their emails in `ADMIN_EMAILS` (comma separated).

### Sign in with Google

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (an OAuth client of type "Web application") and the login screen gets **Continue with Google**. The redirect URI is `$APP_URL/api/auth/google/callback`, so register `https://dm-screen.brackcarmony.com/api/auth/google/callback` and, for local development, `http://localhost:5173/api/auth/google/callback`. A Google sign-in uses the account it signed into before; otherwise the account with the same email, if Google has verified that email (so a DM who signed up with a password can use either); otherwise it makes a new account. Google-only accounts have no password; "Forgot password?" sets one.

### Passwords

- **Change:** on the Account page. This signs the DM out on their other devices.
- **Forgot:** "Forgot password?" on the login screen emails a reset link that works once, for one hour. Email needs `APP_URL` (the site's public address, used to build the link) and either Mailgun (`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and `MAILGUN_BASE_URL=https://api.eu.mailgun.net` for EU accounts) or `SMTP_URL` (for example `smtps://user:pass@smtp.example.com:465`). `MAIL_FROM` sets the sender. Without either, the link is written to the server log instead.
- **By hand:** on the server, `DATA_DIR=/var/lib/dm-screen APP_URL=https://dm.example.com npm run reset-link -- someone@example.com` prints a reset link you can send yourself.

## Pages

- **Battle**: add monsters from the bestiary, track damage and healing per monster, set a name players see, roll and run initiative, and see the XP award (total XP ÷ party size × max(1, enemies ÷ party size), as on the sheet).
- **Bestiary**: search, sort, view and edit monsters. **Generate with AI** (beta) asks Claude (`claude-opus-5-5`) for up to 4 original monsters from a prompt and adds them, tagged AI; the "AI-generated" filter shows only those. Each account gets `AI_BETA_USES` generations (default 5); a generation only counts once its monsters are saved, so a failure (Claude out of capacity, a refusal, an unreadable reply) costs nothing. Needs `ANTHROPIC_API_KEY`; without it the button is hidden. **Import JSON** adds monsters pasted as JSON (`{"monsters": [...]}`, a list, or one monster; surrounding text such as a chat reply is ignored), tagged Imported with their own filter. It's free and works without a key, and it shows instructions DMs can copy into their own AI or agent so its reply imports cleanly.
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

## MCP server

`server/mcp.js` is a [Model Context Protocol](https://modelcontextprotocol.io) server, so an AI app such as Claude can work with a DM's campaign.

- **Tools:** `search_monsters`, `get_monster`, `get_battle` (initiative, HP and XP for the active battle), `encounter_xp`, `roll_dice`, `list_encounters`, and two that write: `add_monsters` (tagged AI, with the request, like the in-app generator) and `add_encounters` (all or nothing: every monster must be in the bestiary). Nothing edits or deletes.
- **Resources:** `dm://party` and `dm://monster/{name}`.
- **Prompts:** `plan_encounter` and `random_encounter_table` (for example "the woods", level 5), which picks monsters, adds any that are missing and saves the table as an encounter group.

Changes show up in the DM's open tabs as they happen: the app pushes which collections changed, and who changed them, over `/api/events` (server-sent events), and the tab reloads just those ("Claude updated your Encounters."). That covers an AI app over MCP, the DM's other tabs and devices, and the local stdio server, whose writes the app notices by watching the data folder.

### Remote: `$APP_URL/mcp`

With `APP_URL` set, the app serves the MCP server at `$APP_URL/mcp` (for the live site, `https://dm-screen.brackcarmony.com/mcp`), and DM Screen is the OAuth server that signs AI apps in (`server/oauth.js`, using the MCP SDK's OAuth router for `/authorize`, `/token`, `/register`, `/revoke` and `/.well-known/...`). A DM adds that address to their AI app (in Claude: Settings → Connectors → Add custom connector; in Claude Code: `claude mcp add --transport http dm-screen <address>`), signs in to DM Screen when asked and allows it on the `/connect` page. Apps get their own DM Screen tokens; Google sign-in is only how the DM logs in, and no Google token goes to the app.

Each connected app is listed on the Account page, where it can be disconnected. Changing the password disconnects them all. Connections are kept in `$DATA_DIR/oauth.json` (refresh tokens hashed; access tokens are signed, last an hour and aren't stored).

### Local: stdio

`.mcp.json` registers `node server/mcp-stdio.js` with Claude Code for this folder. It reads the first account's data, or `DM_EMAIL`'s, from `DATA_DIR`, so locally that's your development data. To try either by hand: `npx @modelcontextprotocol/inspector node server/mcp-stdio.js`.

## Evals: are monsters balanced for their CR?

`evals/balance.js` grades a monster's challenge rating against its numbers, with no model calls, so it costs nothing to run. As in 5e, it rates defense from hit points (nudged by armor class) and offense from damage per round (nudged by attack bonus or save DC), and a monster passes when each is within 3 steps of its CR on the CR ladder (0, 1/8, 1/4, 1/2, 1, 2, ...). What each CR should look like is learned from the SRD bestiary in `data/seed`, not copied from a rulebook.

```sh
node evals/grade.js monsters.json                 # {"monsters": [...]}, a list, or saved eval results
node evals/grade.js --dm someone@example.com      # a DM's bestiary
node evals/grade.js --srd                         # the SRD itself, as a check on the grader
```

How far to trust it: each ordinary SRD monster up to CR 10, graded against a table learned without it, passes about 95% of the time and lands within one step of its CR about 85% of the time (`test/balance.test.js` fails if that drops). Spellcasters and legendary monsters (whose attack lines understate them), monsters above CR 10 (the SRD has 10 ordinary ones to learn from) and monsters with no readable damage are reported as "unsure" rather than pass or fail.

### The generator's eval

`evals/run-monsters.mjs` runs the real generator (`server/ai.js`) on the 30 prompts in `evals/monster-cases.json` and grades what it makes with `evals/balance.js`: balanced for its CR, the number of monsters asked for, and the CR asked for. Each variant is a model and effort setting (`VARIANTS` in the runner). It spends API credit, and it won't run until someone has reviewed it and passed `--approve-harness` once; changing the runner, generator, grader or cases asks again. `EVAL_CASES=id,id` runs a few cases as a pilot.

```sh
node evals/run-monsters.mjs --flow .claude/hillclimb/monster-balance --variant baseline --model claude-opus-5-5 --reps 2
```

Results are in `.claude/hillclimb/monster-balance/<variant>/results.jsonl`; the claude-api skill's report builder turns the folder into `report.html`. The first run (October 2026, 30 prompts × 2, $3.77 in all):

| Setting | Balanced | Right count | Asked-for CR | Cost per generation |
|---|---|---|---|---|
| Opus 5.5, medium effort (the site) | 92% | 100% | 100% | $0.034 |
| Opus 5.5, low effort | 94% | 100% | 100% | $0.019 |
| Sonnet 5.5 | 98% | 100% | 100% | $0.009 |
| Haiku 5.5 | 89% (62% at CR 7-10) | 100% | 100% | $0.0009 |

The differences in Balanced are within the noise of 30 prompts, except Haiku at CR 7-10. Haiku also numbered copies ("Frost Wolf (1)") and borrowed franchise names. The "CR 6 tank" prompt fails for every setting because the grader's rule against lopsided monsters contradicts the request.

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

Accounts that started from something else (the first account gets the sheet's campaign) can add the SRD monsters they're missing. Names match ignoring case and punctuation, so the sheet's `dire-wolf` is the SRD's `Dire Wolf` and is left as it is. Without `--apply` it only prints what it would add, and which SRD names are close to one you have (often a typo of the same monster, sometimes a different one) so you can `--skip` them. With `--apply` it backs up the DM's file next to it first.

```sh
DATA_DIR=/var/lib/dm-screen npm run add-srd -- someone@example.com
DATA_DIR=/var/lib/dm-screen npm run add-srd -- someone@example.com --skip "Blue Dragon Wyrmling" --apply
```

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

## Re-importing the sheet

The rest of `data/seed/` was generated from an xlsx export of the sheet:

```sh
pip install openpyxl
python3 scripts/import_sheet.py export.xlsx
```

Seed files only apply to accounts created afterwards.
