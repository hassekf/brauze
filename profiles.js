// Profile system: cada profile é um espaço isolado de session, history, cookies,
// permissions, vault de senhas, etc. Stored em userData/profiles/<id>/.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let baseDir = '';
let configPath = '';
let state = { profiles: [], activeId: null };

const PROFILE_COLORS = ['#5a8dff', '#4ade80', '#f59e0b', '#c084fc', '#ff7373', '#06b6d4', '#a78bfa', '#fb7185'];

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (raw && Array.isArray(raw.profiles)) state = raw;
  } catch { state = { profiles: [], activeId: null }; }
}

function save() {
  try { fs.writeFileSync(configPath, JSON.stringify(state, null, 2)); }
  catch (err) { console.warn('[profiles] save:', err.message); }
}

function bootstrapDefault() {
  const id = 'default';
  const dir = getProfilePath(id);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}

  // Migra arquivos legados pro default profile (uma vez só, idempotente)
  const LEGACY_FILES = [
    'brauze-history.db', 'brauze-history.db-wal', 'brauze-history.db-shm',
    'adblock-cache.bin',
    'adblock-whitelist.json',
    'cookies-3p-allow.json',
    'permissions.json',
    'watched-folders.json',
  ];
  for (const f of LEGACY_FILES) {
    const src = path.join(baseDir, f);
    const dst = path.join(dir, f);
    try {
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.renameSync(src, dst);
        console.log(`[profiles] migrated ${f} → default profile`);
      }
    } catch {}
  }

  state.profiles.push({
    id,
    name: 'Pessoal',
    color: PROFILE_COLORS[0],
    avatar: 'P',
    createdAt: Date.now(),
    sessionPartition: 'persist:brauze', // mantém legacy partition pros cookies/storage existentes
  });
  state.activeId = id;
  save();
}

function init(userDataPath) {
  baseDir = userDataPath;
  configPath = path.join(userDataPath, 'profiles.json');
  load();
  if (!state.profiles.length) bootstrapDefault();
  if (!state.activeId || !state.profiles.find((p) => p.id === state.activeId)) {
    state.activeId = state.profiles[0].id;
    save();
  }
}

function getProfilePath(id) {
  return path.join(baseDir, 'profiles', id);
}

function getActive() {
  return state.profiles.find((p) => p.id === state.activeId) || state.profiles[0];
}

function getActiveSession() {
  const p = getActive();
  return p.sessionPartition || `persist:profile-${p.id}`;
}

function list() { return state.profiles.slice(); }

function create({ name, color, avatar }) {
  const id = 'p_' + crypto.randomBytes(6).toString('hex');
  const profile = {
    id,
    name: name || 'Novo profile',
    color: color || PROFILE_COLORS[state.profiles.length % PROFILE_COLORS.length],
    avatar: (avatar || (name ? name[0] : 'B')).toUpperCase(),
    createdAt: Date.now(),
    sessionPartition: `persist:profile-${id}`,
  };
  state.profiles.push(profile);
  save();
  try { fs.mkdirSync(getProfilePath(id), { recursive: true }); } catch {}
  return profile;
}

function setActive(id) {
  if (!state.profiles.find((p) => p.id === id)) return false;
  state.activeId = id;
  save();
  return true;
}

function update(id, patch) {
  const p = state.profiles.find((p) => p.id === id);
  if (!p) return false;
  Object.assign(p, patch);
  save();
  return true;
}

function remove(id) {
  if (state.profiles.length <= 1) return false;
  state.profiles = state.profiles.filter((p) => p.id !== id);
  if (state.activeId === id) state.activeId = state.profiles[0].id;
  save();
  return true;
}

module.exports = {
  init, getProfilePath, getActive, getActiveSession,
  list, create, setActive, update, remove,
};
