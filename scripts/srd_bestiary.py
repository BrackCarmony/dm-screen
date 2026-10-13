#!/usr/bin/env python3
"""Build data/seed/bestiary.json (the starter bestiary every new DM gets) from the SRD 5.1.

Monster data comes from 5e-bits/5e-database; "Full stat block" links go to Open5e's SRD pages.
The SRD 5.1 is by Wizards of the Coast LLC and licensed under CC BY 4.0, so the app credits it.

    python3 scripts/srd_bestiary.py
"""
import json
import re
import urllib.request
from pathlib import Path

MONSTERS_URL = "https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2014/en/5e-SRD-Monsters.json"
OPEN5E_URL = "https://api.open5e.com/v1/monsters/?document__slug=wotc-srd&limit=500&fields=slug,name"
OUT = Path(__file__).resolve().parent.parent / "data" / "seed" / "bestiary.json"
ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "dm-screen-srd-bestiary"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def mod(score):
    return (score - 10) // 2


def name_of(n):
    # "Werewolf, Wolf Form" -> "Werewolf (Wolf Form)"; "Vampire, Vampire Form" -> "Vampire"
    base, _, form = n.partition(", ")
    if not form:
        return n
    return base if form == f"{base} Form" else f"{base} ({form})"


def usage(u):
    if not u:
        return ""
    if u["type"] == "per day":
        return f" ({u['times']}/Day)"
    if u["type"] == "recharge on roll":
        top = int(u["dice"].split("d")[1])
        return f" (Recharge {u['min_value']}-{top})" if u["min_value"] < top else f" (Recharge {top})"
    if u["type"] == "recharge after rest":
        return " (Recharge after rest)"
    return ""


def damage(parts):
    out = []
    for p in parts or []:
        if "damage_dice" in p:
            out.append(f"{p['damage_dice']} {p['damage_type']['name'].lower()}")
        elif "from" in p:
            opts = [o for o in p["from"].get("options", []) if "damage_dice" in o]
            out.append(" or ".join(f"{o['damage_dice']} {o['damage_type']['name'].lower()}" for o in opts))
    return " + ".join(o for o in out if o)


def save_dc(dc):
    half = ", half on save" if dc.get("success_type") == "half" else ""
    return f"DC{dc['dc_value']} {dc['dc_type']['name'].title()}", half


def action(a):
    name = a["name"] + usage(a.get("usage"))
    dmg = damage(a.get("damage"))
    if "attack_bonus" in a:
        reach = re.search(r"reach (\d+) ft", a["desc"])
        rng = re.search(r"range (\d+/\d+) ft", a["desc"])
        where = f" {rng.group(1)}ft" if rng else (f" {reach.group(1)}ft" if reach and reach.group(1) != "5" else "")
        return f"{name} +{a['attack_bonus']}{where} {dmg}".strip()
    if "dc" in a:
        dc, half = save_dc(a["dc"])
        return f"{name} {dc} {dmg}{half}".strip()
    if a.get("options"):
        opts = []
        for o in a["options"]["from"]["options"]:
            if o.get("option_type") != "breath":
                continue
            dc, half = save_dc(o["dc"])
            opts.append(f"{o['name']} {dc} {damage(o.get('damage'))}{half}".strip())
        if opts:
            return f"{name}: " + "; ".join(opts)
    return name


def multiattack(a):
    if a.get("actions"):
        def one(x):
            n = str(x["count"])
            if not n.isdigit():
                return f"{x['action_name']} ({n.lower()})"
            return f"{n}× {x['action_name']}" if int(n) > 1 else x["action_name"]
        return "Multiattack: " + ", ".join(one(x) for x in a["actions"])
    return "Multiattack: " + a["desc"]


def spells(a):
    sc = a["spellcasting"]
    bits = [f"DC {sc['dc']}" if sc.get("dc") else "", f"+{sc['modifier']}" if sc.get("modifier") is not None else ""]
    bits = ", ".join(b for b in bits if b)
    head = f"Spells ({bits})" if bits else "Spells"
    lines = [l.lstrip("- ").strip() for l in a["desc"].splitlines() if l.strip().startswith("-") or re.match(r"^\s*(At will|\d/day)", l)]
    return f"{head}: " + "; ".join(lines) if lines else head


def special(m):
    out = []
    traits = [t["name"] + usage(t.get("usage")) for t in m.get("special_abilities", []) if "spellcasting" not in t]
    if traits:
        out.append(", ".join(traits))
    out += [spells(t) for t in m.get("special_abilities", []) if "spellcasting" in t]
    for label, key in [("Vuln", "damage_vulnerabilities"), ("Res", "damage_resistances"), ("Imm", "damage_immunities")]:
        if m.get(key):
            out.append(f"{label} " + ", ".join(m[key]))
    if m.get("condition_immunities"):
        out.append("Cond imm " + ", ".join(c["name"].lower() for c in m["condition_immunities"]))
    senses = [f"{k.replace('_', ' ').title()} {v}" for k, v in m.get("senses", {}).items() if k != "passive_perception"]
    senses.append(f"PP {m['senses'].get('passive_perception', 10)}")
    out.append(", ".join(senses))
    if m.get("legendary_actions"):
        out.append("Legendary: " + ", ".join(a["name"] for a in m["legendary_actions"]))
    if m.get("reactions"):
        out.append("Reaction: " + ", ".join(a["name"] for a in m["reactions"]))
    return ". ".join(out)


def speed(s):
    parts = []
    for k, v in s.items():
        if k == "hover":
            continue
        n = str(v).replace(" ft.", "")
        parts.append(n if k == "walk" else f"{k} {n}" + (" (hover)" if k == "fly" and s.get("hover") else ""))
    return ", ".join(parts)


def convert(m, links):
    saves = {a[:3]: mod(m[a]) for a in ABILITIES}
    for p in m.get("proficiencies", []):
        idx = p["proficiency"]["index"]
        if idx.startswith("saving-throw-"):
            saves[idx.removeprefix("saving-throw-")] = p["value"]
    actions = m.get("actions", [])
    name = name_of(m["name"])
    slug = links.get(name.lower()) or links.get(re.sub(r" \(.*\)$", "", name).lower())
    return {
        "name": name,
        "hp": m["hit_points"],
        "ac": m["armor_class"][0]["value"],
        "speed": speed(m["speed"]),
        "saves": saves,
        "init": mod(m["dexterity"]),
        "attacks": [multiattack(a) if a["name"] == "Multiattack" else action(a) for a in actions],
        "cr": m["challenge_rating"],
        "xp": m["xp"],
        "special": special(m),
        "url": f"https://open5e.com/monsters/srd_{slug}" if slug else "",
    }


def main():
    monsters = fetch(MONSTERS_URL)
    links = {r["name"].lower(): r["slug"] for r in fetch(OPEN5E_URL)["results"]}
    out = sorted((convert(m, links) for m in monsters), key=lambda m: m["name"])
    names = [m["name"] for m in out]
    assert len(names) == len(set(names)), "duplicate names"
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(out)} monsters, {sum(1 for m in out if not m['url'])} without a link -> {OUT}")


if __name__ == "__main__":
    main()
