// Tracker de stats de privacidade por aba (webContentsId).
// Reseta quando o frame principal navega. Snapshot consultado pelo renderer
// pra alimentar o Privacy Dashboard.

const stats = new Map();

function newStats() {
  return {
    url: '',
    startedAt: Date.now(),
    trackersBlocked: 0,
    trackerHosts: new Set(),
    thirdPartyHosts: new Set(),
    thirdPartyCookiesBlocked: 0,
    permissionsRequested: {},      // { permission: 'granted'|'denied' }
    resources: {},                 // { image: n, script: n, ... }
    fingerprintAttempts: {},       // { canvas: n, webgl: n, audio: n, ... }
    sessionReplayTools: new Set(),
  };
}

function get(id) {
  if (!stats.has(id)) stats.set(id, newStats());
  return stats.get(id);
}

function reset(id, url = '') {
  const fresh = newStats();
  fresh.url = url;
  stats.set(id, fresh);
}

function drop(id) { stats.delete(id); }

function recordRequest(id, { host, type, isThirdParty }) {
  if (id == null) return;
  const s = get(id);
  if (isThirdParty && host) s.thirdPartyHosts.add(host);
  if (type) s.resources[type] = (s.resources[type] || 0) + 1;
}

function recordTrackerBlocked(id, host) {
  if (id == null) return;
  const s = get(id);
  s.trackersBlocked++;
  if (host) s.trackerHosts.add(host);
}

function recordCookieBlocked(id) {
  if (id == null) return;
  get(id).thirdPartyCookiesBlocked++;
}

function recordPermission(id, permission, allowed) {
  if (id == null) return;
  get(id).permissionsRequested[permission] = allowed ? 'granted' : 'denied';
}

function setFingerprintCounters(id, counters) {
  if (id == null || !counters) return;
  const s = get(id);
  for (const [k, v] of Object.entries(counters)) s.fingerprintAttempts[k] = v;
}

function recordSessionReplay(id, name) {
  if (id == null || !name) return;
  get(id).sessionReplayTools.add(name);
}

function snapshot(id) {
  const s = get(id);
  return {
    url: s.url,
    startedAt: s.startedAt,
    trackersBlocked: s.trackersBlocked,
    trackerHosts: Array.from(s.trackerHosts).sort(),
    thirdPartyHosts: Array.from(s.thirdPartyHosts).sort(),
    thirdPartyCookiesBlocked: s.thirdPartyCookiesBlocked,
    permissionsRequested: { ...s.permissionsRequested },
    resources: { ...s.resources },
    fingerprintAttempts: { ...s.fingerprintAttempts },
    sessionReplayTools: Array.from(s.sessionReplayTools).sort(),
  };
}

module.exports = {
  reset, drop, snapshot,
  recordRequest, recordTrackerBlocked, recordCookieBlocked,
  recordPermission, setFingerprintCounters, recordSessionReplay,
};
