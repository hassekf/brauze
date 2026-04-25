# Brauze — Roadmap de ideias

Lugar pra registrar features que queremos explorar. Não é compromisso de prioridade, é memória de ideias.

Legenda de complexidade:
- 🟢 baixa (horas / 1 dia)
- 🟡 média (alguns dias)
- 🔴 alta (semanas / depende de pesquisa)

---

## 🌟 Visão / Norte

Brauze é um browser **pra quem desenvolve e/ou trabalha com IA**. Posicionamento: ferramenta de produtividade que enxerga o browser como **ambiente de trabalho programável**, não como visualizador passivo de páginas. Diferenciais frente a Chrome/Brave/Arc:

- Vê todas as páginas + tem acesso local (terminal, FS, processos)
- IA-nativa, não AI-bolt-on
- Privacidade e controle do usuário antes de qualquer modelo de negócio

---

## 🛠️ Features pra devs

### Project Radar 🟢 ← em desenvolvimento agora
Brauze faz healthcheck silencioso em portas conhecidas (3000, 5173, 8000, 8080, 4200, 8888, 80, 443...) e mostra dashboard dos serviços rodando localmente.

**Identificação de serviço sem hardcoding de pastas:**
- HTTP probe: `Server` header, conteúdo da home, `/__vite__`, `/_next/static`, signatures de framework
- (Futuro) Introspecção do processo via OS: PID que escuta a porta → nome do processo + cwd via `netstat/lsof` + `wmic/ps`. Universal, funciona pra qualquer setup, não precisa user configurar nada.
- Usuário pode adicionar "watched folders" via settings se quiser correlação manual.

### Console persistente por domínio 🟡
Drawer com console JS persistente por site. Histórico que sobrevive sessão, snippets nomeados, autocomplete contra `window` real, suporte a comandos shell (`>$ git status`).

### Right-click → "copiar como X" 🟡
- Tabela HTML → CSV / SQL CREATE / Markdown / pandas
- Linha de tabela → JSON / cURL
- JSON da DevTools → TS interface / Zod / Pydantic
- Form preenchido → cURL / fetch() / Postman
- Página inteira → Markdown limpo

### Workflow recorder 🔴
Grava sequência de cliques/inputs e gera: snippet auto-executável por URL, comando nomeado headless, ou teste Playwright.

### SSL sempre confiável em localhost 🟢
Auto-trust em certs self-signed de `localhost`, `*.local`, `*.test`. Adeus tela vermelha em dev local.

### Time-travel debug 🔴
Grava DOM + network + console a cada N segundos. Scrubba a timeline pra achar momento exato em que estado mudou. Funciona em qualquer app sem instrumentar.

### View-source com IA deobfuscando 🟡
JS minificado em produção passa por LLM que rebatiza variáveis e organiza. Lê código de SaaS como fonte.

### Terminal embutido 🟡
`node-pty` + `xterm.js`. Painel inferior toggleável (`Ctrl+\``). Possíveis variações: terminal por aba, auto-cd pro projeto que casa com o `localhost:porta` aberto.

---

## 🤖 Features pra IA

### `prompt://` URL bar 🟡
URL bar aceita comandos em linguagem natural. `prompt://por que essa página tá lenta?` → IA recebe DOM + screenshot + URL como contexto automático.

### Agente que opera o browser 🔴
Linguagem natural → ações no browser. "Abre 3 abas com casas no Zap, cruza com preço/m², monta tabela." Roda no browser do usuário, com seus logins.

### Network listener com IA 🟡
Background. Detecta padrões estranhos: 500s repetidos, JWT prestes a expirar, race conditions em fetches duplicados.

### MCP host nativo 🔴
Brauze é cliente MCP. Plugins (Linear, GitHub, Postgres, Notion). IA em qualquer aba acessa todas as tools. **Nenhum browser faz isso.**

### Pair programmer com contexto total 🔴
Drawer de IA com: DOM ativo + network log + `cwd` do terminal + arquivos recentes em disco + console errors. Cruza pra responder "por que esse form não envia?".

### Memória semântica de history 🟡
Tudo que você navega vira embeddings locais (modelo tipo nomic-embed). "Aquele artigo sobre soft delete que vi mês passado" → encontra.

### AI-generated UI sobre sites feios 🔴
Site institucional ruim → você diz "só me dá telefone e endereço" → IA scrapeia e gera mini-app local. Brauze passa a abrir a versão minimal automaticamente.

---

## 💡 Features "fora da caixa" (consumidor / experimentais)

### Brauze Rewind — DVR de qualquer página 🔴
Snapshot DOM + screenshot a cada N segundos / em eventos. Timeline scrubbable. Casos: rascunho perdido em SaaS, "como tava o Twitter terça às 21h?", debug de SPA.

### Lenses — userscripts cidadãos de primeira classe 🟡
"Modo lente": seleciona elementos com mouse e diz o que fazer ("essa headline cresce, esse banner some"). Vira arquivo `.lens` reutilizável e compartilhável. Bônus: lenses geradas por IA.

### Tabs como pipes (Unix no browser) 🔴
Arrasta conteúdo de uma aba pra outra; browser detecta tipo. CSV → ChatGPT, JSON → jq.online, imagem → busca visual. Sites como pipes.

### Anti-doomscroll hostil 🟢
Domínios marcados como "ralo de tempo" degradam progressivamente: blur leve aos 5min, B&W aos 10min, scroll lento aos 15min. Browser briga PELO usuário.

### Canvas tabs (espacial) 🔴
Apaga a fila de abas. `Ctrl+\` → abas viram retângulos arrastáveis num canvas infinito. Zoom-out vê tudo, zoom-in entra na página. Tabs por região = projeto.

---

## 📦 Plataforma / distribuição

### Empacotamento cross-platform 🟡
`electron-builder` configurado pra Windows/macOS/Linux. `npm run dist` cospe instaladores.

### Code signing macOS 🟡
Apple Developer cert + notarização. Necessário pra distribuição pública sem warning.

### Auto-update 🟡
`electron-updater` com hosting (GitHub Releases ou S3).

---

## ⚙️ UX / Plumbing pendente

### Tela de configurações 🟡
Brauze hoje não tem painel de settings. Precisa pelo menos:
- Lista de portas customizáveis (Project Radar) + opção de range (`8000-8010`)
- Homepage padrão
- Toggle de auto-scan / intervalo
- Limpar cache / cookies
- (Futuro) atalhos customizáveis, perfis

**Idéia de acesso**: ícone ⚙ na status bar à direita, abre uma página interna `brauze://settings` (ou um modal sobre a UI).

### Menu de contexto (right-click) 🟢
Electron não vem com menu de contexto nem na chrome nem no `<webview>`. Precisa implementar via `Menu` API do main process. Mínimo:
- No webview: Voltar / Avançar / Recarregar / Inspecionar / Copiar / Colar
- Em link: Abrir em nova aba / Copiar URL
- Em imagem: Salvar / Copiar
- Em texto selecionado: Copiar / Buscar no Google
- Na barra de endereço/aba: comportamento nativo (já vem)

Pode usar `electron-context-menu` (lib pronta) ou implementar do zero pra ter controle total.

---

## 🧱 Trabalho técnico de base (provável que precise antes de várias features)

- IPC seguro main↔renderer com canais nomeados
- Sistema de "status bar items" no rodapé (Project Radar, terminal, IA, etc. cada um reserva slot)
- Storage local (SQLite via `better-sqlite3` para Rewind, history semântica, lenses)
- Sistema de plugins/extensões interno (pra MCP, lenses)
- Sandbox por aba vs main process boundaries claras
