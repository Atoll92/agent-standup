// What Codex sessions are doing: the name of each thread, and whether it is the agent's turn or the person's, read from the end of the rollout file.
const fs = require('fs'), path = require('path');
const { PROJ, projectLabel } = require('./files');
const { typed, partsText } = require('./text');

const MAX_BOARD_ROWS = 20;   // rows on the board
const MAX_LISTED = 30;       // sessions in the list to pick from

// `files` is what createCodexFiles gives. What has been read of each file is kept in the board that is created here, and nowhere else.
function createCodexBoard({ files }) {
  const home = files.home;
  // ---- names: the one Codex gave the thread (session_index.jsonl, the last line for an id wins), else the first thing the person typed
  let names = { sig: '', map: new Map() };
  function threadNames() {
    if (!home) return names.map;
    const f = path.join(home, 'session_index.jsonl'); let st; try { st = fs.statSync(f); } catch { return names.map; }
    const sig = f + ':' + st.mtimeMs + ':' + st.size; if (sig === names.sig) return names.map;
    const map = new Map(); try { for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l) continue; try { const j = JSON.parse(l); if (j && j.id && typeof j.thread_name === 'string' && j.thread_name.trim()) map.set(String(j.id).toLowerCase(), j.thread_name.trim()); } catch {} } } catch {}
    names = { sig, map }; return map;
  }
  const promptCache = new Map();   // file → the first prompt ('' = looked for in the first megabyte and not there)
  function firstPrompt(r) {
    const hit = promptCache.get(r.file); if (hit != null) return hit;
    let text = ''; try { const fd = fs.openSync(r.file, 'r'); try { const buf = Buffer.alloc(Math.min(1024 * 1024, r.size)); fs.readSync(fd, buf, 0, buf.length, 0); text = buf.toString('utf8'); } finally { fs.closeSync(fd); } } catch {}
    let out = '';
    for (const l of text.split('\n')) {
      if (!l.includes('"UserMessage"') && !l.includes('"user_message"')) continue; let j; try { j = JSON.parse(l); } catch { continue; }
      const p = (j && j.payload) || {}, t = p.type === 'user_message' ? typed(p.message) : p.type === 'item_completed' && p.item && p.item.type === 'UserMessage' ? typed(partsText(p.item.content)) : '';
      if (t) { out = t.replace(/\s+/g, ' ').slice(0, 90); break; }
    }
    if (out || r.size > 64 * 1024) { if (promptCache.size > 2000) promptCache.clear(); promptCache.set(r.file, out); }   // a file that has just been created is looked at again
    return out;
  }
  const title = (r) => threadNames().get(r.id) || firstPrompt(r) || r.id;

  // ---- the board: is the agent in the middle of a turn, or is it the person's turn? Read from the end of the file.
  const tailCache = new Map();
  function boardRow(r, now) {
    const sig = r.mtime + ':' + r.size; let t = tailCache.get(r.file);
    if (!t || t.sig !== sig) {
      t = { sig, turn: '' };
      try {
        const fd = fs.openSync(r.file, 'r'); let text = ''; try { const n = Math.min(128 * 1024, r.size), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, r.size - n); text = buf.toString('utf8'); } finally { fs.closeSync(fd); }
        for (const l of text.split('\n')) { const m = /"type":"(task_started|task_complete|turn_started|turn_complete|turn_aborted)"/.exec(l.slice(0, 400)); if (m && l.includes('"event_msg"')) t.turn = /started/.test(m[1]) ? 'open' : 'closed'; }
      } catch {}
      if (tailCache.size > 200) tailCache.delete(tailCache.keys().next().value); tailCache.set(r.file, t);
    }
    const age = now - r.mtime, state = age >= 30 * 60e3 ? 'idle' : t.turn === 'closed' ? 'turn' : age < 10 * 60e3 ? 'working' : 'idle';
    return { proj: PROJ, id: r.id, title: title(r), mtime: r.mtime, state, tool: '', ageMs: age, subActive: 0, subTotal: 0, dir: r.dir, source: 'codex' };
  }

  // The most recent sessions, newest first, to pick from: { proj, id, mtime, size, agents, title, project, source }.
  const listSessions = () => files.sessions(MAX_LISTED).map((r) => ({
    proj: PROJ, id: r.id, mtime: r.mtime, size: r.size, agents: 0, title: title(r), project: projectLabel(r.cwd), source: 'codex',
  }));

  // One row per session written to in the last `windowMs`, newest first.
  const boardRows = ({ now, windowMs }) => files.sessions().filter((r) => now - r.mtime < windowMs).slice(0, MAX_BOARD_ROWS).map((r) => boardRow(r, now));

  return { listSessions, boardRows, title, boardRow };
}

module.exports = { createCodexBoard };
