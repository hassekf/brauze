// Password vault per-profile. SQLite + safeStorage (OS keychain).
// safeStorage usa Keychain (macOS), DPAPI (Windows), libsecret (Linux).

const path = require('path');
const fs   = require('fs');
const { safeStorage } = require('electron');

let db = null;

function init({ profilePath }) {
  if (db) return db;
  const Database = require('better-sqlite3');
  fs.mkdirSync(profilePath, { recursive: true });
  db = new Database(path.join(profilePath, 'passwords.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS passwords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT NOT NULL,
      username TEXT NOT NULL,
      password_blob BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      totp_blob BLOB,
      UNIQUE(origin, username)
    );
    CREATE INDEX IF NOT EXISTS pw_origin ON passwords(origin);
  `);
  return db;
}

function isAvailable() {
  try { return safeStorage.isEncryptionAvailable(); }
  catch { return false; }
}

function encrypt(plain) {
  if (!isAvailable()) throw new Error('safeStorage indisponível');
  return safeStorage.encryptString(plain);
}
function decrypt(buf) {
  return safeStorage.decryptString(buf);
}

function normalizeOrigin(o) {
  try { return new URL(o).origin; }
  catch { return o; }
}

// Salva ou atualiza credencial. Retorna {id, action: 'created'|'updated'}.
function save({ origin, username, password, notes }) {
  if (!db) return null;
  if (!origin || !username || !password) return null;
  const o = normalizeOrigin(origin);
  const blob = encrypt(password);
  const now = Date.now();
  const existing = db.prepare(`SELECT id FROM passwords WHERE origin = ? AND username = ?`).get(o, username);
  if (existing) {
    db.prepare(`UPDATE passwords SET password_blob = ?, notes = COALESCE(?, notes), last_used_at = ? WHERE id = ?`)
      .run(blob, notes ?? null, now, existing.id);
    return { id: existing.id, action: 'updated' };
  }
  const r = db.prepare(`INSERT INTO passwords (origin, username, password_blob, created_at, last_used_at, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(o, username, blob, now, now, notes || '');
  return { id: r.lastInsertRowid, action: 'created' };
}

function listForOrigin(origin) {
  if (!db) return [];
  const o = normalizeOrigin(origin);
  return db.prepare(`SELECT id, origin, username, last_used_at, use_count FROM passwords WHERE origin = ? ORDER BY last_used_at DESC`).all(o);
}

function getDecrypted(id) {
  if (!db) return null;
  const row = db.prepare(`SELECT id, origin, username, password_blob, totp_blob, notes FROM passwords WHERE id = ?`).get(id);
  if (!row) return null;
  let password = '';
  let totpSecret = '';
  try { password = decrypt(row.password_blob); } catch {}
  if (row.totp_blob) { try { totpSecret = decrypt(row.totp_blob); } catch {} }
  // marca uso
  db.prepare(`UPDATE passwords SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?`).run(Date.now(), id);
  return { id: row.id, origin: row.origin, username: row.username, password, totpSecret, notes: row.notes || '' };
}

function listAll() {
  if (!db) return [];
  return db.prepare(`SELECT id, origin, username, created_at, last_used_at, use_count, (totp_blob IS NOT NULL) AS has_totp FROM passwords ORDER BY origin, username`).all();
}

function remove(id) {
  if (!db) return false;
  const r = db.prepare(`DELETE FROM passwords WHERE id = ?`).run(id);
  return r.changes > 0;
}

function setTOTP(id, otpauthSecret) {
  if (!db) return false;
  const blob = otpauthSecret ? encrypt(otpauthSecret) : null;
  const r = db.prepare(`UPDATE passwords SET totp_blob = ? WHERE id = ?`).run(blob, id);
  return r.changes > 0;
}

function update(id, { username, notes }) {
  if (!db) return false;
  const r = db.prepare(`UPDATE passwords SET username = COALESCE(?, username), notes = COALESCE(?, notes) WHERE id = ?`)
    .run(username ?? null, notes ?? null, id);
  return r.changes > 0;
}

module.exports = { init, isAvailable, save, listForOrigin, listAll, getDecrypted, remove, setTOTP, update };
