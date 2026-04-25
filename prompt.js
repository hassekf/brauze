// Spawn do Claude CLI pra responder perguntas com contexto da página atual.
// Pipeia o prompt via stdin. v1 sem streaming (resposta inteira no fim).

const { spawn } = require('child_process');
const os   = require('os');
const fs   = require('fs');
const path = require('path');

const isWindows = os.platform() === 'win32';
const RUN_TIMEOUT_MS = 180_000;

function fmtKv(obj, indent = '- ') {
  return Object.entries(obj)
    .filter(([_, v]) => v != null && v !== '')
    .map(([k, v]) => `${indent}${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n');
}

function buildPrompt({ question, context = {} }) {
  const c = context;
  const out = [];
  out.push('Você é um assistente do navegador Brauze, ajudando um desenvolvedor.');
  out.push('Ele está olhando uma página e te perguntou algo. Tem acesso ao DOM via DevTools, mas você pode responder direto se o contexto abaixo bastar.');
  out.push('');
  out.push('## Página');
  out.push(`- URL: ${c.url || '(vazia)'}`);
  out.push(`- Título: ${c.title || '(sem título)'}`);
  if (c.lang)     out.push(`- Idioma: ${c.lang}`);
  if (c.viewport) out.push(`- Viewport: ${c.viewport.width}×${c.viewport.height} (DPR ${c.viewport.dpr})`);

  if (c.frameworks?.length) {
    out.push('', '## Frameworks detectados');
    out.push(c.frameworks.map((f) => `- ${f}`).join('\n'));
  }

  if (c.fontsLoaded?.length) {
    out.push('', '## Fontes carregadas (FontFaceSet)');
    out.push(c.fontsLoaded.slice(0, 30).map((f) => `- ${f}`).join('\n'));
  }

  if (c.computed && Object.keys(c.computed).length) {
    out.push('', '## Computed styles de elementos-chave');
    for (const [sel, props] of Object.entries(c.computed)) {
      const line = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(' · ');
      out.push(`- **${sel}** → ${line}`);
    }
  }

  if (c.colors) {
    out.push('', '## Cores do body');
    out.push(fmtKv(c.colors));
  }

  if (c.breakpoints?.length) {
    out.push('', '## Media queries (breakpoints)');
    out.push(c.breakpoints.slice(0, 25).map((b) => `- ${b}`).join('\n'));
  }

  if (c.stylesheets?.length) {
    out.push('', '## Stylesheets carregadas');
    out.push(c.stylesheets.slice(0, 15).map((s) => `- ${s}`).join('\n'));
  }

  if (c.meta && Object.keys(c.meta).length) {
    const interesting = ['description','keywords','author','generator','theme-color','viewport','og:title','og:description','twitter:card'];
    const filtered = Object.fromEntries(Object.entries(c.meta).filter(([k]) => interesting.includes(k)));
    if (Object.keys(filtered).length) {
      out.push('', '## Meta tags relevantes');
      out.push(fmtKv(filtered));
    }
  }

  if (c.pageText) {
    out.push('', '## Texto principal extraído');
    out.push('"""');
    out.push(c.pageText.slice(0, 8000));
    out.push('"""');
  }

  out.push('', '## Pergunta do usuário');
  out.push(question);
  out.push('');
  out.push('Responda em português brasileiro, conciso e direto. Use markdown. Cite valores específicos quando relevante (font-family, hex de cor, breakpoint, framework).');
  out.push('Se a informação não está no contexto acima, **use as ferramentas MCP `inspect_element`, `query_selector` ou `eval_js`** pra buscar direto na página antes de responder. Não invente — investigue.');

  return out.join('\n');
}

function writeTempMcpConfig(mcpUrl) {
  const dir  = os.tmpdir();
  const file = path.join(dir, `brauze-mcp-${Date.now()}-${Math.random().toString(36).slice(2,8)}.json`);
  const cfg = { mcpServers: { brauze: { type: 'http', url: mcpUrl } } };
  fs.writeFileSync(file, JSON.stringify(cfg));
  return file;
}

function ask({ question, context, mcpUrl }) {
  return new Promise((resolve) => {
    const prompt = buildPrompt({ question, context });

    // Defaults baratos e rápidos: Haiku 4.5 + reasoning low + cap de loop em 5 turns.
    const args = ['-p', '--model', 'haiku', '--effort', 'low', '--max-turns', '5'];
    let mcpConfigFile = null;
    if (mcpUrl) {
      mcpConfigFile = writeTempMcpConfig(mcpUrl);
      args.push('--mcp-config', mcpConfigFile);
      args.push('--allowedTools', 'mcp__brauze__inspect_element,mcp__brauze__query_selector,mcp__brauze__eval_js');
    }

    const cleanup = () => {
      if (mcpConfigFile) { try { fs.unlinkSync(mcpConfigFile); } catch {} }
    };

    let proc;
    try {
      proc = spawn('claude', args, {
        shell: isWindows,                  // resolve .cmd no Windows
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      cleanup();
      return resolve({ ok: false, error: 'Falha ao iniciar `claude`: ' + err.message });
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; resolve(val); } };

    const killTimer = setTimeout(() => {
      try { proc.kill(); } catch {}
      cleanup();
      finish({ ok: false, error: 'Timeout: Claude não respondeu em 3 minutos.' });
    }, RUN_TIMEOUT_MS);

    proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      cleanup();
      const msg = err.code === 'ENOENT'
        ? 'Comando `claude` não encontrado. Instale o Claude Code (`npm i -g @anthropic-ai/claude-code`) ou ajuste o PATH.'
        : 'Erro ao executar Claude CLI: ' + err.message;
      finish({ ok: false, error: msg });
    });

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      cleanup();
      if (code === 0) {
        finish({ ok: true, response: stdout.trim() });
      } else {
        finish({ ok: false, error: `Claude saiu com código ${code}.\n${stderr.trim() || stdout.trim()}` });
      }
    });

    try {
      proc.stdin.write(prompt);
      proc.stdin.end();
    } catch (err) {
      cleanup();
      finish({ ok: false, error: 'Falha ao escrever prompt no stdin: ' + err.message });
    }
  });
}

module.exports = { ask };
