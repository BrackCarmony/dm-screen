import fs from 'node:fs';
import path from 'node:path';

const KEYS = ['bestiary', 'encounters', 'shop', 'xp', 'party', 'battles', 'settings'];
// What a brand-new DM starts with: the reference data, none of another DM's campaign.
const STARTER_KEYS = ['bestiary', 'xp'];

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

function readSeed(seedDir, key) {
  const file = path.join(seedDir, `${key}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}

function blankState() {
  return {
    bestiary: [],
    encounters: [],
    shop: { tables: [], saved: [], note: '' },
    xp: { levels: [], cr: [] },
    party: [],
    battles: [],
    settings: {},
  };
}

// One JSON file per DM under dataDir/dms/.
export function createDmStore(dataDir, seedDir) {
  const dir = path.join(dataDir, 'dms');
  fs.mkdirSync(dir, { recursive: true });
  const cache = new Map();
  const fileFor = (userId) => path.join(dir, `${userId.replace(/[^a-zA-Z0-9_-]/g, '')}.json`);

  function load(userId) {
    if (cache.has(userId)) return cache.get(userId);
    const file = fileFor(userId);
    if (!fs.existsSync(file)) return null;
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    state.settings = { activeBattleId: null, ...state.settings };
    cache.set(userId, state);
    return state;
  }

  return {
    keys: KEYS,
    get: load,
    // full: seed the whole campaign (used for the first account); otherwise starter data only.
    create(userId, { full = false } = {}) {
      const state = blankState();
      const legacy = path.join(dataDir, 'state.json');
      if (full && fs.existsSync(legacy)) {
        Object.assign(state, JSON.parse(fs.readFileSync(legacy, 'utf8')));
      } else {
        for (const key of full ? KEYS : STARTER_KEYS) {
          const seed = readSeed(seedDir, key);
          if (seed !== undefined) state[key] = seed;
        }
        if (!full) {
          const shop = readSeed(seedDir, 'shop');
          if (shop) state.shop = { ...shop, saved: [], note: '' };
        }
      }
      state.settings = { activeBattleId: null, ...state.settings };
      writeJson(fileFor(userId), state);
      cache.set(userId, state);
      return state;
    },
    set(userId, key, value) {
      if (!KEYS.includes(key)) throw new Error(`unknown key ${key}`);
      const state = load(userId);
      state[key] = value;
      writeJson(fileFor(userId), state);
    },
  };
}

export function createUserStore(dataDir) {
  const file = path.join(dataDir, 'users.json');
  fs.mkdirSync(dataDir, { recursive: true });
  let users = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const save = () => writeJson(file, users);

  return {
    count: () => users.length,
    all: () => users,
    byId: (id) => users.find((u) => u.id === id) ?? null,
    byEmail: (email) => users.find((u) => u.email === email.toLowerCase()) ?? null,
    bySlug: (slug) => users.find((u) => u.slug === slug.toLowerCase()) ?? null,
    add(user) {
      users.push(user);
      save();
      return user;
    },
    update(id, patch) {
      users = users.map((u) => (u.id === id ? { ...u, ...patch } : u));
      save();
      return users.find((u) => u.id === id);
    },
  };
}
