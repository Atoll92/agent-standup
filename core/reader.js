const fs = require('fs');
const { parseRecord } = require('./claudeRecord');

// ---- Incremental transcript reader: each .jsonl is parsed once, then only the bytes appended since are read.
// A session is merged from its main file and one file per sub-agent; the per-file results are cached and re-assembled cheaply.
const fileStates = new Map();   // path → { agent, gen, offset, mtime, fp, tail, raw[], toolName{}, msgUsage Map }
let fileGen = 0;   // each time a transcript is read from its start it gets a new number, which is how the live feed knows its events were numbered again
const sameBytes = (file, st) => {   // are the last bytes we read still where we read them? If not, the file was rewritten and not appended to
  let fd; try { fd = fs.openSync(file, 'r'); const b = Buffer.alloc(st.fp.length); fs.readSync(fd, b, 0, b.length, st.offset - b.length); return b.equals(st.fp); } catch { return false; } finally { if (fd != null) fs.closeSync(fd); }
};
function readNew(file, agent, journal, record = parseRecord) {
  let size, mtime; try { const s = fs.statSync(file); size = s.size; mtime = s.mtimeMs; } catch { fileStates.delete(file); return null; }
  let st = fileStates.get(file);
  if (st && size >= st.offset && mtime !== st.mtime && st.fp.length && !sameBytes(file, st)) st = null;   // rewritten in place and not shorter: checked only when the file was written to, with one small read
  if (!st || size < st.offset) { st = { agent, journal: !!journal, gen: ++fileGen, offset: 0, mtime: 0, fp: Buffer.alloc(0), tail: Buffer.alloc(0), raw: [], toolName: {}, msgUsage: new Map() }; fileStates.set(file, st); }
  st.mtime = mtime;
  while (size > st.offset) {   // read in chunks of at most 16 MB so a huge transcript never needs one giant buffer
    const fd = fs.openSync(file, 'r'); let buf;
    try { buf = Buffer.alloc(Math.min(16 * 1024 * 1024, size - st.offset)); fs.readSync(fd, buf, 0, buf.length, st.offset); } finally { fs.closeSync(fd); }
    st.offset += buf.length; st.fp = Buffer.from(buf.length >= 64 ? buf.subarray(buf.length - 64) : Buffer.concat([st.fp, buf]).subarray(-64));   // a copy: a view would keep the whole chunk in memory
    const all = st.tail.length ? Buffer.concat([st.tail, buf]) : buf, cut = all.lastIndexOf(10);   // only complete lines; a half-written last line waits for the next read
    if (cut < 0) { st.tail = all; continue; }
    st.tail = Buffer.from(all.subarray(cut + 1));   // a copy, for the same reason
    for (const line of all.subarray(0, cut).toString('utf8').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (!r || typeof r !== 'object') continue;
      try { record(st, r); } catch {}   // one odd record must not take the whole timeline down
    }
  }
  return st;
}

module.exports = { fileStates, readNew };
