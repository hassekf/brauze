const tabsEl     = document.getElementById('tabs');
const viewsEl    = document.getElementById('views');
const addressEl  = document.getElementById('address');
const backBtn    = document.getElementById('back');
const forwardBtn = document.getElementById('forward');
const reloadBtn  = document.getElementById('reload');
const newtabBtn  = document.getElementById('newtab');

const HOMEPAGE = 'brauze://newtab';
const isNewtabUrl = (u) => !u || u === HOMEPAGE || u.startsWith('brauze://newtab');

// Quick search shortcuts: digite "gh foo bar" pra buscar no GitHub direto.
const SEARCH_SHORTCUTS = {
  gh:   { name: 'GitHub',  template: 'https://github.com/search?q=%s' },
  npm:  { name: 'npm',     template: 'https://www.npmjs.com/search?q=%s' },
  mdn:  { name: 'MDN',     template: 'https://developer.mozilla.org/en-US/search?q=%s' },
  yt:   { name: 'YouTube', template: 'https://www.youtube.com/results?search_query=%s' },
  so:   { name: 'Stack Overflow', template: 'https://stackoverflow.com/search?q=%s' },
  wiki: { name: 'Wikipedia', template: 'https://en.wikipedia.org/wiki/Special:Search?search=%s' },
  gpt:  { name: 'ChatGPT', template: 'https://chat.openai.com/?q=%s' },
  amz:  { name: 'Amazon',  template: 'https://www.amazon.com.br/s?k=%s' },
};

function detectShortcut(text) {
  const t = (text || '').trim();
  if (!t) return null;
  const m = t.match(/^(\w+)(?:\s+(.+))?$/);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const sc = SEARCH_SHORTCUTS[key];
  if (!sc) return null;
  const query = (m[2] || '').trim();
  return {
    key, name: sc.name, query,
    url: query ? sc.template.replace('%s', encodeURIComponent(query)) : null,
  };
}

const tabs = new Map();
let activeId = null;
let nextId = 1;

function normalizeUrl(input) {
  const raw = input.trim();
  if (!raw) return HOMEPAGE;
  const sc = detectShortcut(raw);
  if (sc && sc.url) return sc.url;
  if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith('about:')) return raw;
  // Heurística simples: tem ponto e nada de espaço → URL; senão, busca no Google.
  if (/^[^\s]+\.[^\s]+$/.test(raw)) return 'https://' + raw;
  return 'https://www.google.com/search?q=' + encodeURIComponent(raw);
}

function createTab(url = HOMEPAGE) {
  const id = nextId++;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab entering';
  tabEl.dataset.id = id;
  tabEl.innerHTML =
    `<span class="favicon">` +
      `<span class="spinner"></span>` +
      `<img class="favicon-img" alt="">` +
      `<svg class="favicon-default" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">` +
        `<circle cx="8" cy="8" r="6.2"/>` +
        `<path d="M1.8 8h12.4M8 1.8c2 2.2 2 10.2 0 12.4M8 1.8c-2 2.2-2 10.2 0 12.4"/>` +
      `</svg>` +
    `</span>` +
    `<span class="title">Nova aba</span>` +
    `<span class="audio" title="Mutar/desmutar">` +
      `<svg class="audio-on" viewBox="0 0 16 16" fill="currentColor"><path d="M3 6h2.5L9 3v10L5.5 10H3V6z"/><path d="M11 5.5c1 .8 1 4.2 0 5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>` +
      `<svg class="audio-off" viewBox="0 0 16 16" fill="currentColor"><path d="M3 6h2.5L9 3v10L5.5 10H3V6z"/><path d="M11 6l3 4M14 6l-3 4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>` +
    `</span>` +
    `<span class="close" title="Fechar">×</span>`;
  tabsEl.insertBefore(tabEl, newtabBtn);
  // Tira a classe entering em dois rAFs pra browser computar layout colapsado primeiro,
  // aí transitar suavemente até o tamanho final.
  requestAnimationFrame(() => requestAnimationFrame(() => tabEl.classList.remove('entering')));

  const view = document.createElement('webview');
  view.dataset.id = id;
  view.setAttribute('src', url);
  view.setAttribute('allowpopups', '');
  view.setAttribute('partition', 'persist:brauze'); // session compartilhada (cookies + adblock)
  viewsEl.appendChild(view);

  // Splash dark sobre o webview até o primeiro paint, mata o flash branco do Chromium.
  const splash = document.createElement('div');
  splash.className = 'view-splash';
  splash.dataset.id = id;
  viewsEl.appendChild(splash);
  let splashRemoved = false;
  const removeSplash = () => {
    if (splashRemoved) return;
    splashRemoved = true;
    splash.classList.add('fading');
    setTimeout(() => {
      splash.remove();
      const entry = tabs.get(id);
      if (entry) entry.splash = null;
    }, 200);
  };
  view.addEventListener('did-stop-loading', removeSplash, { once: true });
  view.addEventListener('did-fail-load',   removeSplash, { once: true });
  setTimeout(removeSplash, 4000); // safety net

  view.addEventListener('page-title-updated', (e) => {
    tabEl.querySelector('.title').textContent = e.title || 'Sem título';
    // Atualiza title no history pra última URL conhecida
    const url = safeGetUrl(view);
    if (url && !isNewtabUrl(url)) {
      window.brauze.omnibox.recordVisit({ url, title: e.title || '' });
    }
  });
  view.addEventListener('page-favicon-updated', (e) => {
    const url = (e.favicons && e.favicons[0]) || '';
    const img = tabEl.querySelector('.favicon-img');
    if (!url) return;
    img.onload  = () => tabEl.classList.add('has-favicon');
    img.onerror = () => {
      img.removeAttribute('src');
      tabEl.classList.remove('has-favicon');
    };
    img.src = url;
  });
  view.addEventListener('did-start-navigation', (e) => {
    // Reset favicon ao navegar pra outro host (evita ícone errado durante load)
    if (e.isMainFrame) {
      tabEl.classList.remove('has-favicon');
      tabEl.querySelector('.favicon-img').removeAttribute('src');
    }
  });
  view.addEventListener('did-navigate', (e) => {
    if (id === activeId) {
      if (mode === 'prompt') setMode('web'); // navegação real → sai do modo IA
      else addressEl.value = isNewtabUrl(e.url) ? '' : e.url;
      updateHerdChip();
    }
    if (!isNewtabUrl(e.url)) {
      const t = tabEl.querySelector('.title')?.textContent || '';
      window.brauze.omnibox.recordVisit({ url: e.url, title: t });
    }
    updateNav();
  });
  view.addEventListener('did-navigate-in-page', (e) => {
    if (id === activeId) {
      if (mode === 'prompt') setMode('web');
      else addressEl.value = isNewtabUrl(e.url) ? '' : e.url;
      updateHerdChip();
    }
    updateNav();
  });
  view.addEventListener('did-start-loading', () => { tabEl.classList.add('loading'); updateNav(); });
  view.addEventListener('did-stop-loading',  () => { tabEl.classList.remove('loading'); updateNav(); });
  view.addEventListener('found-in-page', (e) => {
    if (id !== activeId) return;
    const r = e.result || {};
    if (r.activeMatchOrdinal != null && r.matches != null) {
      FIND_COUNTER.textContent = `${r.activeMatchOrdinal}/${r.matches}`;
    }
  });
  view.addEventListener('media-started-playing', () => tabEl.classList.add('audible'));
  view.addEventListener('media-paused',          () => tabEl.classList.remove('audible'));
  view.addEventListener('dom-ready', () => {
    try { view.executeJavaScript(FP_PATCHES_JS, false); } catch {}
    try { view.insertCSS(COOKIE_BANNERS_CSS); } catch {}
  });

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('close')) {
      closeTab(id);
      return;
    }
    if (e.target.closest('.audio')) {
      e.stopPropagation();
      const muted = !view.isAudioMuted();
      view.setAudioMuted(muted);
      tabEl.classList.toggle('muted', muted);
      return;
    }
    activateTab(id);
  });

  tabs.set(id, { tabEl, view, splash });
  activateTab(id);
  return id;
}

function safeGetUrl(view) {
  // getURL() lança se o webview ainda não disparou dom-ready. Cai pro atributo src.
  try { return view.getURL() || view.getAttribute('src') || ''; }
  catch { return view.getAttribute('src') || ''; }
}

function activateTab(id) {
  if (activeId === id) return;
  for (const [tid, entry] of tabs) {
    const isActive = tid === id;
    entry.tabEl.classList.toggle('active', isActive);
    entry.view.classList.toggle('active', isActive);
    if (entry.splash) entry.splash.classList.toggle('active', isActive);
  }
  activeId = id;

  const { view } = tabs.get(id);
  const url = safeGetUrl(view);
  addressEl.value = isNewtabUrl(url) ? '' : url;
  if (isNewtabUrl(url)) addressEl.focus();
  updateNav();
  updateHerdChip();
  // DevTools tá amarrado ao webContents da aba — fecha ao trocar
  if (devtoolsOpen) closeDevTools();
}

const closedStack = [];
const CLOSED_STACK_MAX = 30;

function closeTab(id) {
  const entry = tabs.get(id);
  if (!entry) return;
  // Guarda URL pra reabrir com Cmd+Shift+T (ignora newtab)
  const closedUrl = safeGetUrl(entry.view);
  if (closedUrl && !isNewtabUrl(closedUrl)) {
    closedStack.push(closedUrl);
    if (closedStack.length > CLOSED_STACK_MAX) closedStack.shift();
  }
  entry.view.remove();
  if (entry.splash) entry.splash.remove();
  tabs.delete(id);

  // Anima a saída antes de remover do DOM.
  entry.tabEl.classList.add('exiting');
  setTimeout(() => entry.tabEl.remove(), 200);

  if (activeId === id) {
    activeId = null;
    const next = tabs.keys().next().value;
    if (next !== undefined) activateTab(next);
    else createTab();
  }
}

function updateNav() {
  if (activeId === null) {
    backBtn.disabled = forwardBtn.disabled = reloadBtn.disabled = true;
    return;
  }
  const { view } = tabs.get(activeId);
  // canGoBack/Forward só ficam disponíveis após o webview terminar de "attach"
  try {
    backBtn.disabled    = !view.canGoBack();
    forwardBtn.disabled = !view.canGoForward();
  } catch {
    backBtn.disabled = forwardBtn.disabled = true;
  }
  reloadBtn.disabled = false;
}

backBtn.addEventListener('click', () => {
  const { view } = tabs.get(activeId);
  if (view.canGoBack()) view.goBack();
});
forwardBtn.addEventListener('click', () => {
  const { view } = tabs.get(activeId);
  if (view.canGoForward()) view.goForward();
});
reloadBtn.addEventListener('click', () => {
  tabs.get(activeId).view.reload();
});
newtabBtn.addEventListener('click', () => createTab());

// ---- Omnibox dropdown ----
const OMNI_POPOVER = document.getElementById('omnibox-popover');
let omniItems = [];
let omniIdx = -1;
let omniOpen = false;
let omniSeq = 0;
let omniDebounce = null;
let omniLastQuery = '';
let omniRenderedFor = '';

function positionOmni() {
  const r = addressEl.getBoundingClientRect();
  OMNI_POPOVER.style.left  = r.left + 'px';
  OMNI_POPOVER.style.top   = (r.bottom + 4) + 'px';
  OMNI_POPOVER.style.width = r.width + 'px';
}

function iconFor(kind) {
  switch (kind) {
    case 'shortcut': return '⚡';
    case 'navigate': return '↪';
    case 'tab':      return '⎘';
    case 'history':  return '🕘';
    case 'search':   return '🔍';
    default:         return '·';
  }
}

function faviconUrlFor(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=32`;
  } catch { return null; }
}

function omniIconHtml(it) {
  const fav = it.url ? faviconUrlFor(it.url) : null;
  if (fav) {
    return `<span class="omni-icon"><img class="omni-favicon" src="${escapeHtml(fav)}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="omni-fallback" style="display:none">${iconFor(it.kind)}</span></span>`;
  }
  return `<span class="omni-icon">${iconFor(it.kind)}</span>`;
}

function renderOmni() {
  if (!omniItems.length) { closeOmni(); return; }
  positionOmni();
  OMNI_POPOVER.innerHTML = '';
  omniItems.forEach((it, i) => {
    const el = document.createElement('div');
    el.className = 'omni-item' + (i === omniIdx ? ' selected' : '');
    let secondary = '';
    if (it.kind === 'history' || it.kind === 'tab' || it.kind === 'navigate') {
      try { secondary = ' · ' + new URL(it.url).hostname; } catch {}
    }
    el.innerHTML =
      omniIconHtml(it) +
      `<span class="omni-text">${escapeHtml(it.title || it.query || it.url)}<span class="omni-secondary">${escapeHtml(secondary)}</span></span>` +
      (it.kind === 'tab' ? `<span class="omni-pill">aba</span>` : '');
    el.addEventListener('mousedown', (e) => {
      e.preventDefault(); // não dispara blur do input
      activateOmniItem(it);
    });
    el.addEventListener('mouseenter', () => {
      omniIdx = i;
      Array.from(OMNI_POPOVER.children).forEach((c, j) => c.classList.toggle('selected', j === omniIdx));
    });
    OMNI_POPOVER.appendChild(el);
  });
  OMNI_POPOVER.classList.remove('hidden');
  omniOpen = true;
}

function closeOmni() {
  omniOpen = false;
  omniItems = [];
  omniIdx = -1;
  OMNI_POPOVER.classList.add('hidden');
  OMNI_POPOVER.innerHTML = '';
}

function selectedKey() {
  if (omniIdx < 0 || omniIdx >= omniItems.length) return null;
  const it = omniItems[omniIdx];
  return it.kind + '::' + (it.url || it.query || '');
}

function isHighConfidence(it) {
  if (!it || !it.url) return false;
  if (it.kind === 'navigate') return true;
  if (it.kind === 'history' && (it.visit_count || 0) >= 2) return true;
  return false;
}

function applyItems(items, text) {
  const sc = detectShortcut(text);
  if (sc && sc.url) {
    items = [
      { kind: 'shortcut', title: `Buscar "${sc.query}" em ${sc.name}`, url: sc.url, score: 400 },
      ...items.filter((it) => it.url !== sc.url),
    ];
  }
  const prevKey = selectedKey();
  omniItems = items;
  if (!items.length) { omniIdx = -1; }
  else if (prevKey) {
    const idx = items.findIndex((it) => it.kind + '::' + (it.url || it.query || '') === prevKey);
    omniIdx = idx >= 0 ? idx : 0;
  } else {
    omniIdx = 0;
  }
  omniRenderedFor = text;
  renderOmni();
  // Preconnect na top sugestão se for high-confidence
  const top = items[0];
  if (isHighConfidence(top)) window.brauze.omnibox.preconnect(top.url);
}

async function queryOmni(text) {
  const seq = ++omniSeq;
  omniLastQuery = text;
  const openTabs = [];
  for (const [id, entry] of tabs) {
    const url = safeGetUrl(entry.view);
    const title = entry.tabEl.querySelector('.title')?.textContent || '';
    openTabs.push({ id, url, title });
  }

  // 1. Local: rápido, mostra na hora
  let local = [];
  try { local = await window.brauze.omnibox.queryLocal({ text, openTabs, activeTabId: activeId }); }
  catch { local = []; }
  if (seq !== omniSeq || omniLastQuery !== text) return;
  applyItems(local, text);

  // 2. Suggestions: chega depois, mergeia
  let sugs = [];
  try { sugs = await window.brauze.omnibox.querySuggestions(text); }
  catch { sugs = []; }
  if (seq !== omniSeq || omniLastQuery !== text) return;
  // Filtra suggestions que duplicam fallback ou itens existentes
  const merged = [...local];
  for (const s of sugs) {
    if (!merged.find((m) => m.kind === s.kind && (m.query || m.url) === (s.query || s.url))) {
      merged.push(s);
    }
  }
  // Reordena por score, preserva limit
  merged.sort((a, b) => b.score - a.score);
  applyItems(merged.slice(0, 10), text);
}

function scheduleOmni(text) {
  if (omniDebounce) clearTimeout(omniDebounce);
  if (!text.trim()) { closeOmni(); return; }
  // Sem debounce: dispara imediato (local é instantâneo, suggestions vão em paralelo)
  queryOmni(text);
}

function activateOmniItem(it) {
  closeOmni();
  if (!it) return;
  const view = tabs.get(activeId)?.view;
  if (!view) return;
  if (it.kind === 'tab' && it.tabId != null) {
    activateTab(it.tabId);
    return;
  }
  if (it.kind === 'search') {
    const url = 'https://www.google.com/search?q=' + encodeURIComponent(it.query);
    view.loadURL(url);
    return;
  }
  if (it.url) view.loadURL(it.url);
}

addressEl.addEventListener('input', () => {
  scheduleOmni(addressEl.value);
});

addressEl.addEventListener('keydown', (e) => {
  if (omniOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      omniIdx = (omniIdx + 1) % omniItems.length;
      renderOmni();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      omniIdx = (omniIdx - 1 + omniItems.length) % omniItems.length;
      renderOmni();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeOmni();
      return;
    }
    if (e.key === 'Enter' && omniIdx >= 0 && omniRenderedFor === addressEl.value) {
      e.preventDefault();
      if (mode === 'prompt') { submitPrompt(addressEl.value); return; }
      activateOmniItem(omniItems[omniIdx]);
      return;
    }
  }
  if (e.key === 'Enter') {
    closeOmni();
    if (mode === 'prompt') {
      submitPrompt(addressEl.value);
    } else {
      const url = normalizeUrl(addressEl.value);
      tabs.get(activeId).view.loadURL(url);
    }
  }
});
addressEl.addEventListener('focus', () => {
  addressEl.select();
  addressWrap.classList.add('focused');
  if (addressEl.value.trim()) scheduleOmni(addressEl.value);
});
addressEl.addEventListener('blur', () => {
  addressWrap.classList.remove('focused');
  // pequeno delay pra permitir click nos itens
  setTimeout(closeOmni, 120);
});
window.addEventListener('resize', () => { if (omniOpen) positionOmni(); });

// Atalhos: roteados via main (before-input-event) → window.brauze.shortcuts.onFire

// ---- Project Radar ----
const radarItem      = document.getElementById('radar-item');
const radarDot       = document.getElementById('radar-dot');
const radarLabel     = document.getElementById('radar-label');
const radarPopover   = document.getElementById('radar-popover');
const radarList      = document.getElementById('radar-list');
const radarRefresh   = document.getElementById('radar-refresh');
const radarSettingsBtn  = document.getElementById('radar-settings-btn');
const radarSettingsView = document.getElementById('radar-settings-view');
const radarTitle        = document.getElementById('radar-title');
const radarFooter       = document.getElementById('radar-footer');
const popoverBackdrop = document.getElementById('popover-backdrop');

let lastServices = [];

function renderRadarStatus(services) {
  const count = services.length;
  if (count === 0) {
    radarDot.className = 'status-dot';
    radarLabel.textContent = 'nenhum serviço';
  } else {
    radarDot.className = 'status-dot live';
    radarLabel.textContent = count === 1 ? '1 serviço' : `${count} serviços`;
  }
}

function renderKillButton(svc) {
  const btn = document.createElement('button');
  btn.className = 'service-btn danger';
  btn.dataset.action = 'kill';
  btn.textContent = `🛑 matar (PID ${svc.pid})`;
  btn.title = `Mata o processo ${svc.pid} ouvindo em :${svc.port}`;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const where = svc.cwd ? `\n\n${svc.cwd}` : '';
    if (!confirm(`Matar PID ${svc.pid} na porta :${svc.port}?\n${svc.name}${where}`)) return;
    btn.disabled = true;
    btn.textContent = '⏳ matando…';
    try {
      const res = await window.brauze.radar.killPid(svc.pid);
      if (res.ok) {
        btn.textContent = res.signal === 'SIGKILL' ? '✓ morto (SIGKILL)' : '✓ morto';
        try {
          const services = await window.brauze.radar.scanNow();
          lastServices = services;
          renderRadarStatus(services);
          renderRadarList(services);
        } catch {}
      } else {
        btn.disabled = false;
        btn.textContent = `🛑 matar (PID ${svc.pid})`;
        alert('Falha ao matar: ' + (res.error || 'erro desconhecido'));
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = `🛑 matar (PID ${svc.pid})`;
      alert('Erro: ' + (err.message || err));
    }
  });
  return btn;
}

function renderActionsRow(folder, folderName, source) {
  const actions = document.createElement('div');
  actions.className = 'service-actions';
  const sourceTag = source === 'watched' ? ' <span style="opacity:0.6">(via pasta observada)</span>' : '';
  actions.innerHTML =
    `<div class="service-cwd" title="${escapeHtml(folder)}">📁 ${escapeHtml(folderName)}${sourceTag}</div>` +
    `<button class="service-btn" data-action="terminal" title="${escapeHtml(folder)}">▶ terminal aqui</button>` +
    `<button class="service-btn" data-action="folder"   title="${escapeHtml(folder)}">📂 abrir pasta</button>`;

  actions.querySelector('[data-action="terminal"]').addEventListener('click', (e) => {
    e.stopPropagation();
    openTerminalIn(folder, folderName);
    hideRadarPopover();
  });
  actions.querySelector('[data-action="folder"]').addEventListener('click', (e) => {
    e.stopPropagation();
    window.brauze.shell.openPath(folder);
  });
  return actions;
}

async function attachWatchedFolderMatches(svc, wrap) {
  let matches = [];
  try { matches = await window.brauze.watchedFolders.match(svc); }
  catch { return; }
  if (!matches.length) return;

  // Único match → trata como cwd direto.
  if (matches.length === 1) {
    wrap.appendChild(renderActionsRow(matches[0].path, matches[0].name, 'watched'));
    return;
  }

  // Múltiplos → toggle expandível.
  const matchesEl = document.createElement('div');
  matchesEl.className = 'service-matches';
  const toggle = document.createElement('button');
  toggle.className = 'service-matches-toggle';
  toggle.textContent = `🔍 ${matches.length} projetos possíveis nas pastas observadas ▾`;
  matchesEl.appendChild(toggle);

  const list = document.createElement('div');
  list.className = 'service-matches';
  list.style.display = 'none';
  list.style.padding = '0 10px 6px 48px';
  matches.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'service-match-item';
    item.title = m.path;
    item.innerHTML =
      `📁 <span>${escapeHtml(m.name)}</span>` +
      `<span class="check">▶ terminal · 📂</span>`;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      // Se clicou na parte do "📂" abre pasta; senão abre terminal.
      const isFolder = e.target.classList.contains('check');
      if (isFolder) window.brauze.shell.openPath(m.path);
      else { openTerminalIn(m.path, m.name); hideRadarPopover(); }
    });
    list.appendChild(item);
  });
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = list.style.display === 'none';
    list.style.display = open ? 'flex' : 'none';
    toggle.textContent = `🔍 ${matches.length} projetos possíveis nas pastas observadas ${open ? '▴' : '▾'}`;
  });

  wrap.appendChild(matchesEl);
  wrap.appendChild(list);
}

function renderRadarList(services) {
  if (!services.length) {
    radarList.innerHTML = '<div class="empty">Nenhum serviço detectado.<br>Inicie um servidor local pra aparecer aqui.</div>';
    return;
  }
  radarList.innerHTML = '';

  services.forEach((svc) => {
    const meta = `:${svc.port}${svc.meta ? ' · ' + escapeHtml(svc.meta) : ''}`;
    const wrap = document.createElement('div');
    wrap.className = 'service-wrap';

    const main = document.createElement('div');
    main.className = 'service';
    main.innerHTML =
      `<div class="service-icon">${escapeHtml(svc.icon || '·')}</div>` +
      `<div class="service-info">` +
        `<div class="service-name">${escapeHtml(svc.name)}</div>` +
        `<div class="service-meta">${meta}</div>` +
      `</div>`;
    main.addEventListener('click', () => {
      createTab(svc.url);
      hideRadarPopover();
    });
    wrap.appendChild(main);

    if (svc.cwd) {
      const folder = svc.cwd;
      const folderName = folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folder;
      const actions = renderActionsRow(folder, folderName, 'auto');
      if (svc.pid) actions.appendChild(renderKillButton(svc));
      wrap.appendChild(actions);
    } else {
      if (svc.pid) {
        const killRow = document.createElement('div');
        killRow.className = 'service-actions';
        killRow.appendChild(renderKillButton(svc));
        wrap.appendChild(killRow);
      }
      // sem cwd inferido — tenta watched folders async
      attachWatchedFolderMatches(svc, wrap);
    }

    radarList.appendChild(wrap);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showRadarPopover() {
  radarPopover.classList.remove('hidden');
  popoverBackdrop.classList.remove('hidden');
  renderRadarList(lastServices);
  lastServicesKey = servicesKey(lastServices);
}
function hideRadarPopover() {
  radarPopover.classList.add('hidden');
  popoverBackdrop.classList.add('hidden');
}
function toggleRadarPopover() {
  if (radarPopover.classList.contains('hidden')) showRadarPopover();
  else hideRadarPopover();
}

radarItem.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleRadarPopover();
});

radarRefresh.addEventListener('click', async (e) => {
  e.stopPropagation();
  radarDot.className = 'status-dot scanning';
  radarLabel.textContent = 'scanning…';
  const services = await window.brauze.radar.scanNow();
  lastServices = services;
  renderRadarStatus(services);
  renderRadarList(services);
});

popoverBackdrop.addEventListener('click', hideRadarPopover);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !radarPopover.classList.contains('hidden')) {
    hideRadarPopover();
  }
});

// Fingerprint pra evitar re-renderização quando nada mudou (preserva estado
// expandido de dropdowns "N projetos possíveis").
function servicesKey(services) {
  return services
    .map((s) => `${s.port}|${s.name}|${s.url}|${s.meta || ''}|${s.cwd || ''}|${s.pid || ''}`)
    .join('§');
}
let lastServicesKey = '';

if (window.brauze && window.brauze.radar) {
  window.brauze.radar.onUpdate((services) => {
    lastServices = services;
    renderRadarStatus(services);
    if (!radarPopover.classList.contains('hidden') && !settingsOpen) {
      const k = servicesKey(services);
      if (k !== lastServicesKey) {
        lastServicesKey = k;
        renderRadarList(services);
      }
    }
  });
}

// Menu de contexto pode pedir pra abrir nova aba (ex: "Abrir link em nova aba").
if (window.brauze && window.brauze.tabs) {
  window.brauze.tabs.onOpen((url) => createTab(url));
}

// ---- Terminal ----
const TERM_PANEL   = document.getElementById('terminal-panel');
const TERM_BODIES  = document.getElementById('terminal-bodies');
const TERM_TABS    = document.getElementById('term-tabs');
const TERM_NEW     = document.getElementById('term-new-tab');
const TERM_CHIPS   = document.getElementById('term-cli-chips');
const TERM_TOGGLE  = document.getElementById('term-toggle');
const TERM_CLOSE   = document.getElementById('term-close');
const TERM_HANDLE  = document.getElementById('terminal-resize-handle');
const DRAG_OVERLAY = document.getElementById('dragging-overlay');
const VARIANT_POP  = document.getElementById('cli-variant-popover');

const TERM_DEFAULT_H  = 280;
const TERM_MIN_H      = 80;   // abaixo disso = snap close
const TERM_MAX_BUFFER = 130;  // espaço mínimo pra chrome+toolbar+statusbar quando expandido

const terms = new Map(); // tabId → { ptyId, term, fit, container, tabEl }
let activeTabId = null;
let nextTabId   = 1;
let termOpen    = false;
let detectedClis = [];

function getStoredTermHeight() {
  const v = parseInt(localStorage.getItem('brauze.term.height') || '', 10);
  if (!v || isNaN(v) || v < TERM_MIN_H) return TERM_DEFAULT_H;
  return v;
}
function setStoredTermHeight(px) {
  localStorage.setItem('brauze.term.height', String(px));
}

function getDefaultVariantId(cliId, variants) {
  const stored = localStorage.getItem(`brauze.cli.${cliId}.default`);
  if (stored && variants.some((v) => v.id === stored)) return stored;
  return variants[0]?.id;
}
function setDefaultVariantId(cliId, variantId) {
  localStorage.setItem(`brauze.cli.${cliId}.default`, variantId);
}

function fitActive() {
  const t = terms.get(activeTabId);
  if (!t) return;
  try {
    t.fit.fit();
    if (t.ptyId != null) {
      window.brauze.terminal.resize(t.ptyId, t.term.cols, t.term.rows);
    }
  } catch {}
}

async function createTermTab(opts = {}) {
  const { cwd, label } = opts;
  const tabId = nextTabId++;
  const term = new Terminal({
    fontFamily: 'Consolas, "Cascadia Code", Menlo, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: {
      background: '#0d0d11',
      foreground: '#e6e6e6',
      cursor: '#5a8dff',
      selectionBackground: '#2d4a7a',
    },
    allowProposedApi: true,
    convertEol: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);

  const container = document.createElement('div');
  container.className = 'term-instance';
  container.dataset.tabId = tabId;
  TERM_BODIES.appendChild(container);
  term.open(container);

  const tabEl = document.createElement('div');
  tabEl.className = 'term-tab';
  tabEl.dataset.tabId = tabId;
  const tabLabel = label || `Terminal ${tabId}`;
  tabEl.innerHTML =
    `<span class="label" title="${escapeHtml(tabLabel)}">${escapeHtml(tabLabel)}</span>` +
    `<span class="close" title="Fechar aba">×</span>`;
  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('close')) {
      e.stopPropagation();
      closeTermTab(tabId);
    } else {
      activateTermTab(tabId);
    }
  });
  TERM_TABS.appendChild(tabEl);

  const entry = { ptyId: null, term, fit, container, tabEl };
  terms.set(tabId, entry);
  activateTermTab(tabId);

  // Garante layout antes de medir cols/rows
  await new Promise((r) => requestAnimationFrame(r));
  try { fit.fit(); } catch {}

  const { cols, rows } = term;
  const res = await window.brauze.terminal.create({ cols, rows, cwd });
  if (!res.ok) {
    term.write(`\x1b[31m[brauze] Falha: ${res.error}\x1b[0m\r\n`);
    return tabId;
  }
  entry.ptyId = res.id;

  term.onData((data) => window.brauze.terminal.write(entry.ptyId, data));
  term.onResize(({ cols, rows }) => {
    if (entry.ptyId != null) window.brauze.terminal.resize(entry.ptyId, cols, rows);
  });

  return tabId;
}

function activateTermTab(tabId) {
  if (activeTabId === tabId) return;
  activeTabId = tabId;
  for (const [id, t] of terms) {
    const isActive = id === tabId;
    t.container.classList.toggle('active', isActive);
    t.tabEl.classList.toggle('active', isActive);
    if (isActive) {
      requestAnimationFrame(() => {
        try { t.fit.fit(); } catch {}
        t.term.focus();
      });
    }
  }
}

function closeTermTab(tabId) {
  const entry = terms.get(tabId);
  if (!entry) return;
  if (entry.ptyId != null) window.brauze.terminal.kill(entry.ptyId);
  entry.term.dispose();
  entry.container.remove();
  entry.tabEl.remove();
  terms.delete(tabId);

  if (activeTabId === tabId) {
    activeTabId = null;
    const next = terms.keys().next().value;
    if (next !== undefined) activateTermTab(next);
    else hideTerminal(); // fechou a última, fecha o painel
  }
}

// Roteia data/exit do main pro xterm certo (1 listener global, por id).
window.brauze.terminal.onData(({ id, data }) => {
  for (const t of terms.values()) {
    if (t.ptyId === id) { t.term.write(data); break; }
  }
});
window.brauze.terminal.onExit(({ id, exitCode }) => {
  for (const [tabId, t] of terms) {
    if (t.ptyId === id) {
      t.term.write(`\r\n\x1b[33m[processo terminou: código ${exitCode}]\x1b[0m\r\n`);
      t.ptyId = null;
      break;
    }
  }
});

function openTerminalPanel() {
  if (termOpen) return false;
  termOpen = true;
  document.documentElement.style.setProperty('--term-h', getStoredTermHeight() + 'px');
  TERM_PANEL.classList.remove('hidden');
  return true; // primeira abertura
}

async function showTerminal() {
  const wasClosed = openTerminalPanel();
  if (wasClosed && terms.size === 0) {
    await createTermTab();
  } else {
    requestAnimationFrame(fitActive);
  }
}

async function openTerminalIn(cwd, label) {
  openTerminalPanel();
  return await createTermTab({ cwd, label });
}

// ---- Herd chip (.test → pasta do projeto) ----
function getActiveHost() {
  if (activeId == null) return null;
  const entry = tabs.get(activeId);
  if (!entry) return null;
  try { return new URL(safeGetUrl(entry.view)).hostname; }
  catch { return null; }
}

let herdChipEl = null;
async function updateHerdChip() {
  const host = getActiveHost();
  if (herdChipEl) { herdChipEl.remove(); herdChipEl = null; }
  if (!host || !host.endsWith('.test')) return;
  let resolved = null;
  try { resolved = await window.brauze.herd.resolve(host); } catch {}
  if (!resolved) return;
  if (getActiveHost() !== host) return; // mudou enquanto resolvia

  const chip = document.createElement('div');
  chip.className = 'cli-chip herd-chip';
  chip.title = `Abrir terminal em ${resolved.path}`;
  chip.innerHTML =
    `<div class="cli-chip-main no-split">` +
      `<span class="cli-chip-icon">📂</span>` +
      `<span>${escapeHtml(resolved.name)}<span class="herd-tag">Herd</span></span>` +
    `</div>`;
  chip.addEventListener('click', () => openTerminalIn(resolved.path, resolved.name));
  TERM_CHIPS.insertBefore(chip, TERM_CHIPS.firstChild);
  herdChipEl = chip;
}

function hideTerminal() {
  if (!termOpen) return;
  termOpen = false;
  document.documentElement.style.setProperty('--term-h', '0px');
  TERM_PANEL.classList.add('hidden');
}

function toggleTerminal() { termOpen ? hideTerminal() : showTerminal(); }

TERM_TOGGLE.addEventListener('click', toggleTerminal);
TERM_CLOSE.addEventListener('click', hideTerminal);
TERM_NEW.addEventListener('click', () => createTermTab());

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === '`') { e.preventDefault(); toggleTerminal(); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
    e.preventDefault();
    if (!termOpen) showTerminal().then(() => { /* nova aba já criada via showTerminal */ });
    else createTermTab();
  }
});
window.addEventListener('resize', () => { if (termOpen) fitActive(); });

// ---- Drag pra resize ----
let dragging = false;
let dragStartY = 0;
let dragStartH = 0;

TERM_HANDLE.addEventListener('mousedown', (e) => {
  if (!termOpen) return;
  e.preventDefault();
  dragging = true;
  dragStartY = e.clientY;
  dragStartH = TERM_PANEL.getBoundingClientRect().height;
  TERM_PANEL.classList.add('dragging');
  DRAG_OVERLAY.classList.remove('hidden');
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dy = e.clientY - dragStartY;
  let newH = dragStartH - dy;
  const maxH = window.innerHeight - TERM_MAX_BUFFER;
  if (newH > maxH) newH = maxH;
  if (newH < 30)   newH = 30;
  document.documentElement.style.setProperty('--term-h', newH + 'px');
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  TERM_PANEL.classList.remove('dragging');
  DRAG_OVERLAY.classList.add('hidden');

  const finalH = TERM_PANEL.getBoundingClientRect().height;
  if (finalH < TERM_MIN_H) {
    // Snap close — guarda última altura "boa" pra próxima abertura
    hideTerminal();
  } else {
    setStoredTermHeight(Math.round(finalH));
    fitActive();
  }
});

// ---- DevTools docked (lateral direita) ----
const DEVTOOLS_PANEL  = document.getElementById('devtools-panel');
const DEVTOOLS_HOST   = document.getElementById('devtools-host');
const DEVTOOLS_HANDLE = document.getElementById('devtools-resize-handle');
const DEVTOOLS_CLOSE  = document.getElementById('devtools-close');
const DEVTOOLS_DETACH = document.getElementById('devtools-detach');

const DEVTOOLS_DEFAULT_W = 480;
const DEVTOOLS_MIN_W     = 240;
const DEVTOOLS_MAX_BUFFER = 320;

let devtoolsOpen = false;
let devtoolsTargetId = null;

function getStoredDevToolsWidth() {
  const v = parseInt(localStorage.getItem('brauze.devtools.width') || '', 10);
  return Number.isFinite(v) && v >= DEVTOOLS_MIN_W ? v : DEVTOOLS_DEFAULT_W;
}
function setStoredDevToolsWidth(px) {
  localStorage.setItem('brauze.devtools.width', String(px));
}

function getActiveWebview() {
  if (activeId == null) return null;
  const entry = tabs.get(activeId);
  return entry ? entry.view : null;
}

function getDevToolsBounds() {
  const r = DEVTOOLS_HOST.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function pushDevToolsBounds() {
  if (!devtoolsOpen) return;
  window.brauze.devtools.setBounds(getDevToolsBounds());
}

async function openDevTools(opts = {}) {
  const view = getActiveWebview();
  if (!view) return;
  let targetId;
  try { targetId = view.getWebContentsId(); } catch { return; }

  const w = getStoredDevToolsWidth();
  document.documentElement.style.setProperty('--devtools-w', w + 'px');
  DEVTOOLS_PANEL.classList.remove('hidden');
  devtoolsOpen = true;

  // Aguarda o layout do painel se acomodar antes de medir bounds
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  devtoolsTargetId = targetId;
  const res = await window.brauze.devtools.open({
    targetId,
    bounds: getDevToolsBounds(),
    inspectAt: opts.inspectAt || null,
  });
  if (!res || !res.ok) {
    console.error('[devtools] open falhou:', res && res.error);
    closeDevTools();
  }
}

async function closeDevTools() {
  if (devtoolsOpen) {
    try { await window.brauze.devtools.close(); } catch {}
  }
  devtoolsTargetId = null;
  devtoolsOpen = false;
  DEVTOOLS_PANEL.classList.add('hidden');
  document.documentElement.style.setProperty('--devtools-w', '0px');
}

async function detachDevTools() {
  if (!devtoolsOpen) return;
  await window.brauze.devtools.detach();
  devtoolsTargetId = null;
  devtoolsOpen = false;
  DEVTOOLS_PANEL.classList.add('hidden');
  document.documentElement.style.setProperty('--devtools-w', '0px');
}

function toggleDevTools() {
  if (devtoolsOpen) closeDevTools();
  else openDevTools();
}

DEVTOOLS_CLOSE.addEventListener('click', closeDevTools);
DEVTOOLS_DETACH.addEventListener('click', detachDevTools);

let dragDt = false;
let dragDtStartX = 0;
let dragDtStartW = 0;

DEVTOOLS_HANDLE.addEventListener('mousedown', (e) => {
  if (!devtoolsOpen) return;
  e.preventDefault();
  dragDt = true;
  dragDtStartX = e.clientX;
  dragDtStartW = DEVTOOLS_PANEL.getBoundingClientRect().width;
  DEVTOOLS_PANEL.classList.add('dragging');
  DRAG_OVERLAY.classList.remove('hidden');
});

window.addEventListener('mousemove', (e) => {
  if (!dragDt) return;
  const dx = e.clientX - dragDtStartX;
  let newW = dragDtStartW - dx;
  const maxW = window.innerWidth - DEVTOOLS_MAX_BUFFER;
  if (newW > maxW) newW = maxW;
  if (newW < 30) newW = 30;
  document.documentElement.style.setProperty('--devtools-w', newW + 'px');
  pushDevToolsBounds();
});

window.addEventListener('mouseup', () => {
  if (!dragDt) return;
  dragDt = false;
  DEVTOOLS_PANEL.classList.remove('dragging');
  DRAG_OVERLAY.classList.add('hidden');
  const finalW = DEVTOOLS_PANEL.getBoundingClientRect().width;
  if (finalW < DEVTOOLS_MIN_W) closeDevTools();
  else { setStoredDevToolsWidth(Math.round(finalW)); pushDevToolsBounds(); }
});

window.addEventListener('resize', () => { if (devtoolsOpen) pushDevToolsBounds(); });
new ResizeObserver(() => { if (devtoolsOpen) pushDevToolsBounds(); }).observe(DEVTOOLS_HOST);

// ---- Quick switcher (Cmd+P) ----
const QS_ROOT     = document.getElementById('quick-switcher');
const QS_BACKDROP = document.getElementById('qs-backdrop');
const QS_INPUT    = document.getElementById('qs-input');
const QS_RESULTS  = document.getElementById('qs-results');

let qsOpen = false;
let qsItems = [];
let qsIdx = 0;
let qsSeq = 0;

function fuzzyScore(text, q) {
  text = text.toLowerCase(); q = q.toLowerCase();
  if (text.includes(q)) return 100 - text.indexOf(q);
  // letters in order
  let ti = 0; let hits = 0;
  for (const ch of q) {
    const idx = text.indexOf(ch, ti);
    if (idx === -1) return 0;
    ti = idx + 1;
    hits++;
  }
  return 30 - q.length;
}

async function qsCompute() {
  const seq = ++qsSeq;
  const q = QS_INPUT.value.trim();
  const tabsList = [];
  for (const [id, entry] of tabs) {
    if (id === activeId) continue;
    const url = safeGetUrl(entry.view);
    const title = entry.tabEl.querySelector('.title')?.textContent || '';
    tabsList.push({ kind: 'tab', tabId: id, url, title });
  }

  let history = [];
  try { history = await window.brauze.omnibox.recentHistory(50); } catch {}
  if (seq !== qsSeq) return;
  const histItems = history.map((h) => ({
    kind: 'history',
    url: h.url,
    title: h.title || h.url,
  }));

  let merged = [...tabsList, ...histItems];
  if (q) {
    merged = merged
      .map((it) => ({ ...it, _score: Math.max(fuzzyScore(it.title || '', q), fuzzyScore(it.url || '', q)) }))
      .filter((it) => it._score > 0)
      .sort((a, b) => b._score - a._score);
  }
  // Dedup por URL
  const seen = new Set();
  const out = [];
  for (const it of merged) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
    if (out.length >= 20) break;
  }
  qsItems = out;
  qsIdx = out.length ? 0 : -1;
  renderQs();
}

function renderQs() {
  QS_RESULTS.innerHTML = '';
  if (!qsItems.length) {
    QS_RESULTS.innerHTML = '<div class="qs-empty">Sem resultados.</div>';
    return;
  }
  qsItems.forEach((it, i) => {
    const el = document.createElement('div');
    el.className = 'qs-item' + (i === qsIdx ? ' selected' : '');
    let host = '';
    try { host = new URL(it.url).hostname; } catch {}
    const fav = host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32` : '';
    el.innerHTML =
      `<span class="qs-icon">${fav ? `<img class="qs-favicon" src="${escapeHtml(fav)}">` : '🌐'}</span>` +
      `<span class="qs-text">${escapeHtml(it.title || it.url)}<span class="qs-secondary">${escapeHtml(host)}</span></span>` +
      (it.kind === 'tab' ? `<span class="qs-pill">aba</span>` : '');
    el.addEventListener('mousedown', (e) => { e.preventDefault(); qsActivate(it); });
    el.addEventListener('mouseenter', () => {
      qsIdx = i;
      Array.from(QS_RESULTS.children).forEach((c, j) => c.classList.toggle('selected', j === qsIdx));
    });
    QS_RESULTS.appendChild(el);
  });
}

function qsActivate(it) {
  closeQs();
  if (!it) return;
  if (it.kind === 'tab' && it.tabId != null) { activateTab(it.tabId); return; }
  const view = tabs.get(activeId)?.view;
  if (view && it.url) view.loadURL(it.url);
}

function openQs() {
  if (qsOpen) return;
  qsOpen = true;
  QS_ROOT.classList.remove('hidden');
  QS_INPUT.value = '';
  qsItems = []; qsIdx = -1;
  qsCompute();
  setTimeout(() => QS_INPUT.focus(), 0);
}
function closeQs() {
  if (!qsOpen) return;
  qsOpen = false;
  QS_ROOT.classList.add('hidden');
}

QS_INPUT.addEventListener('input', qsCompute);
QS_INPUT.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeQs(); return; }
  if (e.key === 'Enter')  { e.preventDefault(); if (qsIdx >= 0) qsActivate(qsItems[qsIdx]); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); qsIdx = (qsIdx + 1) % Math.max(1, qsItems.length); renderQs(); return; }
  if (e.key === 'ArrowUp')   { e.preventDefault(); qsIdx = (qsIdx - 1 + qsItems.length) % Math.max(1, qsItems.length); renderQs(); return; }
});
QS_BACKDROP.addEventListener('click', closeQs);

// Cmd+P: roteado via shortcuts.onFire

// ---- Find on page ----
const FIND_BAR     = document.getElementById('find-bar');
const FIND_INPUT   = document.getElementById('find-input');
const FIND_COUNTER = document.getElementById('find-counter');
const FIND_PREV    = document.getElementById('find-prev');
const FIND_NEXT    = document.getElementById('find-next');
const FIND_CLOSE   = document.getElementById('find-close');

let findOpen = false;
let findRequestId = 0;

function findInActiveView(text, opts = {}) {
  const view = getActiveWebview();
  if (!view) return;
  if (!text) {
    try { view.stopFindInPage('clearSelection'); } catch {}
    FIND_COUNTER.textContent = '0/0';
    return;
  }
  try { view.findInPage(text, opts); }
  catch (err) { console.warn('[find]', err.message); }
}

function openFind() {
  if (findOpen) { FIND_INPUT.focus(); FIND_INPUT.select(); return; }
  findOpen = true;
  FIND_BAR.classList.remove('hidden');
  FIND_INPUT.value = '';
  FIND_COUNTER.textContent = '0/0';
  FIND_INPUT.focus();
}
function closeFind() {
  if (!findOpen) return;
  findOpen = false;
  FIND_BAR.classList.add('hidden');
  const view = getActiveWebview();
  if (view) { try { view.stopFindInPage('clearSelection'); } catch {} }
}

FIND_INPUT.addEventListener('input', () => {
  findInActiveView(FIND_INPUT.value, { findNext: false });
});
FIND_INPUT.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  if (e.key === 'Enter') {
    e.preventDefault();
    findInActiveView(FIND_INPUT.value, { forward: !e.shiftKey, findNext: true });
  }
});
FIND_PREV.addEventListener('click',  () => findInActiveView(FIND_INPUT.value, { forward: false, findNext: true }));
FIND_NEXT.addEventListener('click',  () => findInActiveView(FIND_INPUT.value, { forward: true,  findNext: true }));
FIND_CLOSE.addEventListener('click', closeFind);

// Cmd+F: roteado via shortcuts.onFire

window.brauze.window.onFullscreen((isFs) => {
  document.body.classList.toggle('fullscreen', !!isFs);
});

window.brauze.devtools.onToggleRequest(() => toggleDevTools());

window.brauze.shortcuts.onFire((action) => {
  switch (action) {
    case 'devtools:toggle': toggleDevTools(); break;
    case 'qs:open':         openQs(); break;
    case 'find:open':       openFind(); break;
    case 'tab:new':         createTab(); break;
    case 'tab:close':       if (activeId !== null) closeTab(activeId); break;
    case 'tab:reopen': {
      const url = closedStack.pop();
      if (url) createTab(url);
      break;
    }
    case 'address:focus':   addressEl.focus(); break;
    case 'tab:reload':      tabs.get(activeId)?.view.reload(); break;
  }
});

window.brauze.devtools.onReattached(() => {
  devtoolsOpen = true;
  const w = getStoredDevToolsWidth();
  document.documentElement.style.setProperty('--devtools-w', w + 'px');
  DEVTOOLS_PANEL.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => pushDevToolsBounds()));
});

window.brauze.devtools.onInspect(({ targetId, x, y }) => {
  const view = getActiveWebview();
  if (!view) return;
  let activeWcId;
  try { activeWcId = view.getWebContentsId(); } catch { return; }
  if (activeWcId !== targetId) return; // trocou de aba antes de chegar
  openDevTools({ inspectAt: { x, y } });
});

// ---- CLI chips ----
function runCliCommand(command) {
  const start = async () => {
    if (!termOpen) await showTerminal();
    const wait = (n) => new Promise((r) => setTimeout(r, n));
    let attempts = 0;
    while (attempts++ < 30) {
      const t = terms.get(activeTabId);
      if (t && t.ptyId != null) {
        window.brauze.terminal.write(t.ptyId, command + '\r');
        t.term.focus();
        return;
      }
      await wait(50);
    }
  };
  start();
}

function renderCliChips() {
  TERM_CHIPS.innerHTML = '';
  if (!detectedClis.length) {
    TERM_CHIPS.innerHTML = '<span style="color:#666;font-size:11px;padding:0 6px;">Nenhuma CLI de IA detectada no PATH</span>';
    return;
  }
  detectedClis.forEach((cli) => {
    const variants = cli.variants || [{ id: 'default', label: 'Padrão', command: cli.bin }];
    const defId    = getDefaultVariantId(cli.id, variants);
    const defVar   = variants.find((v) => v.id === defId) || variants[0];
    const hasMulti = variants.length > 1;

    const chip = document.createElement('div');
    chip.className = 'cli-chip';

    const main = document.createElement('div');
    main.className = 'cli-chip-main' + (hasMulti ? '' : ' no-split');
    main.title = `Lançar: ${defVar.command}`;
    main.innerHTML = `<span class="cli-chip-icon">${escapeHtml(cli.icon)}</span><span>${escapeHtml(cli.label)}</span>`;
    main.addEventListener('click', () => runCliCommand(defVar.command));
    chip.appendChild(main);

    if (hasMulti) {
      const arrow = document.createElement('div');
      arrow.className = 'cli-chip-arrow';
      arrow.textContent = '▾';
      arrow.title = 'Variantes';
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        openVariantPopover(cli, arrow);
      });
      chip.appendChild(arrow);
    }

    TERM_CHIPS.appendChild(chip);
  });
}

function openVariantPopover(cli, anchor) {
  const variants = cli.variants;
  const defId = getDefaultVariantId(cli.id, variants);

  VARIANT_POP.innerHTML =
    `<div class="popover-header"><span>${escapeHtml(cli.label)}</span></div>` +
    `<div class="popover-body" id="variant-body"></div>`;

  const body = VARIANT_POP.querySelector('#variant-body');
  variants.forEach((v) => {
    const isDefault = v.id === defId;
    const row = document.createElement('div');
    row.className = 'variant-row';
    row.innerHTML =
      `<span class="check">${isDefault ? '✓' : ''}</span>` +
      `<div class="grow">` +
        `<div>${escapeHtml(v.label)}</div>` +
        `<div style="font-size:10px;color:#888;font-family:monospace;">${escapeHtml(v.command)}</div>` +
      `</div>` +
      (isDefault ? '' : `<button class="set-default">tornar padrão</button>`);
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('set-default')) {
        setDefaultVariantId(cli.id, v.id);
        renderCliChips();
        closeVariantPopover();
        return;
      }
      runCliCommand(v.command);
      closeVariantPopover();
    });
    body.appendChild(row);
  });

  // Posiciona o popover acima do anchor
  const rect = anchor.getBoundingClientRect();
  VARIANT_POP.classList.remove('hidden');
  popoverBackdrop.classList.remove('hidden');
  // Mede e posiciona
  const popH = VARIANT_POP.offsetHeight;
  VARIANT_POP.style.left   = `${Math.min(rect.left, window.innerWidth - 270)}px`;
  VARIANT_POP.style.top    = `${rect.top - popH - 4}px`;
  VARIANT_POP.style.bottom = 'auto';
}

function closeVariantPopover() {
  VARIANT_POP.classList.add('hidden');
  if (radarPopover.classList.contains('hidden')) {
    popoverBackdrop.classList.add('hidden');
  }
}

popoverBackdrop.addEventListener('click', () => {
  hideRadarPopover();
  closeVariantPopover();
});

// ---- Settings (watched folders) ----
let settingsOpen = false;

async function renderSettingsView() {
  const folders = await window.brauze.watchedFolders.list();
  radarSettingsView.innerHTML = '';
  if (!folders.length) {
    const empty = document.createElement('div');
    empty.className = 'wf-empty';
    empty.innerHTML =
      'Nenhuma pasta observada ainda.<br>' +
      'Adicione uma pasta com seus projetos pra que o radar consiga<br>' +
      'identificar serviços de origem opaca (Git Bash, WSL, etc).';
    radarSettingsView.appendChild(empty);
  } else {
    folders.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'wf-row';
      row.innerHTML =
        `<span>📁</span>` +
        `<div class="wf-path" title="${escapeHtml(p)}">${escapeHtml(p)}</div>` +
        `<button class="wf-remove" title="Remover">×</button>`;
      row.querySelector('.wf-remove').addEventListener('click', async () => {
        await window.brauze.watchedFolders.remove(p);
        renderSettingsView();
      });
      radarSettingsView.appendChild(row);
    });
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'wf-add-btn';
  addBtn.textContent = '+ adicionar pasta';
  addBtn.addEventListener('click', async () => {
    const added = await window.brauze.watchedFolders.add();
    if (added) renderSettingsView();
  });
  radarSettingsView.appendChild(addBtn);
}

function showSettingsView() {
  settingsOpen = true;
  radarTitle.textContent = 'Pastas observadas';
  radarList.classList.add('hidden');
  radarSettingsView.classList.remove('hidden');
  radarSettingsBtn.textContent = '×';
  radarSettingsBtn.title = 'Voltar';
  radarFooter.textContent = 'Brauze varre 1 nível dentro de cada pasta procurando projetos';
  renderSettingsView();
}
function hideSettingsView() {
  settingsOpen = false;
  radarTitle.textContent = 'Serviços locais';
  radarList.classList.remove('hidden');
  radarSettingsView.classList.add('hidden');
  radarSettingsBtn.textContent = '⚙';
  radarSettingsBtn.title = 'Pastas observadas';
  radarFooter.textContent = 'Scan a cada 5s · portas comuns de dev';
  // Re-renderiza no caso de pastas terem sido adicionadas/removidas durante settings.
  renderRadarList(lastServices);
  lastServicesKey = servicesKey(lastServices);
}
radarSettingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (settingsOpen) hideSettingsView();
  else showSettingsView();
});

// Quando o popover fecha, volta pra view de serviços.
const _origHideRadar = hideRadarPopover;
hideRadarPopover = function () {
  if (settingsOpen) hideSettingsView();
  _origHideRadar();
};

// Detecta CLIs no boot (uma vez)
if (window.brauze && window.brauze.cli) {
  window.brauze.cli.detect().then((list) => {
    detectedClis = list;
    renderCliChips();
  });
}

// ---- Modo prompt (IA) ----
const addressWrap   = document.getElementById('address-wrap');
const modeToggle    = document.getElementById('mode-toggle');
const drawer        = document.getElementById('prompt-drawer');
const drawerQuestion = document.getElementById('prompt-drawer-question');
const drawerBody    = document.getElementById('prompt-drawer-body');
const drawerClose   = document.getElementById('prompt-drawer-close');
const drawerStatus  = document.getElementById('prompt-drawer-status');

let mode = 'web'; // 'web' | 'prompt'
let asking = false;

function setMode(next) {
  if (mode === next) return;
  mode = next;
  if (mode === 'prompt') {
    addressWrap.classList.add('prompt-mode');
    modeToggle.textContent = '✦';
    addressEl.placeholder = 'Pergunte sobre essa página…';
    addressEl.value = '';
    addressEl.focus();
  } else {
    addressWrap.classList.remove('prompt-mode');
    modeToggle.textContent = '🌐';
    addressEl.placeholder = 'Pesquise ou digite uma URL';
    addressEl.value = activeId !== null ? safeGetUrl(tabs.get(activeId).view) : '';
  }
}
function toggleMode() { setMode(mode === 'web' ? 'prompt' : 'web'); }

modeToggle.addEventListener('click', (e) => { e.preventDefault(); toggleMode(); });
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === '/') { e.preventDefault(); toggleMode(); }
  if (e.key === 'Escape' && !drawer.classList.contains('hidden')) closeDrawer();
});

drawerClose.addEventListener('click', closeDrawer);
function closeDrawer() { drawer.classList.add('hidden'); }
function openDrawer() { drawer.classList.remove('hidden'); }

// Captura contexto rico da aba ativa: meta, fontes, computed styles, breakpoints, frameworks, texto.
async function captureActivePageContext() {
  if (activeId === null) return { pageText: '' };
  const view = tabs.get(activeId).view;
  try {
    return await view.executeJavaScript(`(() => {
      const cs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : null; };
      const props = (sel, list) => {
        const c = cs(sel); if (!c) return null;
        const o = {}; for (const p of list) o[p] = c.getPropertyValue(p).trim(); return o;
      };
      const FONT_PROPS = ['font-family','font-size','font-weight','line-height','color'];

      // FontFaceSet
      const fontsLoaded = [];
      try {
        for (const f of document.fonts) {
          fontsLoaded.push((f.family || '').replace(/^"|"$/g,'') + ' ' + f.weight + ' ' + (f.style || ''));
        }
      } catch {}

      // Computed styles em elementos-chave
      const computed = {};
      ['body','h1','h2','h3','p','a','button','code','input'].forEach((sel) => {
        const v = props(sel, FONT_PROPS);
        if (v) computed[sel] = v;
      });
      const bodyBg = (cs('body') || {}).backgroundColor || '';
      const colors = {
        background: bodyBg,
        text: (cs('body') || {}).color || '',
        scheme: getComputedStyle(document.documentElement).colorScheme || 'normal',
      };

      // Meta tags
      const meta = {};
      document.querySelectorAll('meta[name],meta[property]').forEach((m) => {
        const k = m.getAttribute('name') || m.getAttribute('property');
        if (!k) return;
        meta[k] = (m.getAttribute('content') || '').slice(0, 200);
      });

      // Stylesheets
      const stylesheets = Array.from(document.styleSheets).map((s) => s.href).filter(Boolean);

      // Breakpoints (só de stylesheets same-origin acessíveis)
      const breakpoints = new Set();
      try {
        for (const sheet of document.styleSheets) {
          let rules; try { rules = sheet.cssRules; } catch { continue; }
          if (!rules) continue;
          for (const r of rules) {
            if (r.media && r.conditionText) breakpoints.add(r.conditionText);
          }
        }
      } catch {}

      // Frameworks
      const frameworks = [];
      if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot],#__next,#root [data-react]')) frameworks.push('React');
      if (window.__NEXT_DATA__) frameworks.push('Next.js');
      if (window.__NUXT__)      frameworks.push('Nuxt');
      if (window.Vue || document.querySelector('[data-v-app]')) frameworks.push('Vue');
      if (window.ng || window.angular || document.querySelector('[ng-version]')) frameworks.push('Angular');
      if (window.Astro || document.querySelector('astro-island')) frameworks.push('Astro');
      if (window.Alpine) frameworks.push('Alpine');
      if (window.htmx) frameworks.push('htmx');
      if (window.Livewire) frameworks.push('Livewire');

      // Texto principal
      const main = document.querySelector('main, article, [role=main]') || document.body;
      const clone = main.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, nav, header, footer, aside, iframe').forEach((n) => n.remove());
      const pageText = (clone.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 8000);

      return {
        url: location.href,
        title: document.title,
        lang: document.documentElement.lang || null,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        fontsLoaded,
        computed,
        colors,
        meta,
        stylesheets,
        breakpoints: Array.from(breakpoints),
        frameworks,
        pageText,
      };
    })()`);
  } catch (err) {
    return { pageText: '', error: String(err.message || err) };
  }
}

// MCP: o main process delega execução de JS no webview ativo pra cá.
if (window.brauze && window.brauze.mcp) {
  window.brauze.mcp.onExec(async ({ id, jsCode }) => {
    try {
      if (activeId === null) {
        return window.brauze.mcp.respond(id, false, null, 'sem aba ativa');
      }
      const view = tabs.get(activeId).view;
      const value = await view.executeJavaScript(jsCode);
      window.brauze.mcp.respond(id, true, value, null);
    } catch (err) {
      window.brauze.mcp.respond(id, false, null, String(err.message || err));
    }
  });
}

async function submitPrompt(question) {
  question = (question || '').trim();
  if (!question || asking) return;
  asking = true;

  drawerQuestion.textContent = question;
  drawerBody.innerHTML = '<div class="loader">Claude pensando…</div>';
  drawerStatus.textContent = 'capturando contexto…';
  openDrawer();

  const ctx = await captureActivePageContext();
  drawerStatus.textContent = `consultando claude · ${(ctx.pageText || '').length} chars + meta`;

  const t0 = Date.now();
  const res = await window.brauze.prompt.ask({ question, context: ctx });
  const dt  = ((Date.now() - t0) / 1000).toFixed(1);

  if (res.ok) {
    drawerBody.innerHTML = window.marked.parse(res.response || '(resposta vazia)');
    drawerStatus.textContent = `respondido em ${dt}s`;
  } else {
    drawerBody.innerHTML = `<div class="error"><b>Erro:</b><br>${escapeHtml(res.error)}</div>`;
    drawerStatus.textContent = `falhou em ${dt}s`;
  }
  asking = false;
}

// ---- Privacy: monkey-patches injetados em cada page ----
const FP_PATCHES_JS = `(function(){
  if (window.__brauzeFP) return; window.__brauzeFP = true;
  function notify(type, tool){ try{ window.postMessage({__brauzeFP:true,type,tool},'*'); }catch(e){} }
  try {
    const orig = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(){ notify('canvas'); return orig.apply(this, arguments); };
  } catch(e){}
  try {
    [WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean).forEach(function(Ctx){
      const o = Ctx.prototype.getParameter;
      Ctx.prototype.getParameter = function(p){
        if (p === 37445 || p === 37446) notify('webgl');
        return o.call(this, p);
      };
    });
  } catch(e){}
  try {
    if (window.AudioContext) {
      const o = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function(){ notify('audio'); return o.call(this); };
    }
  } catch(e){}
  try {
    const d = Object.getOwnPropertyDescriptor(Navigator.prototype,'plugins');
    if (d && d.get) Object.defineProperty(Navigator.prototype,'plugins',{
      get(){ notify('plugins'); return d.get.call(this); }, configurable:true
    });
  } catch(e){}
  try {
    if (document.fonts && document.fonts.check) {
      const o = document.fonts.check.bind(document.fonts);
      document.fonts.check = function(){ notify('fonts'); return o.apply(null, arguments); };
    }
  } catch(e){}
})();`;

const COOKIE_BANNERS_CSS = `
#onetrust-banner-sdk,#onetrust-consent-sdk,.ot-sdk-container,
.optanon-alert-box-wrapper,.optanon-alert-box-bg,
#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,
#truste-consent-track,.truste_box_overlay,#consent_blackbar,
#qcCmpUi,.qc-cmp-ui-container,.qc-cmp2-container,
#didomi-host,#didomi-popup,.didomi-popup-container,
#cookie-law-info-bar,#cookieChoiceInfo,#cookieconsent,
.cc-window,.cc-banner,.cc-revoke,
#cookieBanner,.cookieBanner,#cookie-banner,.cookie-banner,
#cookieNotice,.cookieNotice,#cookie-notice,.cookie-notice,
#cookieConsent,.cookieConsent,#cookie-consent,.cookie-consent,
.gdpr-banner,.gdpr-modal,.gdpr-overlay,
[class*="CookieBanner" i],[id*="CookieBanner" i],
[class*="cookie-consent" i],[id*="cookie-consent" i],
[class*="cookie-notice" i],[id*="cookie-notice" i],
[class*="gdpr-consent" i],[id*="gdpr-consent" i],
[aria-label*="cookie" i][role="dialog"],
[aria-label*="consent" i][role="dialog"],
[aria-modal="true"][class*="cookie" i],
[aria-modal="true"][class*="consent" i] {
  display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;
}
html.optanon-alert-box-open,body.optanon-alert-box-open,
html.cookies-not-accepted,body.cookies-not-accepted,
html.gdpr-active,body.gdpr-active,html.modal-open,body.modal-open {
  overflow:auto!important;position:static!important;
}`;

// ---- Shield + Privacy popover ----
const SHIELD = document.getElementById('shield');
const PP_POPOVER = document.getElementById('privacy-popover');
const PP_BODY    = document.getElementById('pp-body');
const PP_CLOSE   = PP_POPOVER.querySelector('.pp-close');
let ppTimer = null;

function ppValueClass(n) { return n === 0 ? 'zero' : 'good'; }

function renderPrivacy(s) {
  let html = '';
  html += `<div class="pp-row"><span class="pp-icon">🛡️</span><span class="pp-label">Trackers bloqueados</span><span class="pp-value ${ppValueClass(s.trackersBlocked)}">${s.trackersBlocked}</span></div>`;
  html += `<div class="pp-row"><span class="pp-icon">🍪</span><span class="pp-label">3P cookies bloqueados</span><span class="pp-value ${ppValueClass(s.thirdPartyCookiesBlocked)}">${s.thirdPartyCookiesBlocked}</span></div>`;
  html += `<div class="pp-row"><span class="pp-icon">🌐</span><span class="pp-label">Domínios 3P</span><span class="pp-value">${s.thirdPartyHosts.length}</span></div>`;

  const fpTotal = Object.values(s.fingerprintAttempts).reduce((a, b) => a + b, 0);
  html += `<div class="pp-row"><span class="pp-icon">🎯</span><span class="pp-label">Fingerprint attempts</span><span class="pp-value ${fpTotal ? 'bad' : 'zero'}">${fpTotal}</span></div>`;

  const permEntries = Object.entries(s.permissionsRequested);
  if (permEntries.length) {
    html += `<div class="pp-section-title">Permissions pedidas</div><div class="pp-list">`;
    for (const [p, v] of permEntries) {
      html += `<div class="pp-item">${escapeHtml(p)}: <span style="color:${v === 'granted' ? '#4ade80' : '#ff7373'}">${v}</span></div>`;
    }
    html += `</div>`;
  }

  if (s.sessionReplayTools.length) {
    html += `<div class="pp-section-title">Session replay / Analytics</div><div class="pp-list">`;
    for (const t of s.sessionReplayTools) html += `<div class="pp-item">📹 ${escapeHtml(t)}</div>`;
    html += `</div>`;
  }

  if (s.thirdPartyHosts.length) {
    html += `<div class="pp-section-title">Domínios 3P contactados</div><div class="pp-list">`;
    for (const h of s.thirdPartyHosts.slice(0, 30)) html += `<div class="pp-item">${escapeHtml(h)}</div>`;
    if (s.thirdPartyHosts.length > 30) html += `<div class="pp-item">...e mais ${s.thirdPartyHosts.length - 30}</div>`;
    html += `</div>`;
  }

  let origin = '';
  try { origin = new URL(s.url).hostname; } catch {}
  html += `<div class="pp-actions">`;
  if (origin) html += `<button data-act="clear-cookies">Limpar cookies de ${escapeHtml(origin)}</button>`;
  html += `</div>`;

  PP_BODY.innerHTML = html;

  PP_BODY.querySelectorAll('[data-act="clear-cookies"]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!origin) return;
      const url = 'https://' + origin;
      const n = await window.brauze.cookies.clearOrigin(url);
      b.textContent = `✓ ${n} cookies removidos`;
    });
  });
}

async function refreshPrivacy() {
  if (PP_POPOVER.classList.contains('hidden')) return;
  const view = getActiveWebview();
  if (!view) return;
  let wcId; try { wcId = view.getWebContentsId(); } catch { return; }
  const stats = await window.brauze.privacy.getStats(wcId);
  if (stats) renderPrivacy(stats);
}

function positionPrivacyPopover() {
  const r = SHIELD.getBoundingClientRect();
  PP_POPOVER.style.left = Math.min(r.left, window.innerWidth - 380) + 'px';
}

function togglePrivacy() {
  if (PP_POPOVER.classList.contains('hidden')) {
    positionPrivacyPopover();
    PP_POPOVER.classList.remove('hidden');
    refreshPrivacy();
    ppTimer = setInterval(refreshPrivacy, 1500);
  } else {
    PP_POPOVER.classList.add('hidden');
    if (ppTimer) { clearInterval(ppTimer); ppTimer = null; }
  }
}

SHIELD.addEventListener('click', togglePrivacy);
PP_CLOSE.addEventListener('click', togglePrivacy);
window.addEventListener('resize', () => { if (!PP_POPOVER.classList.contains('hidden')) positionPrivacyPopover(); });

// Boot
createTab();
