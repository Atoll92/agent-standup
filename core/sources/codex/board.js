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
    const indexFile = path.join(home, 'session_index.jsonl'); let stat; try { stat = fs.statSync(indexFile); } catch { return names.map; }
    const sig = indexFile + ':' + stat.mtimeMs + ':' + stat.size; if (sig === names.sig) return names.map;
    const map = new Map(); try { for (const line of fs.readFileSync(indexFile, 'utf8').split('\n')) { if (!line) continue; try { const entry = JSON.parse(line); if (entry && entry.id && typeof entry.thread_name === 'string' && entry.thread_name.trim()) map.set(String(entry.id).toLowerCase(), entry.thread_name.trim()); } catch {} } } catch {}
    names = { sig, map }; return map;
  }
  const promptCache = new Map();   // file → the first prompt ('' = looked for in the first megabyte and not there)
  function firstPrompt(rollout) {
    const hit = promptCache.get(rollout.file); if (hit != null) return hit;
    let text = ''; try { const fileDescriptor = fs.openSync(rollout.file, 'r'); try { const buf = Buffer.alloc(Math.min(1024 * 1024, rollout.size)); fs.readSync(fileDescriptor, buf, 0, buf.length, 0); text = buf.toString('utf8'); } finally { fs.closeSync(fileDescriptor); } } catch {}
    let out = '';
    for (const line of text.split('\n')) {
      if (!line.includes('"UserMessage"') && !line.includes('"user_message"')) continue; let record; try { record = JSON.parse(line); } catch { continue; }
      const payload = (record && record.payload) || {}, prompt = payload.type === 'user_message' ? typed(payload.message) : payload.type === 'item_completed' && payload.item && payload.item.type === 'UserMessage' ? typed(partsText(payload.item.content)) : '';
      if (prompt) { out = prompt.replace(/\s+/g, ' ').slice(0, 90); break; }
    }
    if (out || rollout.size > 64 * 1024) { if (promptCache.size > 2000) promptCache.clear(); promptCache.set(rollout.file, out); }   // a file that has just been created is looked at again
    return out;
  }
  const title = (rollout) => threadNames().get(rollout.id) || firstPrompt(rollout) || rollout.id;

  // ---- the board: is the agent in the middle of a turn, or is it the person's turn? Read from the end of the file.
  const tailCache = new Map();
  function boardRow(rollout, now) {
    const sig = rollout.mtime + ':' + rollout.size; let tail = tailCache.get(rollout.file);
    if (!tail || tail.sig !== sig) {
      tail = { sig, turn: '' };
      try {
        const fileDescriptor = fs.openSync(rollout.file, 'r'); let text = ''; try { const byteCount = Math.min(128 * 1024, rollout.size), buf = Buffer.alloc(byteCount); fs.readSync(fileDescriptor, buf, 0, byteCount, rollout.size - byteCount); text = buf.toString('utf8'); } finally { fs.closeSync(fileDescriptor); }
        for (const line of text.split('\n')) { const match = /"type":"(task_started|task_complete|turn_started|turn_complete|turn_aborted)"/.exec(line.slice(0, 400)); if (match && line.includes('"event_msg"')) tail.turn = /started/.test(match[1]) ? 'open' : 'closed'; }
      } catch {}
      if (tailCache.size > 200) tailCache.delete(tailCache.keys().next().value); tailCache.set(rollout.file, tail);
    }
    const age = now - rollout.mtime, state = age >= 30 * 60e3 ? 'idle' : tail.turn === 'closed' ? 'turn' : age < 10 * 60e3 ? 'working' : 'idle';
    return { proj: PROJ, id: rollout.id, title: title(rollout), mtime: rollout.mtime, state, tool: '', ageMs: age, subActive: 0, subTotal: 0, dir: rollout.dir, source: 'codex' };
  }

  // The most recent sessions, newest first, to pick from: { proj, id, mtime, size, agents, title, project, source }.
  const listSessions = () => files.sessions(MAX_LISTED).map((rollout) => ({
    proj: PROJ, id: rollout.id, mtime: rollout.mtime, size: rollout.size, agents: 0, title: title(rollout), project: projectLabel(rollout.cwd), source: 'codex',
  }));

  // One row per session written to in the last `windowMs`, newest first.
  const boardRows = ({ now, windowMs }) => files.sessions().filter((rollout) => now - rollout.mtime < windowMs).slice(0, MAX_BOARD_ROWS).map((rollout) => boardRow(rollout, now));

  return { listSessions, boardRows, title, boardRow };
}

module.exports = { createCodexBoard };
