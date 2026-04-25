// Resolve um host *.test pra pasta de projeto via Herd (macOS).
// Lê o config.json do Herd, cacheia até o mtime mudar.

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CONFIG_PATH = path.join(
  os.homedir(),
  'Library', 'Application Support', 'Herd', 'config', 'valet', 'config.json'
);

let cache = { mtime: 0, config: null };

function loadConfig() {
  if (os.platform() !== 'darwin') return null;
  let stat;
  try { stat = fs.statSync(CONFIG_PATH); }
  catch { cache = { mtime: 0, config: null }; return null; }
  if (cache.config && stat.mtimeMs === cache.mtime) return cache.config;
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cache = { mtime: stat.mtimeMs, config };
    return config;
  } catch { return null; }
}

function candidates(host, tld) {
  const suffix = '.' + tld;
  if (!host.endsWith(suffix)) return [];
  const stripped = host.slice(0, -suffix.length);
  const out = [stripped];
  const parts = stripped.split('.');
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (!out.includes(last)) out.push(last);
    if (!out.includes(parts[0])) out.push(parts[0]);
  }
  return out;
}

function resolve(host) {
  if (!host) return null;
  const cfg = loadConfig();
  if (!cfg || !Array.isArray(cfg.paths)) return null;
  const tld = cfg.tld || 'test';
  for (const name of candidates(host, tld)) {
    for (const base of cfg.paths) {
      const full = path.join(base, name);
      try {
        if (fs.statSync(full).isDirectory()) return { path: full, name };
      } catch {}
    }
  }
  return null;
}

module.exports = { resolve };
