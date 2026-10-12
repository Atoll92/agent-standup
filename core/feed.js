const fs = require('fs'), path = require('path'), crypto = require('crypto');
const codex = require('../codex.js');
const { ROOT } = require('./config');
const { mtimeOf, subFiles } = require('./sessionFiles');
const { fileStates } = require('./reader');
const { buildTimeline } = require('./timeline');

function stamp(proj, id) {
  const base = path.join(ROOT, proj); let n = 0;
  const add = (f) => { try { const s = fs.statSync(f); n += s.mtimeMs + s.size; } catch {} };
  add(proj === codex.PROJ ? codex.fileOf(id) || '' : path.join(base, id + '.jsonl'));
  const subs = subFiles(proj, id);   // the transcripts and the folders they are in (a folder changes when a file appears in it, e.g. an agent's meta file), not every file around them
  for (const x of subs) add(x.file); for (const x of subs.journals) add(x.file); for (const d of subs.dirs) n += mtimeOf(d);
  return n;
}
const tlCache = new Map();   // "proj/id" → { st (file stamp), tl, at, ms, files[], feed, sq, json?, gz?, idle? }
const MAX_CACHED_SESSIONS = 3;
function timelineEntry(proj, id) {
  const key = proj + '/' + id, st = stamp(proj, id), hit = tlCache.get(key), now = Date.now();
  if (hit && ((hit.st === st && !(hit.recentUntil && now > hit.recentUntil)) || now - hit.at < Math.max(250, hit.ms * 2))) {   // nothing was written (a sub-agent's 4-minute silence rule can flip without any file change); or a very big session, which is not rebuilt on every poll
    tlCache.delete(key); tlCache.set(key, hit); return hit;   // asked for again: the last one to be dropped
  }
  const t0 = Date.now(), files = [], tl = buildTimeline(proj, id, files), feed = feedStep(hit && hit.feed, tl, files);
  const entry = { st, tl, at: Date.now(), ms: Date.now() - t0, files, feed, sq: feed.sq, recentUntil: tl.recentUntil || 0 };
  tlCache.delete(key); tlCache.set(key, entry);
  while (tlCache.size > MAX_CACHED_SESSIONS) {   // free the memory of sessions nobody is looking at any more (their live feed goes with them: a page still on one of them is told to load it again)
    const [oldKey, old] = tlCache.entries().next().value; tlCache.delete(oldKey);
    for (const f of old.files) fileStates.delete(f);
  }
  return entry;
}
// ---- Live feed. The timeline is sorted again at each build and events already sent can change (an order typed mid-turn is stamped at typing time and lands before what the page has; a sub-agent's last line becomes its report; a tool call joins an earlier beat),
// so a page cannot ask for "what comes after index n". Every event has a key `k` that never changes, each build that changes something gets the next sequence number, and a page asks for the events that are new or different since the number it holds.
// `ep` names this memory: it is a new one after a restart, after the session left the cache, or when a transcript was rewritten, and the page then loads the whole session again.
const sigOf = (e) => e.kind + '|' + e.agent + '|' + (e.to || '') + '|' + (e.end || '') + '|' + (e.kind === 'tools' ? e.tools.length + ':' + e.tools[e.tools.length - 1].id : e.kind === 'usage' ? e.u.i + ',' + e.u.o + ',' + e.u.r + ',' + e.u.w + ',' + e.model : e.kind === 'order' ? e.toolId + ',' + e.bg + ',' + e.title : e.kind === 'finish' ? e.ts : '');   // everything about an event that can differ from one build to the next. Its text, its tool calls, its results and its time never do: they come from one transcript record (same key = same record); and `t` moves only when time zero does, which feedStep looks at once for all
function feedStep(prev, tl, files) {
  let f = prev && files.every((x) => { const was = prev.gens.get(x); return was === undefined || was === (fileStates.get(x) || {}).gen; }) ? prev : null;   // a transcript read again from its start numbers its events again: the keys no longer mean the same thing
  for (let pass = 0; ; pass++) {
    if (!f) f = { ep: crypto.randomBytes(6).toString('hex'), seq: 0, known: new Map(), gens: new Map() };
    const n = tl.events.length, sq = new Uint32Array(n), seq = f.seq + 1, before = f.known.size, z = tl.events.find((e) => e.kind !== 'usage' && e.kind !== 'finish' && e.kind !== 'compact'), t0 = z ? z.ts : 0, moved = f.t0 !== t0; let hits = 0, changed = false; f.t0 = t0;   // time zero moved (something now comes before the first line): every `t` is different
    for (let i = 0; i < n; i++) {
      const e = tl.events[i], s = sigOf(e), was = f.known.get(e.k);
      if (was) { hits++; if (was.s !== s || moved) { was.s = s; was.q = seq; changed = true; } sq[i] = was.q; } else { f.known.set(e.k, { s, q: seq }); sq[i] = seq; changed = true; }
    }
    if (hits < before && !pass) { f = null; continue; }   // an event the page may hold no longer exists: nothing can tell it to drop it, so everything starts over
    if (changed) f.seq = seq;
    for (const x of files) f.gens.set(x, (fileStates.get(x) || {}).gen);
    f.sq = sq; tl.ep = f.ep; tl.seq = f.seq; return f;
  }
}
const timeline = (proj, id) => timelineEntry(proj, id).tl;
const feedSince = (entry, after) => { const ev = entry.tl.events, sq = entry.sq, out = []; if (after < entry.tl.seq) for (let i = 0; i < ev.length; i++) if ((sq ? sq[i] : 1) > after) out.push(ev[i]); return out; };   // in timeline order; nothing to scan when the page is up to date

module.exports = { timelineEntry, timeline, feedSince };
