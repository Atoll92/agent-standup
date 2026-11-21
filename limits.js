'use strict';
// Plan limits: how much of a subscription's 5-hour and weekly windows is used, and when each resets. Read only from files on this computer; nothing is fetched.
// Claude Code (and Cowork, which runs on the same subscription), the freshest of:
//  - limits.json beside the settings, written by `agent-standup statusline` from the rate_limits Claude Code hands its status line after each answer (subscribers only);
//  - the copy Claude Code keeps in .claude.json (cachedUsageUtilization), written when it fetched your usage itself (/usage): often hours or days old.
// Codex: the rate_limits that every token_count record of its session files carries (primary and secondary windows, their length in minutes).
// A window whose reset time has passed is dropped (it started again from 0, and what it is at now is unknown), and so is a reading older than STALE.
const fs = require('fs'), path = require('path'), os = require('os');

const STALE = 12 * 3600e3;
const KEYS = { five_hour: '5h', seven_day: 'week' };
const pct = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);
const when = (v) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' ? Date.parse(v) : NaN);   // epoch seconds, epoch ms or an ISO date → ms
const keyOfMinutes = (m) => (m === 300 ? '5h' : m === 10080 ? 'week' : m >= 40000 && m <= 46000 ? 'month' : m > 0 && m < 1440 ? Math.round(m / 60) + 'h' : m > 0 ? Math.round(m / 1440) + 'd' : '');

function result(windows, asOf, src, now) {   // the windows still running, or null when none is left or the reading is too old to say anything
  if (!(asOf > 0) || now - asOf > STALE) return null;
  const w = windows.filter((x) => x && x.key && x.pct != null && x.resetsAt > now);
  return w.length ? { windows: w, asOf, src } : null;
}

// ---- Claude Code
const savedFile = (dir) => process.env.AGENT_STANDUP_LIMITS || path.join(dir, 'limits.json');
function save(dir, statusJson) {   // from the status line's JSON: keep its rate_limits, if it has any. Written only when they changed or a minute went by, so a status line redrawn often costs nothing
  const rl = statusJson && statusJson.rate_limits; if (!rl || typeof rl !== 'object') return false;
  const f = savedFile(dir), body = JSON.stringify(rl);
  try { const was = JSON.parse(fs.readFileSync(f, 'utf8')); if (was && JSON.stringify(was.rate_limits) === body && Date.now() - was.at < 60e3) return false; } catch {}
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), rate_limits: rl })); fs.renameSync(tmp, f); return true; } catch { return false; }
}
function fromSaved(dir, now) {
  let v; try { v = JSON.parse(fs.readFileSync(savedFile(dir), 'utf8')); } catch { return null; }
  const rl = (v && v.rate_limits) || {};
  return result(Object.entries(KEYS).map(([k, key]) => rl[k] && { key, pct: pct(rl[k].used_percentage), resetsAt: when(rl[k].resets_at) }), v && v.at, 'statusline', now);
}
const claudeJson = () => (process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json'));
let cacheMemo = { sig: '', v: null };
function fromCache(file, now) {   // .claude.json can weigh megabytes: parsed again only when it changed
  let sig = ''; try { const st = fs.statSync(file); sig = file + ':' + st.mtimeMs + ':' + st.size; } catch { return null; }
  if (sig !== cacheMemo.sig) { let c = null; try { c = JSON.parse(fs.readFileSync(file, 'utf8')).cachedUsageUtilization || null; } catch {} cacheMemo = { sig, v: c }; }
  const c = cacheMemo.v, u = (c && c.utilization) || {};
  return result(Object.entries(KEYS).map(([k, key]) => u[k] && { key, pct: pct(u[k].utilization), resetsAt: when(u[k].resets_at) }), c && c.fetchedAtMs, 'claude', now);
}
function claude(dir, now = Date.now(), file = claudeJson()) {
  const a = fromSaved(dir, now), b = fromCache(file, now);
  return a && b ? (a.asOf >= b.asOf ? a : b) : a || b;
}

// ---- Codex: the last record with rate_limits, in the newest session files (the end of each, where the latest is)
function fromCodexFile(file, now) {
  let text = ''; try { const st = fs.statSync(file), n = Math.min(st.size, 512 * 1024), fd = fs.openSync(file, 'r'); try { const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, st.size - n); text = buf.toString('utf8'); } finally { fs.closeSync(fd); } } catch { return null; }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]; if (!l.includes('"rate_limits"')) continue;
    let r; try { r = JSON.parse(l); } catch { continue; }
    const p = r.payload || r, rl = p.rate_limits || (p.info && p.info.rate_limits); if (!rl || !(rl.primary || rl.secondary)) continue;
    const at = when(r.timestamp) || now;
    const win = (x) => x && { key: keyOfMinutes(x.window_minutes), pct: pct(x.used_percent), resetsAt: x.resets_at != null ? when(x.resets_at) : x.resets_in_seconds != null ? at + x.resets_in_seconds * 1000 : NaN };   // older Codex said resets_in_seconds, from the record's time
    return result([win(rl.primary), win(rl.secondary)], at, 'codex', now);
  }
  return null;
}
function codex(files, now = Date.now()) {   // files: newest first, as codex.js lists them; the compressed ones are old threads and are skipped
  for (const f of files.filter((x) => !x.zst).slice(0, 3)) { const r = fromCodexFile(f.file, now); if (r) return r; }
  return null;
}

module.exports = { save, claude, codex, keyOfMinutes, STALE };
