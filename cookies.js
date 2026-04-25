// Privacy: bloqueia third-party cookies por default + helpers pra inspeção/limpeza.
// Whitelist por top-level site permite SSO e embeds que precisam de cookies cross-site.

const { getDomain } = require('tldts-experimental');
const fs   = require('node:fs');
const path = require('node:path');
const privacy = require('./privacy');

const allowed3PCookies = new Set();
let storePath = '';

// Domínios sempre permitidos como 3P (auth/SSO/captcha/payments).
// Bloquear esses quebra logins; analytics deles ainda é blocado pelo adblock.
const KNOWN_AUTH_PROVIDERS = new Set([
  // OpenAI
  'openai.com', 'chatgpt.com',
  // Google (auth + captcha; analytics é blocado pelo adblock pelo nome do host)
  'google.com', 'googleusercontent.com', 'gstatic.com', 'recaptcha.net',
  // Microsoft
  'microsoft.com', 'live.com', 'microsoftonline.com', 'office.com',
  // Apple
  'apple.com', 'icloud.com',
  // GitHub
  'github.com', 'githubusercontent.com', 'githubassets.com',
  // Auth0 / Okta / Duo
  'auth0.com', 'okta.com', 'duosecurity.com',
  // Social/login
  'facebook.com', 'discord.com', 'slack.com', 'twitch.tv',
  // Pagamentos
  'paypal.com', 'stripe.com',
  // Cloudflare (proteção/captcha)
  'cloudflare.com',
  // Amazon
  'amazon.com', 'amazonaws.com',
]);

function load(userDataPath) {
  storePath = path.join(userDataPath, 'cookies-3p-allow.json');
  try {
    const arr = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (Array.isArray(arr)) for (const h of arr) allowed3PCookies.add(h);
  } catch {}
}
function save() {
  if (!storePath) return;
  try { fs.writeFileSync(storePath, JSON.stringify(Array.from(allowed3PCookies))); }
  catch (err) { console.warn('[cookies] save:', err.message); }
}

function topSiteOf(details) {
  try {
    const url = details.frame?.top?.url || details.referrer || details.url;
    return getDomain(url) || '';
  } catch { return ''; }
}
function siteOf(url) {
  try { return getDomain(url) || ''; } catch { return ''; }
}

function isThirdParty(details) {
  const requestSite = siteOf(details.url);
  const topSite = topSiteOf(details);
  if (!requestSite || !topSite) return false;
  if (requestSite === topSite) return false;
  if (allowed3PCookies.has(topSite)) return false;
  if (KNOWN_AUTH_PROVIDERS.has(requestSite)) return false; // SSO/captcha/etc precisam do cookie
  return true;
}

function attachToSession(session) {
  // Strip Cookie header em requests cross-site
  session.webRequest.onBeforeSendHeaders((details, cb) => {
    if (!isThirdParty(details)) return cb({ requestHeaders: details.requestHeaders });
    const headers = { ...details.requestHeaders };
    let stripped = false;
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'cookie') { delete headers[k]; stripped = true; }
    }
    if (stripped) privacy.recordCookieBlocked(details.webContentsId);
    cb({ requestHeaders: headers });
  });

  // Strip Set-Cookie header em responses cross-site
  session.webRequest.onHeadersReceived((details, cb) => {
    if (!isThirdParty(details)) return cb({ responseHeaders: details.responseHeaders });
    const headers = { ...(details.responseHeaders || {}) };
    let stripped = false;
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'set-cookie') { delete headers[k]; stripped = true; }
    }
    if (stripped) privacy.recordCookieBlocked(details.webContentsId);
    cb({ responseHeaders: headers });
  });
}

// Whitelist API
function allow3P(topSite)    { allowed3PCookies.add(topSite); save(); }
function disallow3P(topSite) { allowed3PCookies.delete(topSite); save(); }
function listAllowed()       { return Array.from(allowed3PCookies).sort(); }

// Inspector / cleaner
async function listForOrigin(session, origin) {
  if (!origin) return [];
  try {
    const url = origin.startsWith('http') ? origin : 'https://' + origin;
    return await session.cookies.get({ url });
  } catch { return []; }
}
async function clearForOrigin(session, origin) {
  const cookies = await listForOrigin(session, origin);
  for (const c of cookies) {
    const url = (c.secure ? 'https://' : 'http://') + (c.domain.startsWith('.') ? c.domain.slice(1) : c.domain) + (c.path || '/');
    try { await session.cookies.remove(url, c.name); } catch {}
  }
  return cookies.length;
}
async function clearAll(session) {
  await session.clearStorageData({ storages: ['cookies'] });
}

module.exports = {
  load, attachToSession,
  allow3P, disallow3P, listAllowed,
  listForOrigin, clearForOrigin, clearAll,
};
