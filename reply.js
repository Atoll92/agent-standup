// reply.js: the human's line, typed into the tmux pane of a running Claude Code session. Off unless AGENT_STANDUP_REPLY=on.
// Claude Code writes <config>/sessions/<pid>.json for each running session (pid, sessionId, status, name); the pane is the tmux pane whose shell is an ancestor of that pid.
const fs = require('fs'), path = require('path'), os = require('os'), { execFile } = require('child_process');
const on = () => /^(1|on|yes|true)$/i.test(process.env.AGENT_STANDUP_REPLY || '');
const dir = () => process.env.AGENT_STANDUP_CC_SESSIONS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'sessions');
const tmux = (args) => new Promise((resolve) => execFile(process.env.AGENT_STANDUP_TMUX || 'tmux', args, { timeout: 3000, windowsHide: true }, (err, out) => resolve(err ? null : String(out))));
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function session(id) {   // the running session with this id, or null
  let names = []; try { names = fs.readdirSync(dir()); } catch {}
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue;
    try { const s = JSON.parse(fs.readFileSync(path.join(dir(), n), 'utf8')); if (s && s.sessionId === id && Number.isInteger(s.pid)) return s; } catch {}
  }
  return null;
}
const stat = (pid) => { try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2).split(' '); } catch { return []; } };   // fields from 3 on; the name in field 2 may hold spaces and brackets
const ppid = (pid) => +stat(pid)[1] || 0;   // field 4
async function lookup(id) {
  const s = ID.test(String(id || '')) ? session(id) : null; if (!s) return { ok: false, why: 'none' };
  if (stat(s.pid)[19] !== String(s.procStart)) return { ok: false, why: 'none' };   // field 22 is the start time: a different one means the pid now belongs to another process
  const who = { status: String(s.status || ''), name: String(s.name || '') }, out = await tmux(['list-panes', '-a', '-F', '#{pane_id} #{pane_pid}']);
  if (out == null) return { ok: false, why: 'tmux', ...who };
  const panes = new Map(out.trim().split('\n').map((l) => l.split(' ')).filter((p) => /^%\d+$/.test(p[0])).map(([p, pid]) => [+pid, p]));
  for (let pid = s.pid, n = 0; pid > 1 && n < 64; pid = ppid(pid), n++) if (panes.has(pid)) return { ok: true, pane: panes.get(pid), ...who };
  return { ok: false, why: 'notmux', ...who };
}
const clean = (t) => (typeof t === 'string' ? t.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim() : '');   // a newline would send a second message, an escape sequence would drive the terminal
async function send(id, text) {
  let t = clean(text); if (!t || t.length > 4000) return { error: 'text' };
  if (t.endsWith(';')) t += ' ';   // tmux reads a final ; of an argument as the end of the command
  const r = await lookup(id); if (!r.ok) return { error: r.why };
  if (r.status === 'waiting') return { error: 'waiting' };   // a permission menu is open: typed text and Enter would answer it
  if ((await tmux(['send-keys', '-t', r.pane, '-l', '--', t])) == null) return { error: 'tmux' };   // -l: literal text, never read as key names
  if ((await tmux(['send-keys', '-t', r.pane, 'Enter'])) == null) return { error: 'tmux' };
  return { ok: true };
}
module.exports = { on, lookup, send, clean };
