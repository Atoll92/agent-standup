// The person's own `claude` command line, used for translations and quips (it brings the person's existing login).
// Found once: an explicit setting, then PATH, then the usual install folders, then the copy bundled with the VS Code extension.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

// The newest `claude` binary shipped inside an installed Claude Code editor extension (VS Code, Insiders, Cursor, Windsurf, VSCodium).
function bundledClaude() {
  const home = os.homedir();
  let best = null;
  for (const editorDir of ['.vscode', '.vscode-insiders', '.cursor', '.windsurf', '.vscode-oss']) {
    let extensions;
    try { extensions = fs.readdirSync(path.join(home, editorDir, 'extensions')); } catch { continue; }
    for (const extension of extensions.filter((name) => name.startsWith('anthropic.claude-code-'))) {
      for (const binary of ['claude', 'claude.exe']) {
        const file = path.join(home, editorDir, 'extensions', extension, 'resources', 'native-binary', binary);
        if (isFile(file) && (!best || extension.localeCompare(best.extension, undefined, { numeric: true }) > 0)) best = { extension, file };
      }
    }
  }
  return best && best.file;
}

class ClaudeCli {
  #found = null;

  constructor() {
    this.lastError = '';   // what went wrong last, for the page's health check: 'not-found', or what claude said
  }

  find() {
    if (this.#found && isFile(this.#found)) return this.#found;
    const home = os.homedir(), windows = process.platform === 'win32', names = windows ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude'], candidates = [];
    if (process.env.AGENT_STANDUP_CLAUDE) candidates.push(process.env.AGENT_STANDUP_CLAUDE);
    for (const dir of (process.env.PATH || '').split(path.delimiter)) for (const name of names) candidates.push(path.join(dir, name));
    const usualDirs = windows
      ? [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude')]
      : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.claude/local'), path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), path.join(home, '.bun/bin'), path.join(home, '.volta/bin')];
    try { const nvm = path.join(home, '.nvm', 'versions', 'node'); for (const version of fs.readdirSync(nvm)) usualDirs.push(path.join(nvm, version, 'bin')); } catch {}
    for (const dir of usualDirs) for (const name of names) candidates.push(path.join(dir, name));
    return (this.#found = candidates.find(isFile) || bundledClaude() || null);
  }

  // A running `claude` with these arguments, or null when there is none to run.
  spawn(args, options) {
    const binary = this.find();
    if (!binary) { this.lastError = 'not-found'; return null; }
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary)) return spawn('"' + binary + '"', args, { ...options, shell: true, windowsHide: true });   // npm's Windows shims need a shell
    return spawn(binary, args, { ...options, windowsHide: true });
  }
}

module.exports = { ClaudeCli, bundledClaude };
