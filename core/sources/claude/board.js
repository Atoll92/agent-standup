// What Claude Code sessions are doing: the list to pick from and the board, from the tail of each transcript (never the whole file).
const fs = require('fs'), path = require('path');
const { blocks, HARNESS } = require('../../transcript');
const { mtimeOf } = require('./files');

const MINUTE_MS = 60e3;

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

const LIVE_MS = 30 * MINUTE_MS;            // a session untouched for this long is idle
const QUIET_WORKING_MS = 10 * MINUTE_MS;   // no call pending and the person's turn not come: still "working" for this long
const ASK_GRACE_MS = 4000;                 // a question unanswered for this long needs the person
const APPROVAL_GRACE_MS = 15000;           // an edit with no result for this long may be waiting for permission
const SUB_ACTIVE_MS = 90e3;                // a sub-agent written to within this is active
const MAX_BOARD_ROWS = 40;   // rows on the board
const MAX_LISTED = 60;       // sessions in the list to pick from

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

// The tails read so far are kept in the board that is created here, and nowhere else.
function createClaudeBoard({ root, files }) {
  // The most recent sessions, newest first, to pick from: { proj, id, mtime, size, agents, title, project }.
  function listSessions() {
    const rows = [];
    for (const { proj, id, stat } of files.transcripts()) rows.push({ proj, id, mtime: stat.mtimeMs, size: stat.size });
    rows.sort((a, b) => b.mtime - a.mtime);

    return rows.slice(0, MAX_LISTED).map((r) => {
      // Titles come from the cached tail read (custom title, then AI title, then first prompt): no whole-file reads.
      let title = null;
      try { const file = path.join(root, r.proj, r.id + '.jsonl'); title = parseTail(file, fs.statSync(file)).title; } catch {}
      return { ...r, agents: files.subFiles(r.proj, r.id).length, title: title || r.id, project: r.proj.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/') };
    });
  }

  // One row per session written to in the last `windowMs`, newest first: { proj, id, title, mtime, state, tool, ageMs, subActive, subTotal }.
  function boardRows({ now, windowMs }) {
    const recent = [];
    for (const { proj, id, stat } of files.transcripts()) if (now - stat.mtimeMs < windowMs) recent.push({ proj, id, st: stat });
    recent.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    return recent.slice(0, MAX_BOARD_ROWS).map(({ proj, id, st }) => claudeRow(proj, id, st, now));
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

module.exports = { createClaudeBoard };
