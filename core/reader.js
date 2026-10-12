// Incremental transcript reader: each .jsonl is parsed once, then only the bytes appended since are read.
// A session is merged from its main file and one file per sub-agent; the per-file results are cached and re-assembled cheaply (see timeline.js).
const fs = require('fs');

// Read in chunks of at most this many bytes, so a huge transcript never needs one giant buffer.
const CHUNK_BYTES = 16 * 1024 * 1024;
// The last bytes read are kept to tell an appended file from a rewritten one.
const FINGERPRINT_BYTES = 64;
const NEWLINE = 10;

const statOrNull = (file) => { try { return fs.statSync(file); } catch { return null; } };

// Rewritten in place and not shorter. Checked only when the file was written to, with one small read.
function wasRewritten(file, state, stat) {
  return stat.size >= state.offset && stat.mtimeMs !== state.mtime && state.fp.length > 0 && !sameBytes(file, state);
}

// Are the last bytes we read still where we read them? If not, the file was rewritten and not appended to.
function sameBytes(file, state) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const bytes = Buffer.alloc(state.fp.length);
    fs.readSync(fd, bytes, 0, bytes.length, state.offset - bytes.length);
    return bytes.equals(state.fp);
  } catch { return false; } finally { if (fd != null) fs.closeSync(fd); }
}

function readChunk(file, state, size, record) {
  const fd = fs.openSync(file, 'r');
  let bytes;
  try {
    bytes = Buffer.alloc(Math.min(CHUNK_BYTES, size - state.offset));
    fs.readSync(fd, bytes, 0, bytes.length, state.offset);
  } finally { fs.closeSync(fd); }
  state.offset += bytes.length;
  // A copy: a view would keep the whole chunk in memory.
  state.fp = Buffer.from(bytes.length >= FINGERPRINT_BYTES ? bytes.subarray(bytes.length - FINGERPRINT_BYTES) : Buffer.concat([state.fp, bytes]).subarray(-FINGERPRINT_BYTES));

  // Only complete lines: a half-written last line waits for the next read.
  const all = state.tail.length ? Buffer.concat([state.tail, bytes]) : bytes;
  const lastNewline = all.lastIndexOf(NEWLINE);
  if (lastNewline < 0) { state.tail = all; return; }
  state.tail = Buffer.from(all.subarray(lastNewline + 1));   // a copy, for the same reason

  for (const line of all.subarray(0, lastNewline).toString('utf8').split('\n')) {
    if (!line) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!parsed || typeof parsed !== 'object') continue;
    try { record(state, parsed); } catch {}   // one odd record must not take the whole timeline down
  }
}

// A reader of transcripts: what it has read of each file is kept in it and nowhere else.
function createReader() {
  // path → what has been read of that file so far:
  //   { agent, journal, gen, offset, mtime, fp, tail, raw[], toolName{}, msgUsage Map }
  //   offset  how many bytes were read      fp    the last bytes of them      tail  the half-written line after the last newline
  //   raw     the events made so far        toolName, msgUsage  what the record parser needs to remember between records
  // The record parser (sources/claude/record.js, or Codex's) adds its own fields to it (lastTs, act, th, bg, prompt…).
  const fileStates = new Map();
  // Each time a transcript is read from its start it gets a new number, which is how the live feed knows its events were numbered again.
  let fileGen = 0;

  // Reads what was appended to `file` since the last call and returns its state, or null when the file is gone.
  // `record(state, parsedLine)` turns each new line into events: it belongs to the tool the file is from.
  function readNew(file, agent, journal, record) {
    const stat = statOrNull(file);
    if (!stat) { fileStates.delete(file); return null; }

    let state = fileStates.get(file);
    if (state && wasRewritten(file, state, stat)) state = null;
    if (!state || stat.size < state.offset) {   // new, rewritten, or shorter than what was read: from the start
      state = { agent, journal: !!journal, gen: ++fileGen, offset: 0, mtime: 0, fp: Buffer.alloc(0), tail: Buffer.alloc(0), raw: [], toolName: {}, msgUsage: new Map() };
      fileStates.set(file, state);
    }
    state.mtime = stat.mtimeMs;
    while (stat.size > state.offset) readChunk(file, state, stat.size, record);
    return state;
  }
  return { fileStates, readNew };
}

module.exports = { createReader };
