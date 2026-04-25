const { contextBridge, ipcRenderer } = require('electron');

// Adblock cosmetic filters: registra os handlers IPC que o lib espera no renderer.
try { require('@ghostery/adblocker-electron-preload'); } catch (err) {
  console.warn('[adblock] preload bridge falhou:', err.message);
}

contextBridge.exposeInMainWorld('brauze', {
  radar: {
    onUpdate: (callback) => {
      const listener = (_e, services) => callback(services);
      ipcRenderer.on('radar:update', listener);
      return () => ipcRenderer.removeListener('radar:update', listener);
    },
    scanNow: () => ipcRenderer.invoke('radar:scan-now'),
  },
  tabs: {
    onOpen: (callback) => {
      const listener = (_e, url) => callback(url);
      ipcRenderer.on('tab:open', listener);
      return () => ipcRenderer.removeListener('tab:open', listener);
    },
  },
  terminal: {
    create: (size)            => ipcRenderer.invoke('term:create', size),
    write:  (id, data)        => ipcRenderer.send('term:input',  { id, data }),
    resize: (id, cols, rows)  => ipcRenderer.send('term:resize', { id, cols, rows }),
    kill:   (id)              => ipcRenderer.send('term:kill',   { id }),
    onData: (cb) => {
      const l = (_e, payload) => cb(payload);
      ipcRenderer.on('term:data', l);
      return () => ipcRenderer.removeListener('term:data', l);
    },
    onExit: (cb) => {
      const l = (_e, payload) => cb(payload);
      ipcRenderer.on('term:exit', l);
      return () => ipcRenderer.removeListener('term:exit', l);
    },
  },
  cli: {
    detect: () => ipcRenderer.invoke('cli:detect'),
  },
  shell: {
    openPath: (p) => ipcRenderer.invoke('shell:open-path', p),
  },
  watchedFolders: {
    list:   ()        => ipcRenderer.invoke('wf:list'),
    add:    ()        => ipcRenderer.invoke('wf:add'),
    remove: (p)       => ipcRenderer.invoke('wf:remove', p),
    match:  (service) => ipcRenderer.invoke('wf:match', service),
  },
  prompt: {
    ask: (payload) => ipcRenderer.invoke('prompt:ask', payload),
  },
  mcp: {
    onExec:  (cb)               => {
      const l = (_e, payload) => cb(payload);
      ipcRenderer.on('mcp:exec', l);
      return () => ipcRenderer.removeListener('mcp:exec', l);
    },
    respond: (id, ok, value, error) => ipcRenderer.send('mcp:result', { id, ok, value, error }),
  },
});
