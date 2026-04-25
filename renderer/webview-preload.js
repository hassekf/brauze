// Roda dentro de cada webview (sandboxed). Detecta fingerprinting + session replay
// e reporta pro main via IPC. Também esconde cookie banners conhecidos via CSS.

const { ipcRenderer, contextBridge } = require('electron');
console.log('[brauze-webview-preload] loaded for', location.href);

// Expõe API privilegiada APENAS pra páginas internas brauze://
try {
  if (location.protocol === 'brauze:') {
    contextBridge.exposeInMainWorld('brauzeInternal', {
      passwords: {
        list:    ()        => ipcRenderer.invoke('passwords:list-all'),
        get:     (id)      => ipcRenderer.invoke('passwords:get', id),
        remove:  (id)      => ipcRenderer.invoke('passwords:remove', id),
        update:  (id, p)   => ipcRenderer.invoke('passwords:update', id, p),
        setTOTP: (id, sec) => ipcRenderer.invoke('passwords:set-totp', id, sec),
        lock:    ()        => ipcRenderer.invoke('passwords:lock'),
        checkBreach: (id)  => ipcRenderer.invoke('passwords:breach-check', id),
      },
    });
  }
} catch {}

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

function reportCredential(username, password) {
  if (!password) return;
  console.log('[brauze-webview-preload] reporting credential for', location.origin, 'username=', username);
  try {
    ipcRenderer.send('passwords:form-submit', {
      origin: location.origin,
      username: username || '',
      password,
    });
  } catch (err) { console.warn('[brauze-webview-preload] send failed:', err.message); }
}

function captureFromForm(form) {
  const pw = form.querySelector('input[type="password"]:not([disabled])');
  if (!pw || !pw.value) return false;
  const userInput = findUsernameInput(form, pw);
  reportCredential(userInput ? userInput.value : '', pw.value);
  return true;
}

function captureAnywhereOnPage() {
  const pw = document.querySelector('input[type="password"]:not([disabled])');
  if (!pw || !pw.value) return false;
  const form = pw.closest('form');
  if (form) return captureFromForm(form);
  // Sem form: tenta achar username em inputs irmãos visíveis
  const allInputs = Array.from(document.querySelectorAll('input'));
  const pwIdx = allInputs.indexOf(pw);
  let userVal = '';
  for (let i = pwIdx - 1; i >= 0; i--) {
    const it = allInputs[i];
    if (!it.disabled && (it.type === 'email' || it.type === 'text' || it.type === 'tel') && it.value) {
      userVal = it.value; break;
    }
  }
  if (!userVal) {
    for (const it of allInputs) {
      if (!it.disabled && (it.type === 'email' || it.type === 'text' || it.type === 'tel') && it.value) {
        userVal = it.value; break;
      }
    }
  }
  reportCredential(userVal, pw.value);
  return true;
}

function captureFormSubmit(form) {
  if (form.__brauzeHooked) return;
  form.__brauzeHooked = true;
  form.addEventListener('submit', () => { try { captureFromForm(form); } catch {} }, true);
}

function scanForms() {
  for (const form of document.querySelectorAll('form')) {
    if (form.querySelector('input[type="password"]')) captureFormSubmit(form);
  }
}

// Heurística pra botões "login"/"entrar"/etc — captura mesmo em SPAs sem form submit
const LOGIN_BUTTON_RE = /(login|log\s*in|sign\s*in|entrar|acessar|continuar|continue|enviar|submit|próximo|proximo|next)/i;
function isLoginButton(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag !== 'BUTTON' && !(tag === 'INPUT' && /^(submit|button)$/i.test(el.type))) return false;
  const text = (el.value || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
  return LOGIN_BUTTON_RE.test(text);
}

function installFormHook() {
  scanForms();
  try {
    new MutationObserver(() => scanForms()).observe(document.body || document.documentElement, {
      childList: true, subtree: true,
    });
  } catch {}

  // Click em botão tipo "Entrar/Login" → captura senha digitada
  document.addEventListener('click', (e) => {
    try {
      const btn = e.target.closest('button, input[type="submit"], input[type="button"]');
      if (!btn || !isLoginButton(btn)) return;
      captureAnywhereOnPage();
    } catch {}
  }, true);

  // Enter dentro de password input (login sem form submit)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.type === 'password' && e.target.value) {
      try { captureAnywhereOnPage(); } catch {}
    }
  }, true);

  // Fallback: pagehide pega caso a página feche/navegue com password preenchido
  window.addEventListener('pagehide', () => { try { captureAnywhereOnPage(); } catch {} });
}
