const { app, BrowserWindow, BrowserView, Menu, ipcMain, shell, dialog, session, webContents, protocol } = require('electron');
const path = require('path');
const fs   = require('fs');
const { scan } = require('./radar');
const contextMenu = require('./context-menu');
const cliDetect   = require('./cli-detect');
const terminal    = require('./terminal');
const watchedFolders = require('./watched-folders');
const promptIA = require('./prompt');
const mcpServer = require('./mcp-server');
const adblock     = require('./adblock');
const herd        = require('./herd');
const history     = require('./history');
const omnibox     = require('./omnibox');
const permissions = require('./permissions');
const cookies     = require('./cookies');
const privacy     = require('./privacy');
const profiles    = require('./profiles');
const passwords   = require('./passwords');
const breach      = require('./breach');

// Mata o flash branco que o Chromium pinta antes do HTML carregar.
app.commandLine.appendSwitch('default-background-color', '1b1b1f');

// Auto-trust certs de localhost/.test/.local (Herd, Valet, mkcert, dev servers).
const TRUSTED_LOCAL_HOSTS = /(^|\.)(test|local|localhost)$|^localhost(:\d+)?$|^127\./i;
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  try {
    const host = new URL(url).hostname;
    if (TRUSTED_LOCAL_HOSTS.test(host)) {
      event.preventDefault();
      callback(true);
      return;
    }
  } catch {}
  callback(false);
});
// Bloqueia autoplay de áudio/vídeo até gesto do usuário.
app.commandLine.appendSwitch('autoplay-policy', 'user-gesture-required');

// Protocolo brauze://<page> serve HTML estático de renderer/internal/<page>.html
protocol.registerSchemesAsPrivileged([
  { scheme: 'brauze', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const SCAN_INTERVAL_MS = 5000;
const DEV = !app.isPackaged;
const LOG_FILE = path.join(__dirname, 'brauze.log');

function log(...args) {
  const line = '[' + new Date().toISOString() + '] ' + args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ');
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

let mainWindow = null;
let scanTimer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#1b1b1f',
    title: 'Brauze',
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
    },
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen', false);
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Só dispara o primeiro scan quando o renderer já registrou os listeners.
  mainWindow.webContents.once('did-finish-load', () => {
    runScanAndBroadcast();
    scanTimer = setInterval(runScanAndBroadcast, SCAN_INTERVAL_MS);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  });
}

async function runScanAndBroadcast() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const services = await scan();
    console.log(`[radar] scan → ${services.length} serviço(s) detectado(s)`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('radar:update', services);
    }
  } catch (err) {
    console.error('[radar] scan error', err);
  }
}

app.whenReady().then(() => {
  // Sem menu padrão — atalhos como Cmd+Opt+I ficam pra a gente lidar no renderer.
  Menu.setApplicationMenu(null);

  const brauzeProtocolHandler = async (req) => {
    const u = new URL(req.url);
    const page = (u.hostname || 'newtab').replace(/[^a-z0-9-]/gi, '');
    const filePath = path.join(__dirname, 'renderer', 'internal', `${page}.html`);
    try {
      const body = fs.readFileSync(filePath);
      return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  };
  protocol.handle('brauze', brauzeProtocolHandler);

  // Profile system: tudo daqui pra baixo usa o profile ativo
  profiles.init(app.getPath('userData'));
  const activeProfile = profiles.getActive();
  const profilePath   = profiles.getProfilePath(activeProfile.id);
  const sessionPart   = profiles.getActiveSession();
  console.log(`[profile] ativo: ${activeProfile.name} (${activeProfile.id}) · session: ${sessionPart}`);

  // Registra brauze:// também na partition do profile ativo (pra newtab funcionar)
  session.fromPartition(sessionPart).protocol.handle('brauze', brauzeProtocolHandler);

  watchedFolders.init({ userDataPath: profilePath });
  history.init({ userDataPath: profilePath });
  permissions.load(profilePath);
  cookies.load(profilePath);
  passwords.init({ profilePath });

  // Permission handler: nega sensíveis por default na sessão das webviews
  const brauzeSession = session.fromPartition(sessionPart);
  brauzeSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    let origin = '';
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch {}
    const allow = permissions.decide(origin, permission);
    if (!allow) console.log(`[permission] deny ${permission} for ${origin}`);
    privacy.recordPermission(wc.id, permission, allow);
    callback(allow);
  });
  brauzeSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    return permissions.decide(requestingOrigin || '', permission);
  });

  // Bloqueia third-party cookies por default (com whitelist em cookies-3p-allow.json)
  cookies.attachToSession(brauzeSession);

  // Adblock na sessão do profile ativo — apenas network blocking, com whitelist.
  if (!process.env.BRAUZE_NO_ADBLOCK) {
    adblock.init({
      userDataPath: profilePath,
      session: brauzeSession,
    }).catch((err) => console.error('[adblock] erro:', err));
  }

  // Anexa menu de contexto + redireciona window.open / target=_blank pra novas abas.
  const sendOpenTab = (url) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tab:open', url);
    }
  };
  const sendInspect = (targetId, x, y) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('devtools:inspect-request', { targetId, x, y });
    }
  };
  const attachMenu = contextMenu.attach({ onOpenInNewTab: sendOpenTab, onInspect: sendInspect });
  // IMPORTANTE: registrar ANTES de createWindow pra pegar o mainWindow.webContents também.
  // Caso contrário will-attach-webview nunca dispara e webviews ficam sem preload nosso.
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (_event, webPreferences, params) => {
      // Força preload nosso (privacy/fingerprint detector). Renderer não pode trocar.
      webPreferences.preload = path.join(__dirname, 'renderer', 'webview-preload.js');
      delete webPreferences.preloadURL;
      webPreferences.nodeIntegration  = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox          = true;
      webPreferences.webSecurity      = true;
      webPreferences.allowRunningInsecureContent = false;
      webPreferences.experimentalFeatures = false;
    });

    // Reseta stats quando o frame principal navega pra nova URL
    contents.on('did-start-navigation', (_ev, url, isInPlace, isMainFrame) => {
      if (isMainFrame) privacy.reset(contents.id, url);
    });
    contents.on('destroyed', () => privacy.drop(contents.id));

    // Bloqueia navegação pra schemes perigosos (file://, chrome://, etc) iniciada por sites
    contents.on('will-navigate', (event, url) => {
      try {
        const u = new URL(url);
        const scheme = u.protocol.replace(':', '');
        const ALLOWED = ['http', 'https', 'brauze', 'about', 'blob', 'data'];
        if (!ALLOWED.includes(scheme)) {
          console.warn('[security] blocked navigation to', url);
          event.preventDefault();
        }
      } catch {}
    });

    attachMenu(contents);
    contents.setWindowOpenHandler(({ url }) => {
      sendOpenTab(url);
      return { action: 'deny' };
    });
    // Atalhos globais: interceptados aqui pra funcionar mesmo com foco dentro do webview.
    const SHORTCUTS = [
      { code: 'KeyI', alt: true,  action: 'devtools:toggle' },
      { code: 'KeyP',              action: 'qs:open' },
      { code: 'KeyF',              action: 'find:open' },
      { code: 'KeyT', shift: true, action: 'tab:reopen' },
      { code: 'KeyT',              action: 'tab:new' },
      { code: 'KeyW',              action: 'tab:close' },
      { code: 'KeyL',              action: 'address:focus' },
      { code: 'KeyR',              action: 'tab:reload' },
    ];
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const ctrl = input.meta || input.control;
      if (!ctrl) return;
      for (const sc of SHORTCUTS) {
        if (input.code !== sc.code) continue;
        if ((sc.alt   || false) !== (input.alt   || false)) continue;
        if ((sc.shift || false) !== (input.shift || false)) continue;
        event.preventDefault();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shortcut:fire', sc.action);
        }
        return;
      }
    });
  });

  // Janela criada DEPOIS do web-contents-created listener pra garantir que
  // o handler will-attach-webview pegue mainWindow.webContents.
  createWindow();

  ipcMain.handle('radar:scan-now', async () => {
    const services = await scan();
    return services;
  });

  ipcMain.handle('radar:kill-pid', async (_e, pid) => {
    pid = Number(pid);
    if (!Number.isInteger(pid) || pid <= 1) {
      return { ok: false, error: 'PID inválido' };
    }
    try { process.kill(pid, 'SIGTERM'); }
    catch (err) { return { ok: false, error: String(err.message || err) }; }

    await new Promise((r) => setTimeout(r, 1500));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) {
      try { process.kill(pid, 'SIGKILL'); }
      catch (err) { return { ok: false, error: 'SIGKILL: ' + String(err.message || err) }; }
      return { ok: true, signal: 'SIGKILL' };
    }
    return { ok: true, signal: 'SIGTERM' };
  });

  // ---- Terminal (multi-sessão) ----
  ipcMain.handle('term:create', (_e, { cols, rows, cwd }) => {
    if (!terminal.available) return { ok: false, error: 'node-pty indisponível' };
    let id, session;
    try {
      ({ id, session } = terminal.create({ cols, rows, cwd }));
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
    session.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('term:data', { id, data });
      }
    });
    session.onExit(({ exitCode }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('term:exit', { id, exitCode });
      }
      terminal.kill(id);
    });
    return { ok: true, id };
  });

  ipcMain.on('term:input',  (_e, { id, data })       => { const s = terminal.get(id); if (s) s.write(data); });
  ipcMain.on('term:resize', (_e, { id, cols, rows }) => { const s = terminal.get(id); if (s) s.resize(cols, rows); });
  ipcMain.on('term:kill',   (_e, { id })             => { terminal.kill(id); });

  // ---- CLI detect ----
  ipcMain.handle('cli:detect', async () => {
    try { return await cliDetect.detect(); }
    catch { return []; }
  });

  // ---- Shell helpers ----
  ipcMain.handle('shell:open-path', async (_e, p) => {
    try { const err = await shell.openPath(p); return { ok: !err, error: err || null }; }
    catch (err) { return { ok: false, error: String(err.message || err) }; }
  });

  // ---- DevTools docked (BrowserView posicionada pelo renderer) ----
  const DETACH_TOOLBAR_H = 28;
  let devtoolsView   = null;
  let devtoolsTarget = null;
  let detached       = null; // { window, view, target, onClosed, onResize }

  function destroyDevtoolsView() {
    if (!devtoolsView) return;
    try { mainWindow.removeBrowserView(devtoolsView); } catch {}
    try { devtoolsView.webContents.destroy(); } catch {}
    devtoolsView = null;
  }

  function clampBounds(b) {
    return {
      x:      Math.max(0, Math.round(b.x || 0)),
      y:      Math.max(0, Math.round(b.y || 0)),
      width:  Math.max(1, Math.round(b.width  || 1)),
      height: Math.max(1, Math.round(b.height || 1)),
    };
  }

  ipcMain.handle('devtools:open', (_e, { targetId, bounds, inspectAt }) => {
    const target = webContents.fromId(targetId);
    if (!target) return { ok: false, error: 'webContents alvo não encontrado' };
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'janela fechada' };

    try {
      if (devtoolsTarget && devtoolsTarget !== target) {
        try { devtoolsTarget.closeDevTools(); } catch {}
      }
      destroyDevtoolsView();

      devtoolsView = new BrowserView({ webPreferences: { nodeIntegration: false, contextIsolation: true } });
      mainWindow.addBrowserView(devtoolsView);
      devtoolsView.setBounds(clampBounds(bounds || { x: 0, y: 0, width: 480, height: 400 }));
      devtoolsView.setAutoResize({ width: false, height: false });

      try { target.closeDevTools(); } catch {}
      target.setDevToolsWebContents(devtoolsView.webContents);
      devtoolsTarget = target;
      target.openDevTools();
      if (inspectAt) {
        // Espera a UI engatar antes de pedir inspect — senão cai num devtools "vazio".
        setTimeout(() => {
          try { target.inspectElement(inspectAt.x, inspectAt.y); } catch {}
        }, 200);
      }
      return { ok: true };
    } catch (err) {
      destroyDevtoolsView();
      devtoolsTarget = null;
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.on('devtools:set-bounds', (_e, bounds) => {
    if (!devtoolsView) return;
    try { devtoolsView.setBounds(clampBounds(bounds)); } catch {}
  });

  ipcMain.handle('devtools:close', (_e) => {
    if (devtoolsTarget) { try { devtoolsTarget.closeDevTools(); } catch {} }
    devtoolsTarget = null;
    destroyDevtoolsView();
    return { ok: true };
  });

  ipcMain.handle('devtools:detach', (_e) => {
    if (!devtoolsView || !devtoolsTarget) return { ok: false };
    const view   = devtoolsView;
    const target = devtoolsTarget;
    devtoolsView   = null;
    devtoolsTarget = null;

    try { mainWindow.removeBrowserView(view); } catch {}

    const dtWindow = new BrowserWindow({
      width: 980,
      height: 640,
      backgroundColor: '#1b1b1f',
      title: 'DevTools — Brauze',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    dtWindow.loadFile(path.join(__dirname, 'renderer', 'devtools-detached.html'));
    dtWindow.addBrowserView(view);

    const updateBounds = () => {
      if (!detached || detached.view !== view) return;
      const [w, h] = dtWindow.getContentSize();
      try { view.setBounds({ x: 0, y: DETACH_TOOLBAR_H, width: w, height: Math.max(1, h - DETACH_TOOLBAR_H) }); } catch {}
    };

    const onResize = () => updateBounds();
    const onClosed = () => {
      detached = null;
      try { target.closeDevTools(); } catch {}
      try { view.webContents.destroy(); } catch {}
    };

    dtWindow.on('resize', onResize);
    dtWindow.on('closed', onClosed);

    detached = { window: dtWindow, view, target, onClosed, onResize };
    // Bounds inicial após o load assentar
    setTimeout(updateBounds, 0);

    return { ok: true };
  });

  ipcMain.handle('devtools:reattach', (_e) => {
    if (!detached) return { ok: false };
    const { window: dtWindow, view, target, onClosed } = detached;
    detached = null;

    dtWindow.removeListener('closed', onClosed);
    try { dtWindow.removeBrowserView(view); } catch {}
    try { dtWindow.close(); } catch {}

    devtoolsView   = view;
    devtoolsTarget = target;
    try { mainWindow.addBrowserView(view); } catch {}

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('devtools:reattached');
    }
    return { ok: true };
  });

  // ---- Omnibox / history ----
  ipcMain.handle('omnibox:query-local',       (_e, payload) => omnibox.queryLocal(payload || {}));
  ipcMain.handle('omnibox:query-suggestions', (_e, text)    => omnibox.querySuggestions(text));
  ipcMain.on('omnibox:record-visit',          (_e, payload) => history.recordVisit(payload || {}));
  ipcMain.handle('history:recent',            (_e, limit)   => history.recent(limit || 20));

  // Preconnect: DNS + TCP + TLS handshake antecipado, sem baixar HTML.
  const preconnectCache = new Map(); // url → timestamp
  const PRECONNECT_TTL = 30_000;
  ipcMain.on('omnibox:preconnect', (_e, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    const now = Date.now();
    const last = preconnectCache.get(url);
    if (last && now - last < PRECONNECT_TTL) return;
    preconnectCache.set(url, now);
    try { brauzeSession.preconnect({ url, numSockets: 1 }); }
    catch (err) { console.warn('[preconnect]', err.message); }
  });

  // ---- Passwords ----
  // Pending saves (vindos de form-submit no webview-preload).
  // Renderer pede confirmação via UI; senha nunca sai do main.
  const pendingSaves = new Map(); // wcId → { origin, username, password, ts }
  setInterval(() => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [id, p] of pendingSaves) if (p.ts < cutoff) pendingSaves.delete(id);
  }, 60_000);

  ipcMain.on('passwords:form-submit', (e, payload) => {
    if (!payload || !payload.origin || !payload.password) return;
    const check = passwords.existingMatch(payload);
    if (check.exists && check.matches) {
      // Mesma credencial já salva — só atualiza last_used silenciosamente
      passwords.touchUsed(check.id);
      return;
    }
    pendingSaves.set(e.sender.id, { ...payload, ts: Date.now() });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('passwords:save-prompt', {
        wcId: e.sender.id,
        origin: payload.origin,
        username: payload.username || '',
        isUpdate: check.exists, // mesma user, senha diferente
      });
    }
  });
  ipcMain.handle('passwords:confirm-save', (_e, wcId) => {
    const p = pendingSaves.get(wcId);
    if (!p) return null;
    pendingSaves.delete(wcId);
    return passwords.save(p);
  });
  ipcMain.handle('passwords:dismiss-save', (_e, wcId) => {
    pendingSaves.delete(wcId);
    return true;
  });

  ipcMain.handle('passwords:save',          (_e, payload) => passwords.save(payload));
  ipcMain.handle('passwords:list-origin',   (_e, origin)  => passwords.listForOrigin(origin));
  ipcMain.handle('passwords:list-all',      ()            => passwords.listAll());
  ipcMain.handle('passwords:get',           (_e, id, opts)=> passwords.getDecrypted(id, opts || {}));
  ipcMain.handle('passwords:lock',          ()            => passwords.lock());
  ipcMain.handle('passwords:breach-check',  async (_e, id) => {
    const cred = await passwords.getDecrypted(id, { requireAuth: true });
    if (!cred) return { ok: false };
    return await breach.check(cred.password);
  });
  ipcMain.handle('passwords:remove',        (_e, id)      => passwords.remove(id));
  ipcMain.handle('passwords:set-totp',      (_e, id, sec) => passwords.setTOTP(id, sec));
  ipcMain.handle('passwords:update',        (_e, id, p)   => passwords.update(id, p));
  ipcMain.handle('passwords:available',     ()            => passwords.isAvailable());

  // ---- Profiles ----
  ipcMain.handle('profiles:list',     ()        => profiles.list());
  ipcMain.handle('profiles:active',   ()        => profiles.getActive());
  ipcMain.handle('profiles:session',  ()        => profiles.getActiveSession());
  ipcMain.handle('profiles:create',   (_e, p)   => profiles.create(p || {}));
  ipcMain.handle('profiles:switch',   (_e, id)  => {
    if (!profiles.setActive(id)) return false;
    app.relaunch();
    app.exit(0);
    return true;
  });
  ipcMain.handle('profiles:update',   (_e, id, patch) => profiles.update(id, patch));
  ipcMain.handle('profiles:remove',   (_e, id) => profiles.remove(id));

  // ---- Privacy dashboard ----
  ipcMain.handle('privacy:get-stats', (_e, wcId) => privacy.snapshot(wcId));
  ipcMain.on('privacy:fingerprint',   (e, payload) => {
    privacy.setFingerprintCounters(e.sender.id, payload && payload.counters);
    if (payload && payload.tool) privacy.recordSessionReplay(e.sender.id, payload.tool);
  });

  // ---- Cookies ----
  ipcMain.handle('cookies:list-allowed-3p', ()         => cookies.listAllowed());
  ipcMain.handle('cookies:allow-3p',        (_e, h)    => cookies.allow3P(h));
  ipcMain.handle('cookies:disallow-3p',     (_e, h)    => cookies.disallow3P(h));
  ipcMain.handle('cookies:for-origin',      (_e, o)    => cookies.listForOrigin(brauzeSession, o));
  ipcMain.handle('cookies:clear-origin',    (_e, o)    => cookies.clearForOrigin(brauzeSession, o));
  ipcMain.handle('cookies:clear-all',       ()         => cookies.clearAll(brauzeSession));

  // ---- Permissions ----
  ipcMain.handle('permissions:list',  ()                 => permissions.listOrigins());
  ipcMain.handle('permissions:set',   (_e, origin, perm, allow) => permissions.setOriginDecision(origin, perm, allow));
  ipcMain.handle('permissions:clear', (_e, origin)       => permissions.clearOrigin(origin));

  // ---- Adblock whitelist ----
  ipcMain.handle('adblock:whitelist',        ()       => adblock.getWhitelist());
  ipcMain.handle('adblock:whitelist-add',    (_e, h)  => adblock.addToWhitelist(h, app.getPath('userData')));
  ipcMain.handle('adblock:whitelist-remove', (_e, h)  => adblock.removeFromWhitelist(h, app.getPath('userData')));

  // ---- Herd (.test → pasta do projeto) ----
  ipcMain.handle('herd:resolve', (_e, host) => herd.resolve(host));

  // ---- Watched folders ----
  ipcMain.handle('wf:list', () => watchedFolders.getFolders());
  ipcMain.handle('wf:add',  async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Adicionar pasta observada',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const added = watchedFolders.addFolder(res.filePaths[0]);
    return added ? res.filePaths[0] : null;
  });
  ipcMain.handle('wf:remove', (_e, p) => watchedFolders.removeFolder(p));
  ipcMain.handle('wf:match',  (_e, service) => watchedFolders.matchService(service));

  // ---- Prompt IA + MCP ----
  // Renderer executa JS no webview ativo quando o MCP server pedir.
  let nextExecId = 1;
  const pendingExecs = new Map();

  function runInActiveWebview(jsCode) {
    return new Promise((resolve, reject) => {
      if (!mainWindow || mainWindow.isDestroyed()) return reject(new Error('janela fechada'));
      const id = nextExecId++;
      const timeout = setTimeout(() => {
        pendingExecs.delete(id);
        reject(new Error('timeout executando JS'));
      }, 8000);
      pendingExecs.set(id, { resolve, reject, timeout });
      mainWindow.webContents.send('mcp:exec', { id, jsCode });
    });
  }
  ipcMain.on('mcp:result', (_e, { id, ok, value, error }) => {
    const p = pendingExecs.get(id);
    if (!p) return;
    pendingExecs.delete(id);
    clearTimeout(p.timeout);
    if (ok) p.resolve(value);
    else p.reject(new Error(error || 'falha desconhecida'));
  });

  ipcMain.handle('prompt:ask', async (_e, payload) => {
    const server = await mcpServer.start({ runInPage: runInActiveWebview });
    try {
      return await promptIA.ask({ ...payload, mcpUrl: server.url });
    } finally {
      try { await server.stop(); } catch {}
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
