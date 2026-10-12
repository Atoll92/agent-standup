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
  return stat.size >= state.bytesRead && stat.mtimeMs !== state.modifiedAt && state.fingerprint.length > 0 && !sameBytes(file, state);
}

// Are the last bytes we read still where we read them? If not, the file was rewritten and not appended to.
function sameBytes(file, state) {
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(file, 'r');
    const bytes = Buffer.alloc(state.fingerprint.length);
    fs.readSync(fileDescriptor, bytes, 0, bytes.length, state.bytesRead - bytes.length);
    return bytes.equals(state.fingerprint);
  } catch { return false; } finally { if (fileDescriptor != null) fs.closeSync(fileDescriptor); }
}

function readChunk(file, state, size, record) {
  const fileDescriptor = fs.openSync(file, 'r');
  let bytes;
  try {
    bytes = Buffer.alloc(Math.min(CHUNK_BYTES, size - state.bytesRead));
    fs.readSync(fileDescriptor, bytes, 0, bytes.length, state.bytesRead);
  } finally { fs.closeSync(fileDescriptor); }
  state.bytesRead += bytes.length;
  // A copy: a view would keep the whole chunk in memory.
  state.fingerprint = Buffer.from(bytes.length >= FINGERPRINT_BYTES ? bytes.subarray(bytes.length - FINGERPRINT_BYTES) : Buffer.concat([state.fingerprint, bytes]).subarray(-FINGERPRINT_BYTES));

  // Only complete lines: a half-written last line waits for the next read.
  const all = state.partialLine.length ? Buffer.concat([state.partialLine, bytes]) : bytes;
  const lastNewline = all.lastIndexOf(NEWLINE);
  if (lastNewline < 0) { state.partialLine = all; return; }
  state.partialLine = Buffer.from(all.subarray(lastNewline + 1));   // a copy, for the same reason

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
  //   agentId      whose file it is                        isJournal    a workflow's journal, not a transcript
  //   generation   a new number each time the file is read from its start (the live feed needs it, see feed.js)
  //   bytesRead    how far the file has been read          fingerprint  the last bytes read, to tell an appended file from a rewritten one
  //   modifiedAt   the file's mtime at the last read       partialLine  a half-written last line, read again next time
  //   records      the events and signals read so far (see models): a record's key is its rank here
  //   toolNames, usageByMessage   what the record parser remembers between records (tool call id → name, message id → tokens)
  // The record parser (sources/claude/record.js, or Codex's) adds its own fields: lastTimestamp, lastActionIndex, pendingThought,
  // backgroundCalls, order, lastSayMessageId, lastSayIndex (Claude Code), and codex (Codex's own).
  const fileStates = new Map();
  // Each time a transcript is read from its start it gets a new number, which is how the live feed knows its events were numbered again.
  let fileGeneration = 0;

  // Reads what was appended to `file` since the last call and returns its state, or null when the file is gone.
  // `record(state, parsedLine)` turns each new line into events: it belongs to the tool the file is from.
  function readNew(file, agent, journal, record) {
    const stat = statOrNull(file);
    if (!stat) { fileStates.delete(file); return null; }

    let state = fileStates.get(file);
    if (state && wasRewritten(file, state, stat)) state = null;
    if (!state || stat.size < state.bytesRead) {   // new, rewritten, or shorter than what was read: from the start
      state = { agentId: agent, isJournal: !!journal, generation: ++fileGeneration, bytesRead: 0, modifiedAt: 0, fingerprint: Buffer.alloc(0), partialLine: Buffer.alloc(0), records: [], toolNames: {}, usageByMessage: new Map() };
      fileStates.set(file, state);
    }
    state.modifiedAt = stat.mtimeMs;
    while (stat.size > state.bytesRead) readChunk(file, state, stat.size, record);
    return state;
  }
  return { fileStates, readNew };
}

module.exports = { createReader };
