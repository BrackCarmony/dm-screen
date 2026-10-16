// Can a DM tell a reply's monsters apart by name? Copies told apart only by a number ("Frost Wolf (1)",
// "(2)") or repeated names make that hard at the table. Names from the franchise a request is based on are
// fine. Deterministic, so free to run.

// Problems with one reply's names, per monster: [name, problem | null].
export function nameProblems(names) {
  const seen = new Map();
  for (const n of names) seen.set(n.toLowerCase(), (seen.get(n.toLowerCase()) ?? 0) + 1);
  return names.map((name) => {
    if (/\(\s*\d+\s*\)|#\s*\d+|\s\d+$|\s(?:I|II|III|IV)$/.test(name)) return [name, 'numbered rather than named'];
    if (seen.get(name.toLowerCase()) > 1) return [name, 'same name as another monster in the reply'];
    return [name, null];
  });
}
