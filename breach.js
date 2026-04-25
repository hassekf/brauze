// HIBP breach check via k-anonymity (api.pwnedpasswords.com).
// Só os 5 primeiros chars do SHA1 saem do dispositivo. Server não consegue
// reconstruir a senha. Mesma técnica que 1Password e Bitwarden usam.

const crypto = require('crypto');
const https = require('https');

const cache = new Map(); // hashPrefix → { suffixes: Map<suffix, count>, ts }
const CACHE_TTL = 30 * 60 * 1000;

function fetchRange(prefix) {
  return new Promise((resolve) => {
    const req = https.get(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'User-Agent': 'Brauze/0.1', 'Add-Padding': 'true' },
      timeout: 4000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const map = new Map();
        for (const line of body.split('\n')) {
          const [s, count] = line.trim().split(':');
          if (s) map.set(s.toUpperCase(), Number(count) || 0);
        }
        resolve(map);
      });
    });
    req.on('error',   () => resolve(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(null); });
  });
}

async function check(password) {
  if (!password) return { pwned: false, count: 0, ok: true };
  const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const now = Date.now();
  let entry = cache.get(prefix);
  if (!entry || now - entry.ts > CACHE_TTL) {
    const suffixes = await fetchRange(prefix);
    if (!suffixes) return { pwned: false, count: 0, ok: false };
    entry = { suffixes, ts: now };
    cache.set(prefix, entry);
  }
  const count = entry.suffixes.get(suffix);
  return { pwned: !!count, count: count || 0, ok: true };
}

module.exports = { check };
