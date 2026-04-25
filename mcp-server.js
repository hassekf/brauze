// MCP server HTTP que expõe tools pra Claude inspecionar a página ativa do Brauze.
// Server roda no main process; tools delegam pro callback runInPage que executa
// JS no webview ativo via webContents.executeJavaScript.

const express = require('express');
const { randomUUID } = require('node:crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const { z } = require('zod');

// ---- JS templates pra cada tool ----

function js_inspect(selector) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const wanted = ['display','position','top','left','right','bottom','width','height',
      'background-color','background-image','color','opacity','font-family','font-size',
      'font-weight','line-height','letter-spacing','text-align','padding','margin','border',
      'border-radius','box-shadow','transform','transition','cursor','z-index','overflow'];
    const styles = {};
    for (const p of wanted) styles[p] = cs.getPropertyValue(p);
    const attrs = {};
    for (const a of el.attributes) attrs[a.name] = a.value;
    const r = el.getBoundingClientRect();
    return {
      found: true,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classList: Array.from(el.classList),
      text: (el.innerText || '').slice(0, 300),
      attrs,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      styles,
    };
  })()`;
}

function js_query(selector, limit) {
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
  return `(() => {
    const els = document.querySelectorAll(${JSON.stringify(selector)});
    const out = [];
    for (let i = 0; i < els.length && i < ${lim}; i++) {
      const el = els[i];
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classList: Array.from(el.classList),
        text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100),
      });
    }
    return { totalMatches: els.length, returned: out.length, items: out };
  })()`;
}

function js_eval(code) {
  return `(() => {
    try {
      const result = (function() { return (${code}); })();
      if (typeof result === 'undefined') return { ok: true, type: 'undefined', value: null };
      if (result === null) return { ok: true, type: 'null', value: null };
      if (typeof result === 'object') {
        const json = JSON.stringify(result, (k, v) => {
          if (v instanceof Element) return '<' + v.tagName.toLowerCase() + (v.id ? '#'+v.id : '') + '>';
          if (v instanceof Window || v instanceof Document) return '[' + v.constructor.name + ']';
          return v;
        }, 2);
        return { ok: true, type: typeof result, value: (json || '').slice(0, 5000) };
      }
      return { ok: true, type: typeof result, value: String(result).slice(0, 5000) };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  })()`;
}

// ---- McpServer factory ----

function buildMcpServer({ runInPage }) {
  const server = new McpServer({ name: 'brauze', version: '0.2.0' });

  server.registerTool('inspect_element', {
    title: 'Inspecionar elemento',
    description: 'Retorna tag, atributos, classList, posição (rect) e computed styles principais de UM elemento que casa com o seletor CSS. Use pra perguntas tipo "qual a cor do botão X?", "qual a fonte do título?".',
    inputSchema: { selector: z.string().describe('CSS selector, ex: ".btn-primary", "#header h1"') },
  }, async ({ selector }) => {
    const result = await runInPage(js_inspect(selector));
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('query_selector', {
    title: 'Listar elementos por seletor',
    description: 'Lista até `limit` elementos que casam com o seletor CSS, retornando tag, id, classes e texto curto. Use pra "quantos botões tem?", "que itens estão na lista?".',
    inputSchema: {
      selector: z.string().describe('CSS selector'),
      limit: z.number().int().min(1).max(100).optional().describe('máximo de itens (default 20)'),
    },
  }, async ({ selector, limit }) => {
    const result = await runInPage(js_query(selector, limit));
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('eval_js', {
    title: 'Executar JS na página',
    description: 'Executa uma expressão JavaScript arbitrária no contexto da página ativa e retorna o resultado serializado. Escape hatch quando inspect/query não bastam. Ex: "document.body.scrollHeight", "Array.from(document.images).map(i => i.src)".',
    inputSchema: { code: z.string().describe('expressão JS pra avaliar') },
  }, async ({ code }) => {
    const result = await runInPage(js_eval(code));
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}

// ---- HTTP server orquestrando sessões MCP ----

async function start({ runInPage }) {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const transports = {};

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    let transport;
    try {
      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports[sid] = transport; },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) delete transports[sid];
        };
        const server = buildMcpServer({ runInPage });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Sessão inválida ou ausente' },
          id: null,
        });
        return;
      }
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] POST error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Erro interno: ' + (err.message || err) },
          id: null,
        });
      }
    }
  });

  const sessionRouter = async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Sessão inválida');
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  };
  app.get('/mcp', sessionRouter);
  app.delete('/mcp', sessionRouter);

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(0, '127.0.0.1', () => {
      const actualPort = httpServer.address().port;
      resolve({
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}/mcp`,
        stop: () => new Promise((r) => {
          // Fecha transports antes de derrubar o server.
          for (const sid of Object.keys(transports)) {
            try { transports[sid].close(); } catch {}
            delete transports[sid];
          }
          httpServer.close(() => r());
        }),
      });
    });
    httpServer.once('error', reject);
  });
}

module.exports = { start };
