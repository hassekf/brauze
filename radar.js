// Project Radar — detecta serviços HTTP rodando localmente em portas comuns de dev.
// Roda no main process do Electron. Sem dependências externas.

const net   = require('net');
const http  = require('http');
const https = require('https');
const { enrichServices } = require('./process-info');

const KNOWN_PORTS = [
  80, 443,           // Apache/Nginx/HTTPS
  3000, 3001,        // Node, Next, CRA
  4200,              // Angular CLI
  5000, 5001,        // Flask, .NET
  5173, 5174,        // Vite
  8000, 8001,        // Django, http.server
  8080, 8081,        // Tomcat, alt HTTP
  8888,              // Jupyter
  9000,              // PHP-FPM, alt
  4321,              // Astro
  3333,              // Adonis, etc.
];

const HOSTS = ['127.0.0.1', '::1']; // dual-stack
const TCP_TIMEOUT  = 250;
const HTTP_TIMEOUT = 1500;

function checkPortAt(port, host) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(TCP_TIMEOUT);
    socket.once('connect', () => finish(true));
    socket.once('error',   () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, host);
  });
}

// Retorna o host que respondeu (IPv4 preferido), ou null se nenhum.
async function checkPort(port) {
  const [v4, v6] = await Promise.all(HOSTS.map((h) => checkPortAt(port, h)));
  if (v4) return '127.0.0.1';
  if (v6) return '::1';
  return null;
}

function probeOnce(port, host) {
  return new Promise((resolve) => {
    const proto = (port === 443) ? https : http;
    const opts = {
      host,
      port,
      path: '/',
      method: 'GET',
      timeout: HTTP_TIMEOUT,
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'Brauze-Radar/0.1' },
    };
    let req;
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };
    try {
      req = proto.request(opts, (res) => {
        let body = '';
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes <= 8192) body += chunk.toString('utf8');
          if (bytes > 16384) res.destroy();
        });
        res.on('end',   () => done({ status: res.statusCode, headers: res.headers || {}, body }));
        res.on('error', () => done(null));
        res.on('aborted', () => done(null));
      });
    } catch {
      return done(null);
    }
    req.on('error',   () => done(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} done(null); });
    req.on('socket', (sock) => {
      sock.setTimeout(HTTP_TIMEOUT, () => { try { req.destroy(); } catch {} done(null); });
    });
    try { req.end(); } catch { done(null); }
  });
}

// Hard timeout externo, blindagem caso o probeOnce pendure por algum motivo (TLS-handshake etc).
function probe(port, host) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; resolve(val); } };
    const t = setTimeout(() => finish(null), HTTP_TIMEOUT + 500);
    probeOnce(port, host).then((val) => { clearTimeout(t); finish(val); });
  });
}

// Heurísticas pra reconhecer frameworks comuns. Ordem importa: mais específico primeiro.
function fingerprint(port, probeResult) {
  const url = (port === 443 ? 'https' : 'http') + '://localhost:' + port;

  if (!probeResult) {
    return { port, url, name: 'Porta aberta', icon: '?', meta: 'sem resposta HTTP', status: null };
  }

  const { status, headers, body } = probeResult;
  const server  = (headers['server']        || '').toLowerCase();
  const powered = (headers['x-powered-by']  || '').toLowerCase();
  const ct      = (headers['content-type']  || '').toLowerCase();
  const b       = (body || '').toLowerCase();

  // -- Frameworks JS --
  if (b.includes('/@vite/client') || server.includes('vite')) {
    return s(port, url, 'Vite', '⚡', 'dev server', status);
  }
  if (b.includes('__next_data__') || powered.includes('next.js')) {
    return s(port, url, 'Next.js', '▲', powered || 'app', status);
  }
  if (b.includes('webpack-dev-server') || b.includes('react refresh')) {
    return s(port, url, 'React/CRA', '⚛', 'dev server', status);
  }
  if (b.includes('ng-version=') || b.includes('<app-root')) {
    return s(port, url, 'Angular', 'A', 'dev server', status);
  }
  if (b.includes('astro')) {
    return s(port, url, 'Astro', '🚀', 'dev server', status);
  }
  if (b.includes('nuxt') || powered.includes('nuxt')) {
    return s(port, url, 'Nuxt', 'N', 'dev server', status);
  }

  // -- Backends Python --
  if (server.startsWith('werkzeug')) {
    return s(port, url, 'Flask', '🧪', server, status);
  }
  if (server.includes('wsgiserver') || b.includes('django')) {
    return s(port, url, 'Django', '◆', server, status);
  }
  if (server.includes('gunicorn') || server.includes('uvicorn')) {
    return s(port, url, server.split('/')[0], '🐍', server, status);
  }
  if (server.includes('simplehttp')) {
    return s(port, url, 'Python http.server', '🐍', server, status);
  }
  if (b.includes('jupyter') || b.includes('ipython')) {
    return s(port, url, 'Jupyter', '📓', 'notebook', status);
  }

  // -- Express / Node genérico --
  if (powered.includes('express')) {
    return s(port, url, 'Express', '🚂', 'Node.js', status);
  }

  // -- WAMP / Apache / Nginx / PHP --
  if (b.includes('wampserver homepage') || b.includes('wamp')) {
    return s(port, url, 'WAMP', 'W', 'Apache+PHP+MySQL', status);
  }
  if (b.includes('phpmyadmin')) {
    return s(port, url, 'phpMyAdmin', '🐬', 'admin DB', status);
  }
  if (server.startsWith('apache')) {
    return s(port, url, 'Apache', '🪶', server, status);
  }
  if (server.startsWith('nginx')) {
    return s(port, url, 'nginx', 'N', server, status);
  }
  if (powered.startsWith('php')) {
    return s(port, url, 'PHP', '🐘', powered, status);
  }

  // -- .NET --
  if (server.includes('kestrel') || powered.includes('asp.net')) {
    return s(port, url, '.NET', '#', server || powered, status);
  }

  // -- Genéricos --
  if (ct.includes('html')) {
    return s(port, url, 'HTTP', '🌐', server || `status ${status}`, status);
  }
  if (ct.includes('json')) {
    return s(port, url, 'API JSON', '{}', server || `status ${status}`, status);
  }

  return s(port, url, 'Serviço HTTP', '·', server || `status ${status}`, status);
}

function s(port, url, name, icon, meta, status) {
  return { port, url, name, icon, meta, status };
}

async function scan() {
  const t0 = Date.now();
  const hosts = await Promise.all(KNOWN_PORTS.map(checkPort));
  const openPorts = [];
  const openHosts = [];
  KNOWN_PORTS.forEach((p, i) => { if (hosts[i]) { openPorts.push(p); openHosts.push(hosts[i]); } });
  const t1 = Date.now();

  const probes = await Promise.all(openPorts.map((p, i) => probe(p, openHosts[i])));
  const t2 = Date.now();

  const baseServices = openPorts.map((port, i) => fingerprint(port, probes[i]));

  // Enriquecimento (PID + cwd inferido). Se falhar, segue sem enriquecer.
  let services = baseServices;
  try { services = await enrichServices(baseServices); }
  catch (err) { console.error('[radar] enrich failed:', err.message); }

  const t3 = Date.now();
  console.log(`[radar] tcp ${t1 - t0}ms · http ${t2 - t1}ms · enrich ${t3 - t2}ms · open=[${openPorts.join(',')}]`);
  return services;
}

module.exports = { scan };
