const { contextBridge, ipcRenderer } = require('electron');

// Adblock cosmetic filters foram desativados — quebravam sites com Trusted Types
// CSP (YouTube, Twitter, etc). Network-level blocking continua via main process.

contextBridge.exposeInMainWorld('brauze', {
  radar: {
    onUpdate: (callback) => {
      const listener = (_e, services) => callback(services);
      ipcRenderer.on('radar:update', listener);
      return () => ipcRenderer.removeListener('radar:update', listener);
    },
    scanNow: () => ipcRenderer.invoke('radar:scan-now'),
    killPid: (pid) => ipcRenderer.invoke('radar:kill-pid', pid),
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
  devtools: {
    open:      (payload) => ipcRenderer.invoke('devtools:open', payload),
    setBounds: (bounds)  => ipcRenderer.send('devtools:set-bounds', bounds),
    close:     ()        => ipcRenderer.invoke('devtools:close'),
    detach:    ()        => ipcRenderer.invoke('devtools:detach'),
    reattach:  ()        => ipcRenderer.invoke('devtools:reattach'),
    onReattached: (cb) => {
      const l = () => cb();
      ipcRenderer.on('devtools:reattached', l);
      return () => ipcRenderer.removeListener('devtools:reattached', l);
    },
    onInspect: (cb) => {
      const l = (_e, payload) => cb(payload);
      ipcRenderer.on('devtools:inspect-request', l);
      return () => ipcRenderer.removeListener('devtools:inspect-request', l);
    },
    onToggleRequest: (cb) => {
      const l = () => cb();
      ipcRenderer.on('devtools:toggle-request', l);
      return () => ipcRenderer.removeListener('devtools:toggle-request', l);
    },
  },
  window: {
    onFullscreen: (cb) => {
      const l = (_e, isFs) => cb(isFs);
      ipcRenderer.on('window:fullscreen', l);
      return () => ipcRenderer.removeListener('window:fullscreen', l);
    },
  },
  shortcuts: {
    onFire: (cb) => {
      const l = (_e, action) => cb(action);
      ipcRenderer.on('shortcut:fire', l);
      return () => ipcRenderer.removeListener('shortcut:fire', l);
    },
  },
  omnibox: {
    queryLocal:       (payload) => ipcRenderer.invoke('omnibox:query-local', payload),
    querySuggestions: (text)    => ipcRenderer.invoke('omnibox:query-suggestions', text),
    recordVisit:      (payload) => ipcRenderer.send('omnibox:record-visit', payload),
    preconnect:       (url)     => ipcRenderer.send('omnibox:preconnect', url),
    recentHistory:    (limit)   => ipcRenderer.invoke('history:recent', limit),
  },
  herd: {
    resolve: (host) => ipcRenderer.invoke('herd:resolve', host),
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
