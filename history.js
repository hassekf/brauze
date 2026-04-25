// Histórico de navegação em SQLite. Ranqueia matches por substring + recência + frequência.

const path = require('path');
const fs   = require('fs');

let db = null;

function init({ userDataPath }) {
  if (db) return db;
  const Database = require('better-sqlite3');
  fs.mkdirSync(userDataPath, { recursive: true });
  const dbPath = path.join(userDataPath, 'brauze-history.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_visit_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS urls_last_visit ON urls(last_visit_at DESC);
    CREATE INDEX IF NOT EXISTS urls_url ON urls(url);
    CREATE INDEX IF NOT EXISTS urls_title ON urls(title);
  `);
  return db;
}

function isIgnoredUrl(url) {
  if (!url) return true;
  return /^(brauze|about|chrome|devtools|file|view-source|data):/i.test(url);
}

function recordVisit({ url, title }) {
  if (!db || isIgnoredUrl(url)) return;
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO urls (url, title, visit_count, last_visit_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(url) DO UPDATE SET
      title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE urls.title END,
      visit_count = urls.visit_count + 1,
      last_visit_at = excluded.last_visit_at
  `);
  try { stmt.run(url, title || '', now); }
  catch (err) { console.error('[history] recordVisit:', err.message); }
}

// Score: 100 se prefixo, 60 se substring no host, 40 se substring no path/title.
// Bonus por recência (até 30) e por visit_count (log).
function scoreRow(row, q, now) {
  const url = row.url.toLowerCase();
  const title = (row.title || '').toLowerCase();
  let host = '';
  try { host = new URL(row.url).hostname.toLowerCase(); } catch {}

  let score = 0;
  if (host.startsWith(q) || url.startsWith('https://' + q) || url.startsWith('http://' + q)) score += 100;
  else if (host.includes(q)) score += 70;
  else if (url.includes(q)) score += 45;
  else if (title.includes(q)) score += 35;
  else return 0;

  // Recência: até 30 pts, decai em ~30 dias
  const ageDays = (now - row.last_visit_at) / (1000 * 60 * 60 * 24);
  score += Math.max(0, 30 - ageDays);

  // Frequência: log10(visits) * 8
  score += Math.log10(Math.max(1, row.visit_count)) * 8;

  return score;
}

function query(text, limit = 6) {
  if (!db) return [];
  const q = (text || '').trim().toLowerCase();
  if (!q) return [];

  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  // Pega candidatos amplos via LIKE em url + title; depois ranqueia em JS.
  const rows = db.prepare(`
    SELECT url, title, visit_count, last_visit_at
    FROM urls
    WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
    ORDER BY last_visit_at DESC
    LIMIT 200
  `).all(like, like);

  const now = Date.now();
  const scored = rows
    .map((r) => ({ ...r, _score: scoreRow(r, q, now) }))
    .filter((r) => r._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);

  return scored.map(({ url, title, visit_count, last_visit_at }) => ({
    url, title, visit_count, last_visit_at,
  }));
}

module.exports = { init, recordVisit, query, isIgnoredUrl };
