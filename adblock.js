// Adblock baseado em @ghostery/adblocker-electron com EasyList + EasyPrivacy.
// Lista é cacheada em disco em userData/adblock-cache.bin pra boots subsequentes
// não precisarem baixar de novo (~500KB).

const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fs   = require('node:fs/promises');
const path = require('node:path');

let blocker = null;

async function init({ userDataPath, session }) {
  const cachePath = path.join(userDataPath, 'adblock-cache.bin');
  try {
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cachePath,
      read: fs.readFile,
      write: fs.writeFile,
    });
    blocker.enableBlockingInSession(session);
    console.log('[adblock] ativo (EasyList + EasyPrivacy)');
    return true;
  } catch (err) {
    console.error('[adblock] falha ao iniciar:', err.message);
    return false;
  }
}

function disable(session) {
  if (blocker) blocker.disableBlockingInSession(session);
}

function isReady() { return blocker !== null; }

module.exports = { init, disable, isReady };
