// Roda dentro de cada webview (sandboxed). Detecta fingerprinting + session replay
// e reporta pro main via IPC. Também esconde cookie banners conhecidos via CSS.

const { ipcRenderer } = require('electron');

const counters = { canvas: 0, webgl: 0, audio: 0, fonts: 0, plugins: 0, screen: 0 };
let lastReportAt = 0;
let pendingReport = null;

function report(extra) {
  const now = Date.now();
  if (now - lastReportAt < 800 && !extra) {
    if (pendingReport) clearTimeout(pendingReport);
    pendingReport = setTimeout(() => report({ flush: true }), 800);
    return;
  }
  lastReportAt = now;
  try { ipcRenderer.send('privacy:fingerprint', { counters, ...(extra || {}) }); } catch {}
}

// Patches são tentados via injeção no main world via CSS (pra cookie banners) e
// via JS injetado pelo renderer (pra monkey-patch). Aqui no preload só recebemos
// dados do mundo isolado via window.postMessage, e listeners de mensagem da página.

window.addEventListener('message', (e) => {
  if (e.data && e.data.__brauzeFP) {
    const { type, tool } = e.data;
    if (type && counters[type] != null) counters[type]++;
    if (tool) report({ tool });
    else report();
  }
});

// Lista de tools de session replay conhecidas (detecta por src do script)
const REPLAY_TOOLS = [
  { name: 'FullStory',  re: /fullstory\.com/i },
  { name: 'Hotjar',     re: /hotjar\.com|static\.hotjar/i },
  { name: 'LogRocket',  re: /logrocket\.io/i },
  { name: 'Smartlook',  re: /smartlook\.com/i },
  { name: 'Mouseflow',  re: /mouseflow\.com/i },
  { name: 'Heap',       re: /heapanalytics\.com/i },
  { name: 'Mixpanel',   re: /mixpanel\.com/i },
  { name: 'Amplitude',  re: /amplitude\.com/i },
  { name: 'Segment',    re: /segment\.com|cdn\.segment/i },
  { name: 'GoogleAnalytics', re: /google-analytics\.com|googletagmanager/i },
  { name: 'FacebookPixel',  re: /connect\.facebook\.net/i },
];

function checkScripts() {
  for (const sc of document.querySelectorAll('script[src]')) {
    const src = sc.src || '';
    for (const t of REPLAY_TOOLS) {
      if (t.re.test(src)) report({ tool: t.name });
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkScripts();
  // Observer pra scripts que aparecem depois
  try {
    new MutationObserver(() => checkScripts()).observe(document.documentElement, {
      childList: true, subtree: true,
    });
  } catch {}
  installFormHook();
});

// ---- Detector de submit em forms com password ----
function findUsernameInput(form, passwordInput) {
  // 1. autocomplete="username"
  let u = form.querySelector('input[autocomplete="username"]');
  if (u && u.value) return u;
  // 2. campos type=email/text antes do password
  const inputs = Array.from(form.querySelectorAll('input'));
  const pwIdx = inputs.indexOf(passwordInput);
  for (let i = pwIdx - 1; i >= 0; i--) {
    const it = inputs[i];
    if (!it.disabled && (it.type === 'email' || it.type === 'text' || it.type === 'tel')) {
      if (it.value) return it;
    }
  }
  // 3. último recurso: qualquer email/text com valor
  for (const it of inputs) {
    if (!it.disabled && (it.type === 'email' || it.type === 'text' || it.type === 'tel') && it.value) return it;
  }
  return null;
}

function captureFormSubmit(form) {
  if (form.__brauzeHooked) return;
  form.__brauzeHooked = true;
  form.addEventListener('submit', () => {
    try {
      const pw = form.querySelector('input[type="password"]');
      if (!pw || !pw.value) return;
      const userInput = findUsernameInput(form, pw);
      const username = userInput ? userInput.value : '';
      const password = pw.value;
      const origin = location.origin;
      ipcRenderer.send('passwords:form-submit', { origin, username, password });
    } catch {}
  }, true);
}

function scanForms() {
  for (const form of document.querySelectorAll('form')) {
    if (form.querySelector('input[type="password"]')) captureFormSubmit(form);
  }
}

function installFormHook() {
  scanForms();
  try {
    new MutationObserver(() => scanForms()).observe(document.body || document.documentElement, {
      childList: true, subtree: true,
    });
  } catch {}
}
