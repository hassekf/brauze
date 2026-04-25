const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path = require('path');
const fs   = require('fs');
const { scan } = require('./radar');
const contextMenu = require('./context-menu');
const cliDetect   = require('./cli-detect');
const terminal    = require('./terminal');
const watchedFolders = require('./watched-folders');
const promptIA = require('./prompt');
const mcpServer = require('./mcp-server');
const adblock   = require('./adblock');

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Só dispara o primeiro scan quando o renderer já registrou os listeners.
  mainWindow.webContents.once('did-finish-load', () => {
    runScanAndBroadcast();
    scanTimer = setInterval(runScanAndBroadcast, SCAN_INTERVAL_MS);
    if (DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
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
  watchedFolders.init({ userDataPath: app.getPath('userData') });

  // Adblock na sessão compartilhada das webviews (`persist:brauze`).
  // Roda em paralelo — não bloqueia abertura da janela.
  adblock.init({
    userDataPath: app.getPath('userData'),
    session: session.fromPartition('persist:brauze'),
  }).catch((err) => console.error('[adblock] erro:', err));

  createWindow();

  // Anexa menu de contexto + redireciona window.open / target=_blank pra novas abas.
  const sendOpenTab = (url) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tab:open', url);
    }
  };
  const attachMenu = contextMenu.attach({ onOpenInNewTab: sendOpenTab });
  app.on('web-contents-created', (_e, contents) => {
    attachMenu(contents);
    contents.setWindowOpenHandler(({ url }) => {
      sendOpenTab(url);
      return { action: 'deny' };
    });
  });

  ipcMain.handle('radar:scan-now', async () => {
    const services = await scan();
    return services;
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
