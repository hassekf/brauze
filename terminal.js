// Wrapper em volta do node-pty pra criar/gerenciar pseudoterminais.
// Suporta múltiplas sessões simultâneas, identificadas por id numérico.

const os = require('os');

let pty;
try {
  pty = require('@lydell/node-pty');
} catch (err) {
  console.error('[terminal] falha ao carregar node-pty:', err.message);
  pty = null;
}

const isWindows = os.platform() === 'win32';

function defaultShell() {
  if (isWindows) return process.env.COMSPEC || 'powershell.exe';
  return process.env.SHELL || '/bin/bash';
}

function defaultCwd() {
  return process.env.HOME || process.env.USERPROFILE || process.cwd();
}

class TerminalSession {
  constructor({ cols = 80, rows = 24, cwd, env, shell } = {}) {
    if (!pty) throw new Error('node-pty não está disponível');

    this.proc = pty.spawn(shell || defaultShell(), [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || defaultCwd(),
      env: { ...process.env, ...(env || {}), TERM: 'xterm-256color' },
    });

    this._dataHandlers = [];
    this._exitHandlers = [];

    this.proc.onData((data) => this._dataHandlers.forEach((cb) => cb(data)));
    this.proc.onExit(({ exitCode, signal }) => {
      this._exitHandlers.forEach((cb) => cb({ exitCode, signal }));
    });
  }

  write(data)        { try { this.proc.write(data); } catch {} }
  resize(cols, rows) { try { this.proc.resize(cols, rows); } catch {} }
  kill()             { try { this.proc.kill(); } catch {} }

  onData(cb) { this._dataHandlers.push(cb); }
  onExit(cb) { this._exitHandlers.push(cb); }
}

const sessions = new Map();
let nextId = 1;

function create(opts) {
  const id = nextId++;
  const sess = new TerminalSession(opts);
  sessions.set(id, sess);
  return { id, session: sess };
}

function get(id)  { return sessions.get(id); }
function kill(id) {
  const s = sessions.get(id);
  if (s) { s.kill(); sessions.delete(id); }
}
function killAll() { for (const id of sessions.keys()) kill(id); }

module.exports = { create, get, kill, killAll, available: !!pty };
