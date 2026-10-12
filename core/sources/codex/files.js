// Where Codex keeps its sessions on disk, and what its files say about them (the thread's folder, its name, whether it is the person's turn).
// Codex writes one "rollout" file per thread in <home>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl. Nothing is ever written there, and nothing else
// in the Codex folder is read but session_index.jsonl (the names of the threads).
// All Codex sessions are listed under one made-up project, PROJ. No Claude Code project folder can have that name: theirs are paths with every other character turned into "-".
const fs = require('fs'), os = require('os'), path = require('path');
const PROJ = '_codex';
const dirKey = (cwd) => String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');   // the name Claude Code gives the same folder: how "this project" is asked for everywhere else

const NAME = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
// ---- helpers that need no state
function firstLine(file, max = 1024 * 1024) {
  let fd; try {
    fd = fs.openSync(file, 'r'); const parts = []; let pos = 0;
    while (pos < max) { const buf = Buffer.alloc(64 * 1024), n = fs.readSync(fd, buf, 0, buf.length, pos); if (!n) break; const nl = buf.subarray(0, n).indexOf(10); if (nl >= 0) { parts.push(buf.subarray(0, nl)); return { text: Buffer.concat(parts).toString('utf8'), whole: true }; } parts.push(buf.subarray(0, n)); pos += n; }
    return { text: Buffer.concat(parts).toString('utf8'), whole: false, capped: pos >= max };
  } catch { return { text: '', whole: false }; } finally { if (fd != null) fs.closeSync(fd); }
}
const projectLabel = (cwd) => { const h = os.homedir(), rel = cwd && cwd.startsWith(h + path.sep) ? cwd.slice(h.length + 1) : cwd; return 'Codex' + (rel ? ' · ' + rel.split(path.sep).join('/') : ''); };


// ---- the reader
// One reader of Codex sessions. `home` is the folder Codex keeps its files in (null: Codex sessions are off).
// The list of files is looked at again at most every `scanTtlMs`: all the polls of those two seconds share one look.
// What it has found, and what it has read of each file, is kept in this reader and nowhere else.
function createCodexFiles({ home = null, scanTtlMs = 2000 } = {}) {
  let memo = { at: 0, rows: [], byId: new Map() };
  function scan() {   // every rollout file with its date and size, newest first
    const now = Date.now(); if (now - memo.at < scanTtlMs) return memo;
    const rows = [], byId = new Map();
    const walk = (dir, depth) => {
      let names; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of names) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < 4) walk(fp, depth + 1); continue; }
        const m = NAME.exec(e.name); if (!m) continue;
        let st; try { st = fs.statSync(fp); } catch { continue; }
        const row = { id: m[1].toLowerCase(), file: fp, mtime: st.mtimeMs, size: st.size }; rows.push(row); byId.set(row.id, row);
      }
    };
    if (home) walk(path.join(home, 'sessions'), 0);
    rows.sort((a, b) => b.mtime - a.mtime);
    memo = { at: now, rows, byId }; return memo;
  }
  const row = (id) => scan().byId.get(String(id).toLowerCase()) || null;
  const fileOf = (id) => { const r = row(id); return r ? r.file : null; };

  // ---- the first line of a file says what the thread is: its folder, and whether another thread started it
  const headCache = new Map();   // file → { ok, cwd, dir, child } (the first line never changes)
  function head(file) {
    const hit = headCache.get(file); if (hit) return hit;
    const { text, whole, capped } = firstLine(file); let out = { ok: false, cwd: '', dir: '', child: false };
    if (!text) return out;   // not written yet: looked at again next time
    let p = null; try { const r = JSON.parse(text); if (r && r.type === 'session_meta' && r.payload && typeof r.payload === 'object') p = r.payload; } catch {}
    if (p) out = { ok: true, cwd: typeof p.cwd === 'string' ? p.cwd : '', child: !!p.parent_thread_id || !!(p.source && typeof p.source === 'object' && p.source.subagent) };
    else if (capped && /^\{"timestamp":"[^"]*","(?:ordinal":\d+,")?type":"session_meta"/.test(text)) {   // a first line longer than what was read: the two facts, without the rest
      const cwd = text.match(/"cwd":"((?:[^"\\]|\\.)*)"/); let c = ''; try { c = cwd ? JSON.parse('"' + cwd[1] + '"') : ''; } catch {}
      out = { ok: true, cwd: c, child: /"parent_thread_id":"[^"]+"/.test(text) || /"source":\{"subagent"/.test(text) };
    }
    out.dir = dirKey(out.cwd);
    if (whole || capped) { if (headCache.size > 5000) headCache.clear(); headCache.set(file, out); }   // a first line still being written is read again next time
    return out;
  }
  // The threads a person started, newest first. A thread started by another thread (Codex's review of a command before it runs, a sub-agent) is not a session of its own.
  function sessions(limit = 80) {
    const out = []; for (const r of scan().rows) { const h = head(r.file); if (!h.ok || h.child) continue; out.push({ ...r, cwd: h.cwd, dir: h.dir }); if (out.length >= limit) break; }
    return out;
  }
  const inProject = (id, key) => { const r = row(id); if (!r || !key) return false; if (key === PROJ) return true; const d = head(r.file).dir; return d === key || d.startsWith(key + '-'); };
  return { home, sessions, row, fileOf, inProject };
}

module.exports = { PROJ, projectLabel, createCodexFiles };
