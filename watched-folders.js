// Pastas observadas pelo Brauze. Pra cada serviço detectado pelo radar
// que não tenha cwd inferido, varremos essas pastas (1 nível) procurando
// projetos que casem com o framework.

const fs   = require('fs');
const path = require('path');

const SCAN_CACHE_MS = 60_000;

// Frameworks → arquivos marcadores no root do projeto.
const FRAMEWORK_MARKERS = {
  vite:    ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs'],
  next:    ['next.config.js', 'next.config.ts', 'next.config.mjs'],
  nuxt:    ['nuxt.config.js', 'nuxt.config.ts'],
  angular: ['angular.json'],
  astro:   ['astro.config.js', 'astro.config.mjs', 'astro.config.ts'],
  react:   [], // sem marcador único; depende de package.json
  laravel: ['artisan'],
  django:  ['manage.py'],
  flask:   [],
  php:     ['composer.json'],
};

// Nome do serviço (radar.fingerprint) → chave de framework.
function frameworkKeyFromName(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('vite'))    return 'vite';
  if (n.includes('next'))    return 'next';
  if (n.includes('nuxt'))    return 'nuxt';
  if (n.includes('angular')) return 'angular';
  if (n.includes('astro'))   return 'astro';
  if (n.includes('react'))   return 'react';
  if (n.includes('django'))  return 'django';
  if (n.includes('flask'))   return 'flask';
  if (n.includes('wamp') || n.includes('apache') || n.includes('php')) return 'php';
  return null;
}

let configPath = null;        // setado pelo init
let scanCache  = { at: 0, byFramework: new Map() };

function init({ userDataPath }) {
  configPath = path.join(userDataPath, 'brauze-config.json');
}

function readConfig() {
  if (!configPath) return { watchedFolders: [] };
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch { return { watchedFolders: [] }; }
}

function writeConfig(cfg) {
  if (!configPath) return;
  try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2)); } catch {}
}

function getFolders() {
  return readConfig().watchedFolders || [];
}

function addFolder(folderPath) {
  const cfg = readConfig();
  const list = cfg.watchedFolders || [];
  if (!list.includes(folderPath)) {
    list.push(folderPath);
    cfg.watchedFolders = list;
    writeConfig(cfg);
    invalidateCache();
    return true;
  }
  return false;
}

function removeFolder(folderPath) {
  const cfg = readConfig();
  cfg.watchedFolders = (cfg.watchedFolders || []).filter((p) => p !== folderPath);
  writeConfig(cfg);
  invalidateCache();
  return true;
}

function invalidateCache() { scanCache = { at: 0, byFramework: new Map() }; }

// Detecta a quais frameworks um diretório atende.
function detectFrameworksOf(dirPath) {
  const found = new Set();
  let pkg = null;
  for (const [fw, markers] of Object.entries(FRAMEWORK_MARKERS)) {
    for (const m of markers) {
      try {
        if (fs.existsSync(path.join(dirPath, m))) { found.add(fw); break; }
      } catch {}
    }
  }
  // Fallback via package.json: olha dependencies pra cobrir react/express/flask/etc.
  try {
    const pkgPath = path.join(dirPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react)   found.add('react');
      if (deps.next)    found.add('next');
      if (deps.vite)    found.add('vite');
      if (deps.nuxt)    found.add('nuxt');
      if (deps.astro)   found.add('astro');
      if (deps.express) found.add('express');
    }
  } catch {}
  return Array.from(found);
}

// Varre todas as pastas observadas, indexa por framework. Cache de 60s.
function scanProjects() {
  if (Date.now() - scanCache.at < SCAN_CACHE_MS && scanCache.byFramework.size > 0) {
    return scanCache.byFramework;
  }
  const folders = getFolders();
  const byFramework = new Map(); // framework → [{ path, name }]

  for (const root of folders) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); }
    catch { continue; }

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.')) continue;
      const dirPath = path.join(root, ent.name);
      const frameworks = detectFrameworksOf(dirPath);
      if (!frameworks.length) continue;
      for (const fw of frameworks) {
        if (!byFramework.has(fw)) byFramework.set(fw, []);
        byFramework.get(fw).push({ path: dirPath, name: ent.name });
      }
    }
  }

  scanCache = { at: Date.now(), byFramework };
  return byFramework;
}

// Pra um serviço (ex: name="Vite"), retorna candidatos das watched folders.
function matchService(service) {
  const fw = frameworkKeyFromName(service.name);
  if (!fw) return [];
  const idx = scanProjects();
  return idx.get(fw) || [];
}

module.exports = { init, getFolders, addFolder, removeFolder, scanProjects, matchService, invalidateCache };
