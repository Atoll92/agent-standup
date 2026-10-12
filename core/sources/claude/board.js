// What Claude Code sessions are doing: the list to pick from and the board, from the tail of each transcript (never the whole file).
const fs = require('fs'), path = require('path');
const { blocks, HARNESS } = require('../../transcript');
const { mtimeOf } = require('./files');
const { SessionStatus, SessionListing } = require('../../models');

const MINUTE_MS = 60e3;

// ---- What the tail of a transcript says

const TAIL_BYTES = 192 * 1024;
const TITLE_SEARCH_BYTES = 256 * 1024;
const MAX_CACHED_TAILS = 200;

const readTail = (file, bytes) => {
  const fileDescriptor = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fileDescriptor).size, byteCount = Math.min(bytes, size), buf = Buffer.alloc(byteCount);
    fs.readSync(fileDescriptor, buf, 0, byteCount, size - byteCount);
    return { text: buf.toString('utf8'), cut: size > bytes };
  } finally { fs.closeSync(fileDescriptor); }
};
const readHead = (file, bytes) => {
  const fileDescriptor = fs.openSync(file, 'r');
  try {
    const byteCount = Math.min(bytes, fs.fstatSync(fileDescriptor).size), buf = Buffer.alloc(byteCount);
    fs.readSync(fileDescriptor, buf, 0, byteCount, 0);
    return buf.toString('utf8');
  } finally { fs.closeSync(fileDescriptor); }
};

// First look at a file: a little further back than the lines read above, and without needing whole lines.
function titlesFurtherBack(file, aiTitle) {
  const text = readTail(file, TITLE_SEARCH_BYTES).text;
  const last = (pattern) => {
    const match = [...text.matchAll(pattern)].pop();
    try { return match ? JSON.parse('"' + match[1] + '"') : null; } catch { return null; }
  };
  const custom = last(/"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/g);
  return { custom, ai: aiTitle || last(/"type":"ai-title","aiTitle":"((?:[^"\\]|\\.)*)"/g) };
}

// The first thing the person typed, read record by record: a pattern over the raw text ran from a user record into the assistant's
// first answer and took that as the title.
function firstPrompt(file) {
  const oneLine = (text) => text.replace(/\s+/g, ' ').trim().slice(0, 90);
  for (const line of readHead(file, 64 * 1024).split('\n')) {
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); } catch { record = null; }
    if (record) {
      if (record.type !== 'user' || record.isMeta || record.isCompactSummary) continue;
      const text = oneLine(blocks(record).filter((block) => block && block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n').replace(HARNESS, ''));
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
function sessionState(tail, stat, now) {
  const age = now - stat.mtimeMs, pending = tail.pending || [], lastCall = pending[pending.length - 1];
  if (age >= LIVE_MS) return { state: 'idle', tool: '', ageMs: age };

  if (lastCall) {
    const ageMs = now - (lastCall.ts || stat.mtimeMs);
    const needsPerson = (ASKS.test(lastCall.name) && ageMs > ASK_GRACE_MS) || (APPROVAL.test(lastCall.name) && ageMs > APPROVAL_GRACE_MS);
    const state = SUBTOOL.test(lastCall.name) ? 'waiting' : needsPerson ? 'blocked' : 'working';
    return { state, tool: lastCall.name, ageMs };
  }
  if (tail.lastType === 'assistant' && !tail.lastTool) return { state: 'turn', tool: '', ageMs: age };
  return { state: age < QUIET_WORKING_MS ? 'working' : 'idle', tool: '', ageMs: age };
}

// The tails read so far are kept in the board that is created here, and nowhere else.
function createClaudeBoard({ root, files }) {
  // The most recent sessions, newest first, to pick from (SessionListing).
  function listSessions() {
    const found = [];
    for (const { proj, id, stat } of files.transcripts()) found.push({ proj, id, stat });
    found.sort((first, second) => second.stat.mtimeMs - first.stat.mtimeMs);

    return found.slice(0, MAX_LISTED).map(({ proj, id, stat }) => {
      // Titles come from the cached tail read (custom title, then AI title, then first prompt): no whole-file reads.
      let title = null;
      try { const file = path.join(root, proj, id + '.jsonl'); title = parseTail(file, fs.statSync(file)).title; } catch {}
      return new SessionListing({
        project: proj, sessionId: id, source: 'claude', title: title || id,
        projectLabel: proj.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/'),   // the folder's path, without the home folder
        lastActiveAt: stat.mtimeMs, sizeBytes: stat.size, subAgents: files.subFiles(proj, id).length,
      });
    });
  }

  // One row per session written to in the last `windowMs`, newest first: { proj, id, title, mtime, state, tool, ageMs, subActive, subTotal }.
  function boardRows({ now, windowMs }) {
    const recent = [];
    for (const { proj, id, stat } of files.transcripts()) if (now - stat.mtimeMs < windowMs) recent.push({ proj, id, stat });
    recent.sort((first, second) => second.stat.mtimeMs - first.stat.mtimeMs);
    return recent.slice(0, MAX_BOARD_ROWS).map(({ proj, id, stat }) => claudeRow(proj, id, stat, now));
  }

  const boardCache = new Map();   // file → what parseTail found, valid while the file has the same mtime and size

  // Reads the end of a transcript and returns
  //   { sig, title, custom, ai, first, lastType, lastTool, lastTs, pending }
  //   lastType  'assistant' or 'user': who wrote the last message      lastTool  whether that message has a tool call
  //   pending   tool calls with no result yet: [{ name, ts }]          title     what to call the session (see pickTitle)
  function parseTail(file, stat) {
    const sig = stat.mtimeMs + ':' + stat.size, cached = boardCache.get(file);
    if (cached && cached.sig === sig) return cached;

    const { text, cut: truncated } = readTail(file, TAIL_BYTES), lines = text.split('\n');
    if (truncated) lines.shift();   // the first line of a cut tail is not whole

    const pending = new Map();   // tool call id → { name, ts }
    let lastType = null, lastTool = false, lastTs = 0;
    let custom = (cached && cached.custom) || null, aiTitle = (cached && cached.ai) || null, first = cached ? cached.first : undefined;
    for (const line of lines) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      // A session is renamed, or named, long after its row was first shown: the latest one read wins.
      if (record.type === 'custom-title' && typeof record.customTitle === 'string') custom = record.customTitle;
      else if (record.type === 'ai-title' && typeof record.aiTitle === 'string') aiTitle = record.aiTitle;

      const ts = Date.parse(record.timestamp) || 0, content = blocks(record);
      if (record.type === 'assistant' || record.type === 'user') {
        lastType = record.type;
        lastTool = content.some((block) => block.type === 'tool_use');
        if (ts) lastTs = ts;
      }
      for (const block of content) {
        if (block.type === 'tool_use') pending.set(block.id, { name: block.name, ts });
        else if (block.type === 'tool_result') pending.delete(block.tool_use_id);
      }
    }

    if (!cached && !custom) ({ custom, ai: aiTitle } = titlesFurtherBack(file, aiTitle));
    if (!custom && !aiTitle && first == null) first = firstPrompt(file) || (stat.size > 64 * 1024 ? '' : null);   // '' = looked for and not there; a file that has just been created is looked at again

    // A title the person typed wins over the generated one, and both over the first prompt.
    const out = { sig, title: custom || aiTitle || first || null, custom, ai: aiTitle, first, lastType, lastTool, lastTs, pending: [...pending.values()] };
    boardCache.set(file, out);
    if (boardCache.size > MAX_CACHED_TAILS) boardCache.delete(boardCache.keys().next().value);
    return out;
  }

  // { proj, id, title, mtime, state, tool, ageMs, subActive, subTotal }
  function claudeRow(proj, id, stat, now) {
    let tail;
    try { tail = parseTail(path.join(root, proj, id + '.jsonl'), stat); } catch { tail = { pending: [] }; }
    const { state, tool, ageMs } = sessionState(tail, stat, now);

    let subActive = 0, subTotal = 0;
    for (const sub of files.subFiles(proj, id)) { subTotal++; if (now - mtimeOf(sub.file) < SUB_ACTIVE_MS) subActive++; }
    return new SessionStatus({ project: proj, sessionId: id, source: 'claude', title: tail.title || id, lastActiveAt: stat.mtimeMs, state, pendingTool: tool, stateAgeMs: ageMs, activeSubAgents: subActive, subAgents: subTotal });
  }

  return { listSessions, boardRows, parseTail };
}

module.exports = { createClaudeBoard };
