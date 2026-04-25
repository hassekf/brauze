// Menu de contexto pro Brauze. Funciona pra webviews (com tudo) e pro chrome (mínimo).

const { Menu, MenuItem, clipboard, shell } = require('electron');

function buildWebviewMenu(contents, params, opts) {
  const menu = new Menu();
  const { onOpenInNewTab } = opts;

  // -- Link --
  if (params.linkURL) {
    menu.append(new MenuItem({
      label: 'Abrir link em nova aba',
      click: () => onOpenInNewTab(params.linkURL),
    }));
    menu.append(new MenuItem({
      label: 'Abrir link no navegador padrão',
      click: () => shell.openExternal(params.linkURL),
    }));
    menu.append(new MenuItem({
      label: 'Copiar endereço do link',
      click: () => clipboard.writeText(params.linkURL),
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // -- Imagem --
  if (params.hasImageContents) {
    menu.append(new MenuItem({
      label: 'Abrir imagem em nova aba',
      click: () => onOpenInNewTab(params.srcURL),
    }));
    menu.append(new MenuItem({
      label: 'Salvar imagem como…',
      click: () => contents.downloadURL(params.srcURL),
    }));
    menu.append(new MenuItem({
      label: 'Copiar imagem',
      click: () => contents.copyImageAt(params.x, params.y),
    }));
    menu.append(new MenuItem({
      label: 'Copiar URL da imagem',
      click: () => clipboard.writeText(params.srcURL),
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // -- Texto selecionado --
  if (params.selectionText && params.selectionText.trim()) {
    const sel = params.selectionText.trim();
    const preview = sel.length > 30 ? sel.slice(0, 30) + '…' : sel;
    menu.append(new MenuItem({ label: 'Copiar', role: 'copy' }));
    menu.append(new MenuItem({
      label: `Buscar "${preview}" no Google`,
      click: () => onOpenInNewTab(
        'https://www.google.com/search?q=' + encodeURIComponent(sel)
      ),
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // -- Campo editável --
  if (params.isEditable) {
    menu.append(new MenuItem({ label: 'Recortar', role: 'cut' }));
    menu.append(new MenuItem({ label: 'Copiar',   role: 'copy' }));
    menu.append(new MenuItem({ label: 'Colar',    role: 'paste' }));
    menu.append(new MenuItem({ label: 'Selecionar tudo', role: 'selectAll' }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // -- Navegação (sempre) --
  menu.append(new MenuItem({
    label: 'Voltar',
    enabled: contents.canGoBack(),
    click: () => contents.goBack(),
  }));
  menu.append(new MenuItem({
    label: 'Avançar',
    enabled: contents.canGoForward(),
    click: () => contents.goForward(),
  }));
  menu.append(new MenuItem({
    label: 'Recarregar',
    click: () => contents.reload(),
  }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({
    label: 'Ver código-fonte',
    click: () => onOpenInNewTab('view-source:' + contents.getURL()),
  }));
  menu.append(new MenuItem({
    label: 'Inspecionar elemento',
    click: () => contents.inspectElement(params.x, params.y),
  }));

  return menu;
}

function buildChromeMenu(_contents, params) {
  const menu = new Menu();

  if (params.isEditable) {
    menu.append(new MenuItem({ label: 'Recortar', role: 'cut' }));
    menu.append(new MenuItem({ label: 'Copiar',   role: 'copy' }));
    menu.append(new MenuItem({ label: 'Colar',    role: 'paste' }));
    menu.append(new MenuItem({ label: 'Selecionar tudo', role: 'selectAll' }));
    return menu;
  }

  if (params.selectionText && params.selectionText.trim()) {
    menu.append(new MenuItem({ label: 'Copiar', role: 'copy' }));
    return menu;
  }

  // Fora de um editável/seleção, no chrome do Brauze: oferece inspect.
  menu.append(new MenuItem({
    label: 'Inspecionar interface do Brauze',
    click: () => _contents.openDevTools({ mode: 'detach' }),
  }));
  return menu;
}

function attach({ onOpenInNewTab }) {
  return (contents) => {
    contents.on('context-menu', (_event, params) => {
      const isWebview = contents.getType() === 'webview';
      const menu = isWebview
        ? buildWebviewMenu(contents, params, { onOpenInNewTab })
        : buildChromeMenu(contents, params);
      if (menu.items.length > 0) menu.popup();
    });
  };
}

module.exports = { attach };
