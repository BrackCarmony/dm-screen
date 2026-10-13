import fs from 'node:fs';
import path from 'node:path';

const KEYS = ['bestiary', 'encounters', 'shop', 'xp', 'party', 'battles', 'settings'];

export function createStore(dataDir, seedDir) {
  const file = path.join(dataDir, 'state.json');
  let state;

  if (fs.existsSync(file)) {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    state = {};
    for (const key of KEYS) {
      const seed = path.join(seedDir, `${key}.json`);
      if (fs.existsSync(seed)) state[key] = JSON.parse(fs.readFileSync(seed, 'utf8'));
    }
  }
  state.settings = { activeBattleId: null, ...state.settings };
  fs.mkdirSync(dataDir, { recursive: true });
  save();

  function save() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, file);
  }

  return {
    keys: KEYS,
    get: () => state,
    set(key, value) {
      if (!KEYS.includes(key)) throw new Error(`unknown key ${key}`);
      state[key] = value;
      save();
    },
  };
}
