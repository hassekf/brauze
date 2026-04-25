// Adblock baseado em @ghostery/adblocker-electron com whitelist por domínio.
// Lista é cacheada em disco em userData/adblock-cache.bin pra boots subsequentes
// não precisarem baixar de novo (~500KB).
//
// A gente NÃO usa enableBlockingInSession do lib porque ele instala um preload
// script de cosmetic filtering que viola Trusted Types CSP (quebra YouTube etc).
// Implementamos só o network blocking aqui, com bypass por hostname.

const { ElectronBlocker, fromElectronDetails } = require('@ghostery/adblocker-electron');
const { getDomain } = require('tldts-experimental');
const fs   = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const privacy = require('./privacy');

let blocker = null;
const whitelist = new Set();

const DEFAULT_WHITELIST = [
  // Sites com Trusted Types CSP ou que detectam adblock e quebram
  'youtube.com', 'youtu.be', 'youtubekids.com',
  'twitter.com', 'x.com',
  'tiktok.com',
  'twitch.tv',
];

function loadWhitelist(userDataPath) {
  whitelist.clear();
  for (const h of DEFAULT_WHITELIST) whitelist.add(h);
  const file = path.join(userDataPath, 'adblock-whitelist.json');
  try {
    const arr = JSON.parse(fsSync.readFileSync(file, 'utf8'));
    if (Array.isArray(arr)) for (const h of arr) whitelist.add(h);
  } catch {}
}

function saveWhitelist(userDataPath) {
  const file = path.join(userDataPath, 'adblock-whitelist.json');
  try { fsSync.writeFileSync(file, JSON.stringify(Array.from(whitelist))); }
  catch (err) { console.warn('[adblock] save whitelist:', err.message); }
}

function isWhitelisted(hostname) {
  if (!hostname) return false;
  for (const host of whitelist) {
    if (hostname === host || hostname.endsWith('.' + host)) return true;
  }
  return false;
}

async function init({ userDataPath, session }) {
  loadWhitelist(userDataPath);
  const cachePath = path.join(userDataPath, 'adblock-cache.bin');
  try {
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cachePath,
      read: fs.readFile,
      write: fs.writeFile,
    });
  } catch (err) {
    console.error('[adblock] falha ao iniciar:', err.message);
    return false;
  }

  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    try {
      const wcId = details.webContentsId;
      let host = '', refHost = '', topDomain = '';
      try { host = new URL(details.url).hostname; } catch {}
      try { refHost = new URL(details.referrer || '').hostname; } catch {}
      try { topDomain = getDomain(details.frame?.top?.url || details.referrer || details.url); } catch {}
      const reqDomain = getDomain(details.url);
      const isThirdParty = !!(reqDomain && topDomain && reqDomain !== topDomain);

      privacy.recordRequest(wcId, { host, type: details.resourceType, isThirdParty });

      // Bypass adblock se URL ou referrer está na whitelist
      if (isWhitelisted(host) || isWhitelisted(refHost)) {
        return callback({});
      }
      const request = fromElectronDetails(details);
      const result = blocker.match(request);
      if (result.match || result.redirect) {
        privacy.recordTrackerBlocked(wcId, host);
      }
      if (result.redirect) return callback({ redirectURL: result.redirect.dataUrl });
      if (result.match)    return callback({ cancel: true });
      callback({});
    } catch {
      callback({});
    }
  });

  console.log('[adblock] ativo (network only) · whitelist:', Array.from(whitelist).join(', '));
  return true;
}

function addToWhitelist(hostname, userDataPath) {
  if (!hostname) return false;
  whitelist.add(hostname);
  saveWhitelist(userDataPath);
  return true;
}

function removeFromWhitelist(hostname, userDataPath) {
  const ok = whitelist.delete(hostname);
  if (ok) saveWhitelist(userDataPath);
  return ok;
}

function getWhitelist() {
  return Array.from(whitelist).sort();
}

function isReady() { return blocker !== null; }

module.exports = { init, isReady, addToWhitelist, removeFromWhitelist, getWhitelist, isWhitelisted };
