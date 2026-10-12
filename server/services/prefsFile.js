// The page's settings, kept in a file and not only in the page's localStorage: the port changes between VS Code windows and reloads,
// and localStorage belongs to one origin (port included). Every window reads the same file.
const fs = require('fs'), os = require('os'), path = require('path');

function defaultPrefsPath(env = process.env) {
  if (env.AGENT_STANDUP_PREFS) return env.AGENT_STANDUP_PREFS;
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'agent-standup', 'prefs.json');
  return path.join(os.homedir(), '.config', 'agent-standup', 'prefs.json');
}

class PrefsFile {
  constructor(file) { this.file = file; }

  // The settings, or null when there are none (or they are not an object).
  read() {
    try {
      const prefs = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : null;
    } catch { return null; }
  }

  // Written to a file of its own, then renamed: a window reading at the same time never sees half of it.
  write(prefs) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const partial = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(partial, JSON.stringify(prefs, null, 1));
    fs.renameSync(partial, this.file);
  }
}

module.exports = { PrefsFile, defaultPrefsPath };
