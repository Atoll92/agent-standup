// reply.js: the human's line, typed into the tmux pane of a running Claude Code session. Off unless AGENT_STANDUP_REPLY=on.
// Claude Code writes <config>/sessions/<pid>.json for each running session (pid, sessionId, status, name); the pane is the tmux pane whose shell is an ancestor of that pid.
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net'), { execFile } = require('child_process');
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
  if (process.platform !== 'linux') return { ok: false, why: 'platform' };   // the pane is found through /proc: Linux only for now
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
  if (process.platform !== 'linux') return { error: 'platform' };
  let t = clean(text); if (!t || t.length > 4000) return { error: 'text' };
  if (t.endsWith(';')) t += ' ';   // tmux reads a final ; of an argument as the end of the command
  const r = await lookup(id); if (!r.ok) return { error: r.why };
  if (r.status !== 'idle') return { error: r.status === 'waiting' ? 'waiting' : 'busy' };   // only at the prompt: a permission menu open (waiting) or one that opens during a turn would take the text and Enter as its answer
  if ((await tmux(['send-keys', '-t', r.pane, '-l', '--', t])) == null) return { error: 'tmux' };   // -l: literal text, never read as key names
  const now = await lookup(id); if (!now.ok || now.pane !== r.pane || now.status !== 'idle') return { error: 'changed' };   // read again right before Enter: if a turn or a menu started meanwhile, the text stays in the prompt without Enter
  if ((await tmux(['send-keys', '-t', r.pane, 'Enter'])) == null) return { error: 'tmux' };
  return { ok: true };
}
// Who is calling: the uid owning the client end of the loopback connection, from /proc/net/tcp (Linux). null when not found: refused.
const tcpKey = (ip, port, v6) => (v6 ? '0000000000000000FFFF0000' : '') + ip.split('.').reverse().map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase() + ':' + port.toString(16).toUpperCase().padStart(4, '0');   // each 32-bit word little-endian, the port big-endian
const uidIn = (table, local, rem) => { for (const l of table.split('\n').slice(1)) { const c = l.trim().split(/\s+/); if (c[1] === local && c[2] === rem && c[3] === '01' && /^\d+$/.test(c[7])) return +c[7]; } return null; };   // 01: ESTABLISHED; a TIME_WAIT row (06) of a former connection on the same ports is owned by uid 0
function peerUid(sock) {   // ponytail: IPv4 only, the server listens on 127.0.0.1; a pure IPv6 peer (::1) would need the tcp6 address expanded
  const v4 = (a) => String(a || '').replace(/^::ffff:/i, ''), ra = v4(sock.remoteAddress), la = v4(sock.localAddress);
  if (process.platform !== 'linux' || !net.isIPv4(ra) || !net.isIPv4(la)) return null;
  for (const v6 of [false, true]) { let t = ''; try { t = fs.readFileSync(v6 ? '/proc/net/tcp6' : '/proc/net/tcp', 'utf8'); } catch {} const u = uidIn(t, tcpKey(ra, sock.remotePort, v6), tcpKey(la, sock.localPort, v6)); if (u != null) return u; }
  return null;
}
module.exports = { on, lookup, send, clean, tcpKey, uidIn, peerUid };
