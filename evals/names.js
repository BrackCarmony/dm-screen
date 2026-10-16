// Are a generator reply's monster names its own? The generator is told to make original monsters, and a DM
// can't tell two "Frost Wolf (1)" and "(2)" apart at the table. Deterministic, so free to run.
//
// Franchise names are caught with a word list, so only names on it are caught: it covers what the eval's
// pop-culture prompts invite (Nintendo, arcade classics) and D&D monsters that aren't in the SRD. Names that
// are also ordinary words (Peach, Tails, Sonic, Centipede) are left out, so "Shadow Tails" isn't flagged.
const BORROWED = [
  // Nintendo and other games
  'mario', 'luigi', 'koopa', 'bowser', 'goomba', 'yoshi', 'wario', 'kirby', 'dedede', 'zelda', 'hyrule', 'gerudo',
  'ganon', 'ganondorf', 'triforce', 'samus', 'metroid', 'pikachu', 'pokemon', 'pokémon', 'donkey kong', 'diddy', 'fox mccloud',
  'pac-man', 'pacman', 'galaga', 'mega man', 'megaman', 'street fighter', 'chun-li', 'q*bert', 'space invader', 'dig dug', 'master chief', 'minecraft',
  // D&D monsters that are Wizards of the Coast's own, not in the SRD
  'beholder', 'mind flayer', 'illithid', 'displacer beast', 'githyanki', 'githzerai', 'yuan-ti', 'carrion crawler', 'umber hulk',
  'slaad', 'kuo-toa',
];
const borrowedRe = new RegExp(`(?:^|[^a-z])(${BORROWED.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:$|[^a-z])`, 'i');

// Problems with one reply's names, per monster: [name, problem | null].
export function nameProblems(names) {
  const seen = new Map();
  for (const n of names) seen.set(n.toLowerCase(), (seen.get(n.toLowerCase()) ?? 0) + 1);
  return names.map((name) => {
    const borrowed = name.match(borrowedRe)?.[1];
    if (borrowed) return [name, `borrows "${borrowed}"`];
    if (/\(\s*\d+\s*\)|#\s*\d+|\s\d+$|\s(?:I|II|III|IV)$/.test(name)) return [name, 'numbered rather than named'];
    if (seen.get(name.toLowerCase()) > 1) return [name, 'same name as another monster in the reply'];
    return [name, null];
  });
}
