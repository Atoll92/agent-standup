// The timeline of a session, kept in memory and followed live.
//
// timelineEntry(proj, id) gives the timeline of a session, rebuilt only when a file of the session changed.
// feedSince(entry, after) gives what is new or different since a reader last looked: the live feed.
const crypto = require('crypto');
const { BOOKKEEPING } = require('./timeline');

const MAX_CACHED_SESSIONS = 3;
const MIN_REBUILD_GAP_MS = 250;

// The cache of timelines is kept in the feed that is created here, and nowhere else.
function createFeed({ sourceOf, reader, buildTimeline }) {
  // "proj/id" → { stamp (of the files), tl, at (when built), ms (how long it took), files[], feed, sq, recentUntil, json?, gz?, idle? }
  const timelines = new Map();

  function timelineEntry(proj, id) {
    const key = proj + '/' + id, stamp = sourceOf(proj).stamp(proj, id), cached = timelines.get(key), now = Date.now();
    if (cached && isStillGood(cached, stamp, now)) {
      timelines.delete(key); timelines.set(key, cached);   // asked for again: the last one to be dropped
      return cached;
    }

    const started = Date.now(), files = [];
    const builtTimeline = buildTimeline(proj, id, files), feed = feedStep(cached && cached.feed, builtTimeline, files);
    const entry = { stamp, tl: builtTimeline, at: Date.now(), ms: Date.now() - started, files, feed, sq: feed.sq, recentUntil: builtTimeline.recentUntil || 0 };
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

  const generationOf = (file) => (reader.fileStates.get(file) || {}).gen;

  // Numbers the events of a fresh build against the previous feed (if it is still valid), and returns the feed to keep.
  function feedStep(previous, builtTimeline, files) {
    let feed = previous && filesNotRewritten(previous, files) ? previous : null;
    let sequenceNumbers = feed && numberEvents(feed, builtTimeline);
    if (!sequenceNumbers) { feed = newFeed(); sequenceNumbers = numberEvents(feed, builtTimeline); }

    for (const file of files) feed.gens.set(file, generationOf(file));
    feed.sq = sequenceNumbers; builtTimeline.ep = feed.ep; builtTimeline.seq = feed.seq;
    return feed;
  }

  // A transcript read again from its start numbers its events again: the keys no longer mean the same thing.
  function filesNotRewritten(feed, files) {
    return files.every((file) => { const previousGeneration = feed.gens.get(file); return previousGeneration === undefined || previousGeneration === generationOf(file); });
  }

  const timeline = (proj, id) => timelineEntry(proj, id).tl;

  return { timelineEntry, timeline, feedSince };
}

// Nothing was written (a sub-agent's 4-minute silence rule can flip without any file change, hence recentUntil);
// or a very big session, which is not rebuilt on every poll: not before twice the time a build took.
function isStillGood(cached, stamp, now) {
  const unchanged = cached.stamp === stamp && !(cached.recentUntil && now > cached.recentUntil);
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
function numberEvents(feed, builtTimeline) {
  const events = builtTimeline.events, sequenceNumbers = new Uint32Array(events.length), nextSequence = feed.seq + 1, before = feed.known.size;

  // Time zero moved (something now comes before the first line): every `t` is different.
  const zero = events.find((event) => !BOOKKEEPING.has(event.kind)), firstEventTime = zero ? zero.ts : 0, moved = feed.t0 !== firstEventTime;
  feed.t0 = firstEventTime;

  let hits = 0, changed = false;
  events.forEach((event, index) => {
    const eventSignature = signature(event), knownEvent = feed.known.get(event.k);
    if (!knownEvent) { feed.known.set(event.k, { s: eventSignature, q: nextSequence }); sequenceNumbers[index] = nextSequence; changed = true; return; }
    hits++;
    if (knownEvent.s !== eventSignature || moved) { knownEvent.s = eventSignature; knownEvent.q = nextSequence; changed = true; }
    sequenceNumbers[index] = knownEvent.q;
  });

  if (hits < before) return null;
  if (changed) feed.seq = nextSequence;
  return sequenceNumbers;
}

// Everything about an event that can differ from one build to the next. Its text, its tool calls, its results and its time never do:
// they come from one transcript record (same key = same record). And `t` moves only when time zero does, which numberEvents looks at once for all.
function signature(event) {
  let detail = '';
  if (event.kind === 'tools') detail = event.tools.length + ':' + event.tools[event.tools.length - 1].id;
  else if (event.kind === 'usage') detail = `${event.u.i},${event.u.o},${event.u.r},${event.u.w},${event.model}`;
  else if (event.kind === 'order') detail = `${event.toolId},${event.bg},${event.title}`;
  else if (event.kind === 'finish') detail = event.ts;
  return event.kind + '|' + event.agent + '|' + (event.to || '') + '|' + (event.end || '') + '|' + detail;
}

// The events that are new or different since sequence number `after`, in timeline order. Nothing to scan when the reader is up to date.
function feedSince(entry, after) {
  const events = entry.tl.events, sequenceNumbers = entry.sq, out = [];
  if (after < entry.tl.seq) for (let index = 0; index < events.length; index++) if ((sequenceNumbers ? sequenceNumbers[index] : 1) > after) out.push(events[index]);
  return out;
}

module.exports = { createFeed };
