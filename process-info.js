// Descobre processo dono de cada porta e tenta inferir a pasta do projeto.
// v1: focado em Windows. Mac/Linux têm stubs com lsof.

const { exec, execFile } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const isWindows = os.platform() === 'win32';

const PROJECT_MARKERS = [
  'package.json', 'composer.json', '.git',
  'pyproject.toml', 'requirements.txt', 'manage.py',
  'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle',
  'artisan', 'next.config.js', 'next.config.ts',
  'vite.config.js', 'vite.config.ts', 'astro.config.mjs',
];

const MAX_WALK = 12;            // sobe no máximo 12 níveis pra achar marker
const PROC_CACHE_MS = 60_000;   // cache de info de processo

const procCache = new Map();    // pid → { info, expiresAt }

function execOut(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 8 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout ? stdout.toString() : '');
    });
  });
}

// ---------- Mapa porta → PID ----------

async function portToPidMapWindows() {
  // SEM `-p TCP`: esse filtro no Windows é IPv4 only. Como Vite/Next costumam
  // bindar em IPv6 ([::1]), precisamos das duas famílias.
  const out = await execOut('netstat -ano');
  const map = new Map();
  if (!out) return map;
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    if (parts[0] !== 'TCP') continue;
    // LISTENING universal: foreign address termina sempre em :0.
    // (evita problemas de localização — em PT-BR é "ESCUTANDO", DE "ABHÖREN" etc).
    if (!parts[2].endsWith(':0')) continue;
    const local = parts[1];
    const pid = parseInt(parts[4], 10);
    if (!pid) continue;
    const m = local.match(/:(\d+)$/);
    if (!m) continue;
    const port = parseInt(m[1], 10);
    if (!port || map.has(port)) continue;
    map.set(port, pid);
  }
  return map;
}

async function portToPidMapUnix() {
  // lsof: -nP (sem resolver), -iTCP -sTCP:LISTEN, formato terse
  const out = await execOut('lsof -nP -iTCP -sTCP:LISTEN -F pPn');
  const map = new Map();
  if (!out) return map;
  let curPid = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) curPid = parseInt(line.slice(1), 10);
    else if (line.startsWith('n') && curPid) {
      const m = line.match(/:(\d+)$/);
      if (m) {
        const port = parseInt(m[1], 10);
        if (port && !map.has(port)) map.set(port, curPid);
      }
    }
  }
  return map;
}

const portToPidMap = isWindows ? portToPidMapWindows : portToPidMapUnix;

// ---------- Info de processo (cmdline) ----------

async function fetchProcessInfoWindows(pids) {
  if (!pids.length) return new Map();
  const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ');
  // Junta Win32_Process (cmdline, parentPid) com Get-Process (window title) num só JSON.
  const ps = `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; [pscustomobject]@{ ProcessId=$_.ProcessId; ParentProcessId=$_.ParentProcessId; Name=$_.Name; CommandLine=$_.CommandLine; ExecutablePath=$_.ExecutablePath; WindowTitle=$p.MainWindowTitle } } | ConvertTo-Json -Compress`;
  const cmd = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`;
  const out = await execOut(cmd);
  const map = new Map();
  if (!out || !out.trim()) return map;
  let parsed;
  try { parsed = JSON.parse(out); }
  catch { return map; }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  for (const p of arr) {
    if (!p || !p.ProcessId) continue;
    map.set(p.ProcessId, {
      name: p.Name || '',
      cmdline: p.CommandLine || '',
      exe: p.ExecutablePath || '',
      parentPid: p.ParentProcessId || null,
      windowTitle: p.WindowTitle || '',
    });
  }
  return map;
}

async function fetchProcessInfoUnix(pids) {
  const map = new Map();
  await Promise.all(pids.map(async (pid) => {
    const out = await execOut(`ps -p ${pid} -o pid=,comm=,command=`);
    if (!out) return;
    const line = out.trim();
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) return;
    map.set(parseInt(m[1], 10), { name: m[2], cmdline: m[3], exe: m[2] });
    // bonus: lsof cwd
    const cwdOut = await execOut(`lsof -p ${pid} -d cwd -Fn`);
    if (cwdOut) {
      const cwdLine = cwdOut.split('\n').find((l) => l.startsWith('n'));
      if (cwdLine) map.get(parseInt(m[1], 10)).cwd = cwdLine.slice(1);
    }
  }));
  return map;
}

const fetchProcessInfo = isWindows ? fetchProcessInfoWindows : fetchProcessInfoUnix;

async function getProcessInfo(pids) {
  const now = Date.now();
  const result = new Map();
  const need = [];
  for (const pid of pids) {
    const c = procCache.get(pid);
    if (c && c.expiresAt > now) result.set(pid, c.info);
    else need.push(pid);
  }
  if (need.length) {
    const fresh = await fetchProcessInfo(need);
    for (const [pid, info] of fresh) {
      procCache.set(pid, { info, expiresAt: now + PROC_CACHE_MS });
      result.set(pid, info);
    }
  }
  return result;
}

// ---------- Inferir project root ----------

function extractAbsolutePaths(cmdline) {
  const set = new Set();
  if (!cmdline) return [];
  for (const m of cmdline.matchAll(/"([^"]+)"/g)) {
    if (/^[a-z]:[\\/]/i.test(m[1]) || m[1].startsWith('/')) set.add(m[1]);
  }
  for (const m of cmdline.matchAll(/(?:^|\s)([a-z]:[\\/][^\s"]+)/gi)) set.add(m[1]);
  for (const m of cmdline.matchAll(/(?:^|\s)(\/[^\s"]+)/g))         set.add(m[1]);
  return Array.from(set);
}

function isInsideNodeModules(p) {
  return /[\\/]node_modules([\\/]|$)/i.test(p);
}

function findMarkerRoot(startPath) {
  let p;
  try {
    p = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  } catch { p = path.dirname(startPath); }

  for (let i = 0; i < MAX_WALK; i++) {
    // Markers dentro de node_modules são lixo — ignora e segue subindo até sair.
    if (!isInsideNodeModules(p)) {
      for (const m of PROJECT_MARKERS) {
        try { if (fs.existsSync(path.join(p, m))) return p; } catch {}
      }
    }
    const parent = path.dirname(p);
    if (!parent || parent === p) break;
    p = parent;
  }
  return null;
}

// Window titles de cmd.exe geralmente contêm "C:\path\to\dir>" ou similar.
// Pega o caminho absoluto se houver.
function extractPathFromWindowTitle(title) {
  if (!title) return null;
  const m = title.match(/([a-z]:[\\/][^\s>?<|*"]+)/i);
  return m ? m[1].replace(/[>\s]+$/, '') : null;
}

function inferFromInfo(info) {
  if (!info) return null;
  if (info.cwd) {
    const r = findMarkerRoot(info.cwd);
    if (r) return r;
  }
  if (info.cmdline) {
    const cands = extractAbsolutePaths(info.cmdline).map(findMarkerRoot).filter(Boolean);
    if (cands.length) {
      cands.sort((a, b) => b.length - a.length);
      return cands[0];
    }
  }
  if (info.windowTitle) {
    const titlePath = extractPathFromWindowTitle(info.windowTitle);
    if (titlePath) {
      const r = findMarkerRoot(titlePath);
      if (r) return r;
    }
  }
  return null;
}

// Tenta no PID direto; se não der, sobe pela árvore de pais.
function inferProjectRoot(pid, infoMap) {
  let cur = infoMap.get(pid);
  let depth = 0;
  while (cur && depth < 5) {
    const r = inferFromInfo(cur);
    if (r) return r;
    if (!cur.parentPid) break;
    cur = infoMap.get(cur.parentPid);
    depth++;
  }
  return null;
}

// ---------- API pública ----------

// Busca info pra um conjunto de PIDs e, se algum tiver dados insuficientes
// (sem cmdline e sem windowTitle), busca também os pais até depth máxima.
async function getProcessInfoChain(initialPids, maxDepth = 4) {
  const infoMap = new Map();
  let toFetch = Array.from(new Set(initialPids));
  for (let d = 0; d < maxDepth && toFetch.length; d++) {
    const fresh = await getProcessInfo(toFetch);
    const next = [];
    for (const [pid, info] of fresh) {
      if (!infoMap.has(pid)) infoMap.set(pid, info);
      const useless = !info.cmdline && !info.windowTitle;
      if (useless && info.parentPid && !infoMap.has(info.parentPid)) {
        next.push(info.parentPid);
      }
    }
    toFetch = next;
  }
  return infoMap;
}

async function enrichServices(services) {
  const portMap = await portToPidMap();
  const initialPids = services.map((s) => portMap.get(s.port)).filter(Boolean);
  const infoMap = await getProcessInfoChain(initialPids);

  return services.map((svc) => {
    const pid = portMap.get(svc.port);
    if (!pid) return svc;
    const cwd = inferProjectRoot(pid, infoMap);
    if (process.env.BRAUZE_DEBUG_RADAR) {
      const info = infoMap.get(pid);
      console.log(`[radar:debug] :${svc.port} pid=${pid} cwd=${cwd || '(null)'} parent=${info?.parentPid || '?'} title="${(info?.windowTitle||'').slice(0,60)}" cmdline=${(info?.cmdline||'').slice(0,160)}`);
    }
    return { ...svc, pid, cwd: cwd || null };
  });
}

module.exports = { enrichServices, portToPidMap, getProcessInfo, inferProjectRoot };
