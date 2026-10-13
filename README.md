# DM Screen

A web version of *Brack's Battle Sheets*: the bestiary, battle tracker, encounter presets, magic shop roller and XP tables from the Google Sheet, plus a live initiative page for players.

## Pages

- **Battle**: add monsters from the bestiary, track damage and healing per monster, set a name players see, roll and run initiative, and see the XP award (total XP ÷ party size × max(1, enemies ÷ party size), as on the sheet).
- **Bestiary**: search, sort, view and edit monsters.
- **Encounters**: the Dungeon Rooms and Combat Tables groups. "Start battle" creates a battle with those monsters and your party.
- **Magic Shop**: roll items under a gold target from the major and minor item tables, and keep named shops.
- **Party** and **XP Tables**.
- **/players**: read-only initiative order for the battle marked "Show to players". It updates live, shows monster names as their player-facing name, and shows monster health as a bar.

## Run locally

```sh
npm install
npm run dev            # API on :3000, app on http://localhost:5173
```

Without `DM_PASSWORD` the DM pages are open; set it for anything reachable from the internet.

## Production

```sh
npm ci && npm run build
DM_PASSWORD=... SESSION_SECRET=... DATA_DIR=/var/lib/dm-screen npm start
```

All data lives in `$DATA_DIR/state.json` (back this file up). On first start it is seeded from `data/seed/`. `deploy/` has a systemd unit, an nginx site and an env file example for a droplet.

## Re-importing the sheet

`data/seed/` was generated from an xlsx export of the sheet:

```sh
pip install openpyxl
python3 scripts/import_sheet.py export.xlsx
```

Seed files only apply to a fresh `state.json`.
