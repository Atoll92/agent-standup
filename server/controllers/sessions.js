// The sessions: the list to pick from, their projects, the board, the one to follow, and one session as a timeline (whole, or its live feed).
const zlib = require('zlib');
const { serializeEvent, serializeAgent, serializeTimeline, serializeFeed, serializeSessionListing } = require('../../core/serializers/web');
const { demoTimeline } = require('../../core/demo');

const SAFE_NAME = /^[\w.\-]+$/;   // a project or a session id: a file name, never a path
const isSafeName = (name) => SAFE_NAME.test(name) && name !== '..' && name.length <= 200;
const DEMO = '_demo';

class SessionsController {
  constructor({ core, boardRows }) {
    this.core = core;
    this.boardRows = boardRows;
  }

  // GET /api/sessions
  index(exchange) { exchange.json(this.core.listSessions().map(serializeSessionListing)); }

  // GET /api/projects: the projects (working folders), the most recently active first: the live view can follow one of them.
  projects(exchange) {
    const byProject = new Map();
    for (const listing of this.core.listSessions()) {
      const project = byProject.get(listing.project) || { proj: listing.project, mtime: 0, sessions: 0 };
      project.mtime = Math.max(project.mtime, listing.lastActiveAt);
      project.sessions++;
      byProject.set(listing.project, project);
    }
    exchange.json([...byProject.values()].sort((first, second) => second.mtime - first.mtime));
  }

  // GET /api/board: what every recent session is doing.
  board(exchange) { exchange.json(this.boardRows()); }

  // GET /api/current?proj&id&sproj&sid: the session the live view should follow (see core/current.js).
  current(exchange) {
    const param = (name) => exchange.param(name) || '';
    exchange.json(this.core.currentSession(param('proj'), param('id'), { proj: param('sproj'), id: param('sid') }));
  }

  // GET /api/session?proj&id: a whole session.   …&after=<sequence>&ep=<feed id>: what is new or different since (the live feed).
  show(exchange) {
    const project = exchange.param('proj') || '', sessionId = exchange.param('id') || '';
    if (!isSafeName(project) || !isSafeName(sessionId)) return exchange.refuse(400, 'bad request');
    if (project !== DEMO && !this.core.exists(project, sessionId)) return exchange.json({ error: 'session not found' }, 404);

    const entry = project === DEMO ? { timeline: demoTimeline() } : this.core.timelineEntry(project, sessionId);
    const after = exchange.param('after'), feedId = exchange.param('ep');
    if (after == null) return this.#sendWhole(exchange, entry);
    if (feedId == null) return this.#sendByPosition(exchange, entry.timeline, +after);
    return this.#sendFeed(exchange, entry, feedId, +after);
  }

  // Serialized once per build of the timeline, and gzip-compressed when the browser allows it (12 MB → ~1.5 MB).
  // (What is made from an entry is kept on it: json, gz, idle. It goes when the entry does.)
  #sendWhole(exchange, entry) {
    const gzip = /\bgzip\b/.test(exchange.header('accept-encoding') || '');
    if (!entry.json) entry.json = JSON.stringify(serializeTimeline(entry.timeline));
    if (gzip && !entry.gz) entry.gz = zlib.gzipSync(entry.json, { level: 5 });
    exchange.send(200, gzip ? entry.gz : entry.json, { 'content-type': 'application/json', ...(gzip ? { 'content-encoding': 'gzip' } : {}), vary: 'accept-encoding' });
  }

  // A page loaded before 1.25.7 still asks for the events after a position.
  #sendByPosition(exchange, timeline, after) {
    exchange.json({ id: timeline.sessionId, agents: timeline.agents.map(serializeAgent), total: timeline.events.length, events: timeline.events.slice(after).map(serializeEvent) });
  }

  #sendFeed(exchange, entry, feedId, after) {
    const timeline = entry.timeline;
    // Not the feed this page was following (a restart, the session dropped from memory, a transcript rewritten): it loads the session again.
    if (feedId !== timeline.feedId || !(after >= 0 && after <= timeline.sequence)) return exchange.json({ resync: true });
    // Nothing new, which is the answer to nearly every poll: written once.
    if (after === timeline.sequence) {
      if (!entry.idle) entry.idle = JSON.stringify(serializeFeed(timeline, []));
      return exchange.send(200, entry.idle, { 'content-type': 'application/json' });
    }
    // New events and changed ones alike, whole, under the key they always had.
    exchange.json(serializeFeed(timeline, this.core.feedSince(entry, after)));
  }
}

module.exports = { SessionsController, isSafeName };
