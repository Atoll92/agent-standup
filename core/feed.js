// The timeline of a session, kept in memory and followed live.
//
// timelineEntry(proj, id) gives the timeline of a session, rebuilt only when a file of the session changed.
// feedSince(entry, after) gives what is new or different since a reader last looked: the live feed.
const crypto = require('crypto');

const MAX_CACHED_SESSIONS = 3;
const MIN_REBUILD_GAP_MS = 250;

// The cache of timelines is kept in the feed that is created here, and nowhere else.
function createFeed({ sourceOf, reader, buildTimeline }) {
  // "proj/id" → an entry: { stamp (of the files), timeline, builtAt, buildMs (how long the build took), files[], feed, sequenceNumbers, recentUntil }
  // (the server keeps what it made of an entry on it too: json, gz, idle)
  const entries = new Map();

  function timelineEntry(proj, id) {
    const key = proj + '/' + id, stamp = sourceOf(proj).stamp(proj, id), cached = entries.get(key), now = Date.now();
    if (cached && isStillGood(cached, stamp, now)) {
      entries.delete(key); entries.set(key, cached);   // asked for again: the last one to be dropped
      return cached;
    }

    const started = Date.now(), files = [];
    const timeline = buildTimeline(proj, id, files), feed = feedStep(cached && cached.feed, timeline, files);
    const entry = { stamp, timeline, builtAt: Date.now(), buildMs: Date.now() - started, files, feed, sequenceNumbers: feed.sequenceNumbers, recentUntil: timeline.recentUntil || 0 };
    entries.delete(key); entries.set(key, entry);
    dropOldSessions();
    return entry;
  }

  // Free the memory of sessions nobody is looking at any more. Their live feed goes with them:
  // a reader still on one of them is told to load it again.
  function dropOldSessions() {
    while (entries.size > MAX_CACHED_SESSIONS) {
      const [oldKey, old] = entries.entries().next().value;
      entries.delete(oldKey);
      for (const file of old.files) reader.fileStates.delete(file);
    }
  }

  const generationOf = (file) => (reader.fileStates.get(file) || {}).gen;

  // Numbers the events of a fresh build against the previous feed (if it is still valid), and returns the feed to keep.
  function feedStep(previous, timeline, files) {
    let feed = previous && filesNotRewritten(previous, files) ? previous : null;
    let sequenceNumbers = feed && numberEvents(feed, timeline);
    if (!sequenceNumbers) { feed = newFeed(); sequenceNumbers = numberEvents(feed, timeline); }

    for (const file of files) feed.generations.set(file, generationOf(file));
    feed.sequenceNumbers = sequenceNumbers;
    timeline.feedId = feed.id;
    timeline.sequence = feed.sequence;
    return feed;
  }

  // A transcript read again from its start numbers its events again: the keys no longer mean the same thing.
  function filesNotRewritten(feed, files) {
    return files.every((file) => { const previousGeneration = feed.generations.get(file); return previousGeneration === undefined || previousGeneration === generationOf(file); });
  }

  const timeline = (proj, id) => timelineEntry(proj, id).timeline;

  return { timelineEntry, timeline, feedSince };
}

// Nothing was written (a sub-agent's 4-minute silence rule can flip without any file change, hence recentUntil);
// or a very big session, which is not rebuilt on every poll: not before twice the time a build took.
function isStillGood(cached, stamp, now) {
  const unchanged = cached.stamp === stamp && !(cached.recentUntil && now > cached.recentUntil);
  const builtJustNow = now - cached.builtAt < Math.max(MIN_REBUILD_GAP_MS, cached.buildMs * 2);
  return unchanged || builtJustNow;
}

// ---- The live feed
//
// The timeline is sorted again at each build, and events already sent can change (an order typed mid-turn is stamped at typing time
// and lands before what the reader has; a sub-agent's last line becomes its report; a tool call joins an earlier beat),
// so a reader cannot ask for "what comes after index n". Instead every event has a key that never changes,
// each build that changes something gets the next sequence number, and a reader asks for the events that are new or different
// since the number it holds.
//
// A feed is { id, sequence, known: key → { signature, sequence }, generations: file → generation, firstEventTime, sequenceNumbers }.
// `id` names this memory: it is a new one after a restart, after the session left the cache, or when a transcript was rewritten,
// and the reader then loads the whole session again.

const newFeed = () => ({ id: crypto.randomBytes(6).toString('hex'), sequence: 0, known: new Map(), generations: new Map() });

// Gives each event the sequence number at which it last changed, and moves the feed on if anything did.
// Returns that list of numbers (one per event), or null when an event the reader may hold no longer exists:
// nothing can tell it to drop it, so the caller starts a new feed.
function numberEvents(feed, timeline) {
  const events = timeline.events, sequenceNumbers = new Uint32Array(events.length), nextSequence = feed.sequence + 1, before = feed.known.size;

  // Time zero moved (something now comes before the first line): every event's elapsed time is different.
  const first = events.find((event) => !event.bookkeeping), firstEventTime = first ? first.timestamp : 0, moved = feed.firstEventTime !== firstEventTime;
  feed.firstEventTime = firstEventTime;

  let hits = 0, changed = false;
  events.forEach((event, index) => {
    const signature = event.signature(), known = feed.known.get(event.key);
    if (!known) { feed.known.set(event.key, { signature, sequence: nextSequence }); sequenceNumbers[index] = nextSequence; changed = true; return; }
    hits++;
    if (known.signature !== signature || moved) { known.signature = signature; known.sequence = nextSequence; changed = true; }
    sequenceNumbers[index] = known.sequence;
  });

  if (hits < before) return null;
  if (changed) feed.sequence = nextSequence;
  return sequenceNumbers;
}

// The events that are new or different since sequence number `after`, in timeline order. Nothing to scan when the reader is up to date.
function feedSince(entry, after) {
  const events = entry.timeline.events, sequenceNumbers = entry.sequenceNumbers, found = [];
  if (after < entry.timeline.sequence) for (let index = 0; index < events.length; index++) if ((sequenceNumbers ? sequenceNumbers[index] : 1) > after) found.push(events[index]);
  return found;
}

module.exports = { createFeed };
