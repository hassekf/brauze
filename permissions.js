// Permission handler: nega permissões sensíveis por default. Sites precisam ser
// explicitamente liberados (via UI futura de settings ou allow-list em disco).

const fs   = require('node:fs');
const path = require('node:path');

// Sempre nega — sensitive
const DENY_ALWAYS = new Set([
  'geolocation',
  'camera',
  'microphone',
  'media',
  'mediaKeySystem',
  'midi',
  'midiSysex',
  'pointerLock',
  'window-management',
  'top-level-storage-access',
  'notifications',
  'idle-detection',
  'serial',
  'hid',
  'usb',
  'speaker-selection',
  'storage-access',
  'persistent-storage',
  'window-placement',
  'display-capture',
  'system-wake-lock',
]);

// Sempre permite — baixo risco
const ALLOW_ALWAYS = new Set([
  'clipboard-sanitized-write',
  'background-sync',
  'fullscreen', // bloquear quebra muitos vídeos
  'openExternal', // controlado via setWindowOpenHandler
]);

let perOrigin = {};
let storePath = '';

function load(userDataPath) {
  storePath = path.join(userDataPath, 'permissions.json');
  try {
    perOrigin = JSON.parse(fs.readFileSync(storePath, 'utf8')) || {};
  } catch { perOrigin = {}; }
}

function save() {
  if (!storePath) return;
  try { fs.writeFileSync(storePath, JSON.stringify(perOrigin)); }
  catch (err) { console.warn('[permissions] save:', err.message); }
}

function decide(origin, permission) {
  const o = perOrigin[origin];
  if (o && Object.prototype.hasOwnProperty.call(o, permission)) return o[permission];
  if (DENY_ALWAYS.has(permission)) return false;
  if (ALLOW_ALWAYS.has(permission)) return true;
  return false; // default deny
}

function setOriginDecision(origin, permission, allow) {
  if (!perOrigin[origin]) perOrigin[origin] = {};
  perOrigin[origin][permission] = !!allow;
  save();
}

function listOrigins() { return { ...perOrigin }; }

function clearOrigin(origin) {
  delete perOrigin[origin];
  save();
}

module.exports = { load, decide, setOriginDecision, listOrigins, clearOrigin };
