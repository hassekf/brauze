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
  passwords: {
    save:        (p)        => ipcRenderer.invoke('passwords:save', p),
    listOrigin:  (origin)   => ipcRenderer.invoke('passwords:list-origin', origin),
    listAll:     ()         => ipcRenderer.invoke('passwords:list-all'),
    get:         (id, opts) => ipcRenderer.invoke('passwords:get', id, opts),
    lock:        ()         => ipcRenderer.invoke('passwords:lock'),
    remove:      (id)       => ipcRenderer.invoke('passwords:remove', id),
    setTOTP:     (id, sec)  => ipcRenderer.invoke('passwords:set-totp', id, sec),
    update:      (id, p)    => ipcRenderer.invoke('passwords:update', id, p),
    available:   ()         => ipcRenderer.invoke('passwords:available'),
    confirmSave: (wcId)     => ipcRenderer.invoke('passwords:confirm-save', wcId),
    dismissSave: (wcId)     => ipcRenderer.invoke('passwords:dismiss-save', wcId),
    onSavePrompt: (cb) => {
      const l = (_e, payload) => cb(payload);
      ipcRenderer.on('passwords:save-prompt', l);
      return () => ipcRenderer.removeListener('passwords:save-prompt', l);
    },
  },
  profiles: {
    list:    ()           => ipcRenderer.invoke('profiles:list'),
    active:  ()           => ipcRenderer.invoke('profiles:active'),
    session: ()           => ipcRenderer.invoke('profiles:session'),
    create:  (p)          => ipcRenderer.invoke('profiles:create', p),
    switchTo:(id)         => ipcRenderer.invoke('profiles:switch', id),
    update:  (id, patch)  => ipcRenderer.invoke('profiles:update', id, patch),
    remove:  (id)         => ipcRenderer.invoke('profiles:remove', id),
  },
  privacy: {
    getStats: (wcId) => ipcRenderer.invoke('privacy:get-stats', wcId),
  },
  cookies: {
    listAllowed3P: ()       => ipcRenderer.invoke('cookies:list-allowed-3p'),
    allow3P:       (host)   => ipcRenderer.invoke('cookies:allow-3p', host),
    disallow3P:    (host)   => ipcRenderer.invoke('cookies:disallow-3p', host),
    forOrigin:     (origin) => ipcRenderer.invoke('cookies:for-origin', origin),
    clearOrigin:   (origin) => ipcRenderer.invoke('cookies:clear-origin', origin),
    clearAll:      ()       => ipcRenderer.invoke('cookies:clear-all'),
  },
  permissions: {
    list:  ()                       => ipcRenderer.invoke('permissions:list'),
    set:   (origin, permission, allow) => ipcRenderer.invoke('permissions:set', origin, permission, allow),
    clear: (origin)                 => ipcRenderer.invoke('permissions:clear', origin),
  },
  adblock: {
    whitelist:       ()  => ipcRenderer.invoke('adblock:whitelist'),
    addToWhitelist:  (h) => ipcRenderer.invoke('adblock:whitelist-add', h),
    removeFromWhitelist: (h) => ipcRenderer.invoke('adblock:whitelist-remove', h),
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
