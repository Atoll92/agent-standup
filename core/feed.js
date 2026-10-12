// The timeline of a session, kept in memory and followed live.
//
// timelineEntry(proj, id) gives the timeline of a session, rebuilt only when a file of the session changed.
// feedSince(entry, after) gives what is new or different since a reader last looked: the live feed.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { PROJ } = require('../codex.js');
const { mtimeOf } = require('./sessionFiles');
const { BOOKKEEPING } = require('./timeline');

const MAX_CACHED_SESSIONS = 3;
const MIN_REBUILD_GAP_MS = 250;

// The cache of timelines is kept in the feed that is created here, and nowhere else.
function createFeed({ root, codex, files: sessionFiles, reader, buildTimeline }) {
  // "proj/id" → { st (file stamp), tl, at (when built), ms (how long it took), files[], feed, sq, recentUntil, json?, gz?, idle? }
  const timelines = new Map();

  function timelineEntry(proj, id) {
    const key = proj + '/' + id, stamp = sessionStamp(proj, id), cached = timelines.get(key), now = Date.now();
    if (cached && isStillGood(cached, stamp, now)) {
      timelines.delete(key); timelines.set(key, cached);   // asked for again: the last one to be dropped
      return cached;
    }

    const started = Date.now(), files = [];
    const tl = buildTimeline(proj, id, files), feed = feedStep(cached && cached.feed, tl, files);
    const entry = { st: stamp, tl, at: Date.now(), ms: Date.now() - started, files, feed, sq: feed.sq, recentUntil: tl.recentUntil || 0 };
    timelines.delete(key); timelines.set(key, entry);
    dropOldSessions();
    return entry;
  }

  // Free the memory of sessions nobody is looking at any more. Their live feed goes with them:
  // a reader still on one of them is told to load it again.
  function dropOldSessions() {
    while (timelines.size > MAX_CACHED_SESSIONS) {
      const [oldKey, old] = timelines.entries().next().value;
      timelines.delete(oldKey);
      for (const file of old.files) reader.fileStates.delete(file);
    }
  }

  // A number that changes when anything in the session's files changes: the transcripts and the folders they are in
  // (a folder changes when a file appears in it, e.g. an agent's meta file), not every file around them.
  function sessionStamp(proj, id) {
    let n = 0;
    const add = (file) => { try { const s = fs.statSync(file); n += s.mtimeMs + s.size; } catch {} };
    add(proj === PROJ ? codex.fileOf(id) || '' : path.join(root, proj, id + '.jsonl'));
    const subs = sessionFiles.subFiles(proj, id);
    for (const x of subs) add(x.file);
    for (const x of subs.journals) add(x.file);
    for (const dir of subs.dirs) n += mtimeOf(dir);
    return n;
  }

  const generationOf = (file) => (reader.fileStates.get(file) || {}).gen;

  // Numbers the events of a fresh build against the previous feed (if it is still valid), and returns the feed to keep.
  function feedStep(previous, tl, files) {
    let feed = previous && filesNotRewritten(previous, files) ? previous : null;
    let sq = feed && numberEvents(feed, tl);
    if (!sq) { feed = newFeed(); sq = numberEvents(feed, tl); }

    for (const file of files) feed.gens.set(file, generationOf(file));
    feed.sq = sq; tl.ep = feed.ep; tl.seq = feed.seq;
    return feed;
  }

  // A transcript read again from its start numbers its events again: the keys no longer mean the same thing.
  function filesNotRewritten(feed, files) {
    return files.every((file) => { const was = feed.gens.get(file); return was === undefined || was === generationOf(file); });
  }

  const timeline = (proj, id) => timelineEntry(proj, id).tl;

  return { timelineEntry, timeline, feedSince };
}

// Nothing was written (a sub-agent's 4-minute silence rule can flip without any file change, hence recentUntil);
// or a very big session, which is not rebuilt on every poll: not before twice the time a build took.
function isStillGood(cached, stamp, now) {
  const unchanged = cached.st === stamp && !(cached.recentUntil && now > cached.recentUntil);
  const builtJustNow = now - cached.at < Math.max(MIN_REBUILD_GAP_MS, cached.ms * 2);
  return unchanged || builtJustNow;
}

// ---- The live feed
//
// The timeline is sorted again at each build, and events already sent can change (an order typed mid-turn is stamped at typing time
// and lands before what the reader has; a sub-agent's last line becomes its report; a tool call joins an earlier beat),
// so a reader cannot ask for "what comes after index n". Instead every event has a key `k` that never changes,
// each build that changes something gets the next sequence number, and a reader asks for the events that are new or different
// since the number it holds.
//
// A feed is { ep, seq, known: k → { s (signature), q (sequence number) }, gens, t0, sq }.
// `ep` names this memory: it is a new one after a restart, after the session left the cache, or when a transcript was rewritten,
// and the reader then loads the whole session again.

const newFeed = () => ({ ep: crypto.randomBytes(6).toString('hex'), seq: 0, known: new Map(), gens: new Map() });

// Gives each event the sequence number at which it last changed, and moves the feed on if anything did.
// Returns that list of numbers (one per event), or null when an event the reader may hold no longer exists:
// nothing can tell it to drop it, so the caller starts a new feed.
function numberEvents(feed, tl) {
  const events = tl.events, sq = new Uint32Array(events.length), seq = feed.seq + 1, before = feed.known.size;

  // Time zero moved (something now comes before the first line): every `t` is different.
  const zero = events.find((e) => !BOOKKEEPING.has(e.kind)), t0 = zero ? zero.ts : 0, moved = feed.t0 !== t0;
  feed.t0 = t0;

  let hits = 0, changed = false;
  events.forEach((e, i) => {
    const s = signature(e), was = feed.known.get(e.k);
    if (!was) { feed.known.set(e.k, { s, q: seq }); sq[i] = seq; changed = true; return; }
    hits++;
    if (was.s !== s || moved) { was.s = s; was.q = seq; changed = true; }
    sq[i] = was.q;
  });

  if (hits < before) return null;
  if (changed) feed.seq = seq;
  return sq;
}

// Everything about an event that can differ from one build to the next. Its text, its tool calls, its results and its time never do:
// they come from one transcript record (same key = same record). And `t` moves only when time zero does, which numberEvents looks at once for all.
function signature(e) {
  let detail = '';
  if (e.kind === 'tools') detail = e.tools.length + ':' + e.tools[e.tools.length - 1].id;
  else if (e.kind === 'usage') detail = `${e.u.i},${e.u.o},${e.u.r},${e.u.w},${e.model}`;
  else if (e.kind === 'order') detail = `${e.toolId},${e.bg},${e.title}`;
  else if (e.kind === 'finish') detail = e.ts;
  return e.kind + '|' + e.agent + '|' + (e.to || '') + '|' + (e.end || '') + '|' + detail;
}

// The events that are new or different since sequence number `after`, in timeline order. Nothing to scan when the reader is up to date.
function feedSince(entry, after) {
  const events = entry.tl.events, sq = entry.sq, out = [];
  if (after < entry.tl.seq) for (let i = 0; i < events.length; i++) if ((sq ? sq[i] : 1) > after) out.push(events[i]);
  return out;
}

module.exports = { createFeed };
