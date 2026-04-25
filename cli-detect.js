// Detecta CLIs de IA instaladas no PATH do usuário.
// Não importa qual versão está instalada; só nos importa "está disponível".

const { exec } = require('child_process');
const os = require('os');

const isWindows = os.platform() === 'win32';
const LOOKUP_CMD = isWindows ? 'where' : 'which';

// Cada CLI tem `variants` — formas diferentes de lançar.
// O usuário escolhe a default (gravada em localStorage no renderer).
const KNOWN_CLIS = [
  {
    id: 'claude',
    bin: 'claude',
    label: 'Claude Code',
    icon: 'C',
    variants: [
      { id: 'safe',      label: 'Padrão',                          command: 'claude' },
      { id: 'dangerous', label: 'Skip permissions (--dangerously)', command: 'claude --dangerously-skip-permissions' },
    ],
    defaultVariant: 'safe',
  },
  { id: 'codex',  bin: 'codex',        label: 'OpenAI Codex',  icon: '◎',  variants: [{ id: 'default', label: 'Padrão', command: 'codex' }] },
  { id: 'aider',  bin: 'aider',        label: 'Aider',         icon: 'A',  variants: [{ id: 'default', label: 'Padrão', command: 'aider' }] },
  { id: 'gemini', bin: 'gemini',       label: 'Gemini CLI',    icon: '✦',  variants: [{ id: 'default', label: 'Padrão', command: 'gemini' }] },
  { id: 'cursor', bin: 'cursor-agent', label: 'Cursor Agent',  icon: '⌘',  variants: [{ id: 'default', label: 'Padrão', command: 'cursor-agent' }] },
  { id: 'cody',   bin: 'cody',         label: 'Cody',          icon: '◈',  variants: [{ id: 'default', label: 'Padrão', command: 'cody chat' }] },
  { id: 'aichat', bin: 'aichat',       label: 'aichat',        icon: '💬', variants: [{ id: 'default', label: 'Padrão', command: 'aichat' }] },
  { id: 'llm',    bin: 'llm',          label: 'simonw/llm',    icon: '🦙', variants: [{ id: 'default', label: 'Padrão', command: 'llm' }] },
  { id: 'gh',     bin: 'gh',           label: 'GitHub Copilot',icon: '🐙', variants: [{ id: 'default', label: 'Padrão', command: 'gh copilot suggest' }] },
];

function which(bin) {
  return new Promise((resolve) => {
    exec(`${LOOKUP_CMD} ${bin}`, { timeout: 1500 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const path = stdout.toString().split(/\r?\n/)[0].trim();
      resolve(path || null);
    });
  });
}

async function detect() {
  const results = await Promise.all(KNOWN_CLIS.map(async (cli) => {
    const path = await which(cli.bin);
    return path ? { ...cli, path } : null;
  }));
  return results.filter(Boolean);
}

module.exports = { detect, KNOWN_CLIS };
