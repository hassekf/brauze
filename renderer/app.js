const tabsEl     = document.getElementById('tabs');
const viewsEl    = document.getElementById('views');
const addressEl  = document.getElementById('address');
const backBtn    = document.getElementById('back');
const forwardBtn = document.getElementById('forward');
const reloadBtn  = document.getElementById('reload');
const newtabBtn  = document.getElementById('newtab');

const HOMEPAGE = 'https://www.google.com';

const tabs = new Map();
let activeId = null;
let nextId = 1;

function normalizeUrl(input) {
  const raw = input.trim();
  if (!raw) return HOMEPAGE;
  if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith('about:')) return raw;
  // Heurística simples: tem ponto e nada de espaço → URL; senão, busca no Google.
  if (/^[^\s]+\.[^\s]+$/.test(raw)) return 'https://' + raw;
  return 'https://www.google.com/search?q=' + encodeURIComponent(raw);
}

function createTab(url = HOMEPAGE) {
  const id = nextId++;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.id = id;
  tabEl.innerHTML =
    `<span class="title">Nova aba</span>` +
    `<span class="close" title="Fechar">×</span>`;
  tabsEl.appendChild(tabEl);

  const view = document.createElement('webview');
  view.dataset.id = id;
  view.setAttribute('src', url);
  view.setAttribute('allowpopups', '');
  view.setAttribute('partition', 'persist:brauze'); // session compartilhada (cookies + adblock)
  viewsEl.appendChild(view);

  view.addEventListener('page-title-updated', (e) => {
    tabEl.querySelector('.title').textContent = e.title || 'Sem título';
  });
  view.addEventListener('did-navigate', (e) => {
    if (id === activeId) {
      if (mode === 'prompt') setMode('web'); // navegação real → sai do modo IA
      else addressEl.value = e.url;
    }
    updateNav();
  });
  view.addEventListener('did-navigate-in-page', (e) => {
    if (id === activeId) {
      if (mode === 'prompt') setMode('web');
      else addressEl.value = e.url;
    }
    updateNav();
  });
  view.addEventListener('did-start-loading', () => updateNav());
  view.addEventListener('did-stop-loading',  () => updateNav());

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('close')) {
      closeTab(id);
    } else {
      activateTab(id);
    }
  });

  tabs.set(id, { tabEl, view });
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
  for (const [tid, { tabEl, view }] of tabs) {
    const isActive = tid === id;
    tabEl.classList.toggle('active', isActive);
    view.classList.toggle('active', isActive);
  }
  activeId = id;

  const { view } = tabs.get(id);
  addressEl.value = safeGetUrl(view);
  updateNav();
}

function closeTab(id) {
  const entry = tabs.get(id);
  if (!entry) return;
  entry.tabEl.remove();
  entry.view.remove();
  tabs.delete(id);

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

addressEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
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
});
addressEl.addEventListener('blur', () => addressWrap.classList.remove('focused'));

// Atalhos
window.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 't') { e.preventDefault(); createTab(); }
  if (ctrl && e.key.toLowerCase() === 'w') { e.preventDefault(); if (activeId !== null) closeTab(activeId); }
  if (ctrl && e.key.toLowerCase() === 'l') { e.preventDefault(); addressEl.focus(); }
  if (ctrl && e.key.toLowerCase() === 'r') { e.preventDefault(); tabs.get(activeId)?.view.reload(); }
});

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
      wrap.appendChild(renderActionsRow(folder, folderName, 'auto'));
    } else {
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

// Boot
createTab();
