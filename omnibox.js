// Combina history local + search suggestions externos + abas abertas num único resultado.

const https = require('https');
const history = require('./history');

const SUGGEST_TIMEOUT = 1500;

// Google suggestions API (mesma que o Chrome consome). Retorna ["query",[sug1,sug2,...]].
function fetchGoogleSuggestions(q) {
  return new Promise((resolve) => {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=pt-BR&q=${encodeURIComponent(q)}`;
    const req = https.get(url, { timeout: SUGGEST_TIMEOUT }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(Array.isArray(parsed) && Array.isArray(parsed[1]) ? parsed[1] : []);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve([]); });
  });
}

function looksLikeUrl(text) {
  const t = text.trim();
  if (/^[a-z]+:\/\//i.test(t) || t.startsWith('about:')) return true;
  // tem ponto sem espaço, ou é IP/localhost
  if (/^[^\s]+\.[^\s]+$/.test(t)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(t)) return true;
  return false;
}

function queryLocal({ text, openTabs, activeTabId }) {
  const q = (text || '').trim();
  if (!q) return [];
  const lc = q.toLowerCase();
  const items = [];

  // Sugere navegar direto se parece URL
  if (looksLikeUrl(q)) {
    const guess = /^[a-z]+:\/\//i.test(q) ? q : 'https://' + q;
    items.push({ kind: 'navigate', url: guess, title: guess, score: 300 });
  }

  // Open tabs match (exceto a ativa)
  for (const t of (openTabs || [])) {
    if (t.id === activeTabId) continue;
    const url = (t.url || '').toLowerCase();
    const title = (t.title || '').toLowerCase();
    if (url.includes(lc) || title.includes(lc)) {
      items.push({ kind: 'tab', url: t.url, title: t.title || t.url, tabId: t.id, score: 200 });
    }
  }

  // History local
  const hist = history.query(q, 6);
  for (const h of hist) {
    items.push({
      kind: 'history',
      url: h.url,
      title: h.title || h.url,
      visit_count: h.visit_count,
      score: 100,
    });
  }

  // Fallback "Pesquisar por '<q>'"
  if (!looksLikeUrl(q)) {
    items.push({ kind: 'search', query: q, title: q, score: 40, isFallback: true });
  }

  return dedupAndSort(items, 10);
}

async function querySuggestions(text) {
  const q = (text || '').trim();
  if (!q) return [];
  const lc = q.toLowerCase();
  const suggestions = await fetchGoogleSuggestions(q);
  return suggestions
    .slice(0, 6)
    .filter((s) => s.toLowerCase() !== lc)
    .map((s) => ({ kind: 'search', query: s, title: s, score: 50 }));
}

function dedupAndSort(items, max) {
  items.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.kind + '::' + (it.url || it.query || '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

module.exports = { queryLocal, querySuggestions, dedupAndSort };
