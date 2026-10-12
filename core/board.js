// The board: one cheap row per recent session, so many parallel sessions can be watched at once.
// A row's state comes from the tail of its transcript only (never the whole file).
const fs = require('fs'), path = require('path');
const { PROJ } = require('../codex.js');
const { blocks, HARNESS } = require('./transcript');
const { mtimeOf } = require('./sessionFiles');

const HOUR_MS = 3600e3, MINUTE_MS = 60e3;

// ---- The list of sessions (titles, for a picker)

// ---- What the tail of a transcript says

const TAIL_BYTES = 192 * 1024;
const TITLE_SEARCH_BYTES = 256 * 1024;
const MAX_CACHED_TAILS = 200;

const readTail = (file, bytes) => {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, n = Math.min(bytes, size), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    return { text: buf.toString('utf8'), cut: size > bytes };
  } finally { fs.closeSync(fd); }
};
const readHead = (file, bytes) => {
  const fd = fs.openSync(file, 'r');
  try {
    const n = Math.min(bytes, fs.fstatSync(fd).size), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, 0);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
};

// First look at a file: a little further back than the lines read above, and without needing whole lines.
function titlesFurtherBack(file, ai) {
  const text = readTail(file, TITLE_SEARCH_BYTES).text;
  const last = (re) => {
    const m = [...text.matchAll(re)].pop();
    try { return m ? JSON.parse('"' + m[1] + '"') : null; } catch { return null; }
  };
  const custom = last(/"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/g);
  return { custom, ai: ai || last(/"type":"ai-title","aiTitle":"((?:[^"\\]|\\.)*)"/g) };
}

// The first thing the person typed, read record by record: a pattern over the raw text ran from a user record into the assistant's
// first answer and took that as the title.
function firstPrompt(file) {
  const oneLine = (t) => t.replace(/\s+/g, ' ').trim().slice(0, 90);
  for (const line of readHead(file, 64 * 1024).split('\n')) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch { r = null; }
    if (r) {
      if (r.type !== 'user' || r.isMeta || r.isCompactSummary) continue;
      const text = oneLine(blocks(r).filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').replace(HARNESS, ''));
      if (text && text[0] !== '<' && !/^\[Request interrupted/i.test(text)) return text;
      continue;
    }
    // A first prompt too long to be whole in what was read: its start, from that same line only.
    const cutPrompt = /"type":"user"/.test(line) && line.match(/"role":"user","content":(?:\[\{"type":"text","text":)?"(?!<)((?:[^"\\]|\\.){1,200})/);
    if (cutPrompt) {
      try { const text = oneLine(JSON.parse('"' + cutPrompt[1].replace(/\\u[0-9a-fA-F]{0,3}$/, '') + '"')); if (text) return text; } catch {}
    }
  }
  return null;
}

// ---- The board

// What a tool call that has no result yet tells about a session.
const APPROVAL = /^(Edit|Write|MultiEdit|NotebookEdit)/;   // may be waiting for the person to allow it
const ASKS = /^(AskUserQuestion|ExitPlanMode)/;            // is waiting for the person to answer
const SUBTOOL = /^(Task|Agent)$/;                          // is waiting for a sub-agent

const SESSION_WINDOW_MS = 12 * HOUR_MS;    // sessions older than this are not on the board
const LIVE_MS = 30 * MINUTE_MS;            // a session untouched for this long is idle
const QUIET_WORKING_MS = 10 * MINUTE_MS;   // no call pending and the person's turn not come: still "working" for this long
const ASK_GRACE_MS = 4000;                 // a question unanswered for this long needs the person
const APPROVAL_GRACE_MS = 15000;           // an edit with no result for this long may be waiting for permission
const SUB_ACTIVE_MS = 90e3;                // a sub-agent written to within this is active
const MAX_CLAUDE_ROWS = 40, MAX_CODEX_ROWS = 20;

// The state of a session, from its tail:
//   working  an agent is at work              waiting  the lead waits for a sub-agent
//   blocked  it needs the person (a question, or an edit waiting for permission: a heuristic, Claude Code does not record permission prompts)
//   turn     the lead answered, it is the person's turn          idle  nothing for a while
// `tool` is the call that has no result yet, and `ageMs` how long it has been pending (or since the file was written).
function sessionState(tail, st, now) {
  const age = now - st.mtimeMs, pending = tail.pending || [], lastCall = pending[pending.length - 1];
  if (age >= LIVE_MS) return { state: 'idle', tool: '', ageMs: age };

  if (lastCall) {
    const ageMs = now - (lastCall.ts || st.mtimeMs);
    const needsPerson = (ASKS.test(lastCall.name) && ageMs > ASK_GRACE_MS) || (APPROVAL.test(lastCall.name) && ageMs > APPROVAL_GRACE_MS);
    const state = SUBTOOL.test(lastCall.name) ? 'waiting' : needsPerson ? 'blocked' : 'working';
    return { state, tool: lastCall.name, ageMs };
  }
  if (tail.lastType === 'assistant' && !tail.lastTool) return { state: 'turn', tool: '', ageMs: age };
  return { state: age < QUIET_WORKING_MS ? 'working' : 'idle', tool: '', ageMs: age };
}


// The board of the sessions in `root`. What it has read of each transcript's tail, and the last list, are kept in it and nowhere else.
function createBoard({ root, codex, files }) {
  let sessionsMemo = { at: 0, rows: [] };
  // Shared by all the polls of two seconds.
  function listSessions() {
    if (Date.now() - sessionsMemo.at < 2000) return sessionsMemo.rows;
    const rows = readSessionList();
    sessionsMemo = { at: Date.now(), rows };
    return rows;
  }

  function readSessionList() {
    const rows = [];
    for (const r of codex.sessions(30)) rows.push({ proj: PROJ, id: r.id, mtime: r.mtime, size: r.size, agents: 0, cx: r });
    for (const { proj, id, stat } of files.transcripts()) rows.push({ proj, id, mtime: stat.mtimeMs, size: stat.size, agents: files.subFiles(proj, id).length });
    rows.sort((a, b) => b.mtime - a.mtime);

    // The 60 most recent Claude Code sessions as always, and up to 30 Codex ones beside them: neither pushes the other out.
    const top = rows.filter((r) => !r.cx).slice(0, 60).concat(rows.filter((r) => r.cx)).sort((a, b) => b.mtime - a.mtime);
    for (const r of top) {
      if (r.cx) {
        const c = r.cx; delete r.cx;
        r.title = codex.title(c); r.project = codex.projectLabel(c.cwd); r.source = 'codex';
        continue;
      }
      // Titles come from the cached tail read (custom title, then AI title, then first prompt): no whole-file reads.
      let title = null;
      try { const file = path.join(root, r.proj, r.id + '.jsonl'); title = parseTail(file, fs.statSync(file)).title; } catch {}
      r.title = title || r.id;
      r.project = r.proj.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/');
    }
    return top;
  }

  const boardCache = new Map();   // file → what parseTail found, valid while the file has the same mtime and size

  // Reads the end of a transcript and returns
  //   { sig, title, custom, ai, first, lastType, lastTool, lastTs, pending }
  //   lastType  'assistant' or 'user': who wrote the last message      lastTool  whether that message has a tool call
  //   pending   tool calls with no result yet: [{ name, ts }]          title     what to call the session (see pickTitle)
  function parseTail(file, st) {
    const sig = st.mtimeMs + ':' + st.size, cached = boardCache.get(file);
    if (cached && cached.sig === sig) return cached;

    const { text, cut } = readTail(file, TAIL_BYTES), lines = text.split('\n');
    if (cut) lines.shift();   // the first line of a cut tail is not whole

    const pending = new Map();   // tool call id → { name, ts }
    let lastType = null, lastTool = false, lastTs = 0;
    let custom = (cached && cached.custom) || null, ai = (cached && cached.ai) || null, first = cached ? cached.first : undefined;
    for (const line of lines) {
      if (!line) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      // A session is renamed, or named, long after its row was first shown: the latest one read wins.
      if (r.type === 'custom-title' && typeof r.customTitle === 'string') custom = r.customTitle;
      else if (r.type === 'ai-title' && typeof r.aiTitle === 'string') ai = r.aiTitle;

      const ts = Date.parse(r.timestamp) || 0, content = blocks(r);
      if (r.type === 'assistant' || r.type === 'user') {
        lastType = r.type;
        lastTool = content.some((b) => b.type === 'tool_use');
        if (ts) lastTs = ts;
      }
      for (const b of content) {
        if (b.type === 'tool_use') pending.set(b.id, { name: b.name, ts });
        else if (b.type === 'tool_result') pending.delete(b.tool_use_id);
      }
    }

    if (!cached && !custom) ({ custom, ai } = titlesFurtherBack(file, ai));
    if (!custom && !ai && first == null) first = firstPrompt(file) || (st.size > 64 * 1024 ? '' : null);   // '' = looked for and not there; a file that has just been created is looked at again

    // A title the person typed wins over the generated one, and both over the first prompt.
    const out = { sig, title: custom || ai || first || null, custom, ai, first, lastType, lastTool, lastTs, pending: [...pending.values()] };
    boardCache.set(file, out);
    if (boardCache.size > MAX_CACHED_TAILS) boardCache.delete(boardCache.keys().next().value);
    return out;
  }

  let boardMemo = { at: 0, rows: [] };
  // One row per recent session, newest first. Several windows polling at once share one scan.
  function boardRows() {
    if (Date.now() - boardMemo.at < 1200) return boardMemo.rows;
    const rows = readBoard();
    boardMemo = { at: Date.now(), rows };
    return rows;
  }

  function readBoard() {
    const now = Date.now(), recent = [];
    for (const r of codex.sessions()) if (now - r.mtime < SESSION_WINDOW_MS) recent.push({ proj: PROJ, id: r.id, st: { mtimeMs: r.mtime, size: r.size }, cx: r });
    for (const { proj, id, stat } of files.transcripts()) if (now - stat.mtimeMs < SESSION_WINDOW_MS) recent.push({ proj, id, st: stat });
    recent.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);

    return recent.filter((r) => !r.cx).slice(0, MAX_CLAUDE_ROWS).concat(recent.filter((r) => r.cx).slice(0, MAX_CODEX_ROWS))
      .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
      .map(({ proj, id, st, cx }) => (cx ? codex.boardRow(cx, now) : claudeRow(proj, id, st, now)));
  }

  // { proj, id, title, mtime, state, tool, ageMs, subActive, subTotal }
  function claudeRow(proj, id, st, now) {
    let tail;
    try { tail = parseTail(path.join(root, proj, id + '.jsonl'), st); } catch { tail = { pending: [] }; }
    const { state, tool, ageMs } = sessionState(tail, st, now);

    let subActive = 0, subTotal = 0;
    for (const sub of files.subFiles(proj, id)) { subTotal++; if (now - mtimeOf(sub.file) < SUB_ACTIVE_MS) subActive++; }
    return { proj, id, title: tail.title || id, mtime: st.mtimeMs, state, tool, ageMs, subActive, subTotal };
  }

  return { listSessions, boardRows, parseTail };
}

module.exports = { createBoard };
