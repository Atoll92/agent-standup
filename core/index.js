// The core: reads the sessions of the agent tools (Claude Code, Codex) and builds what a display needs.
// No web server, no UI, no environment: everything it reads and keeps belongs to the core that createCore returns, so two cores can live side by side.
//
// A SOURCE is one tool's sessions: where its files are, and what they say. Sessions are addressed as (proj, id), a project being
// whatever the source calls a group of sessions. The rest of the core (timeline, feed, board, current session) works through this interface and
// knows nothing about any tool:
//
//   name                          'claude', 'codex'
//   owns(proj)                    (only for sources other than Claude Code, which takes every project nobody else owns)
//   readSession(proj, id, files)  { agents, states, runs }: the session's agents and what each of them did, as the reader returns it
//                                 (see timeline.js); throws 'session not found'; every file read is added to `files`
//   exists(proj, id)              is the session there
//   mtime(proj, id)               when it was last active (0: not there)
//   stamp(proj, id)               a number that changes when anything in its files changes
//   inProject(proj, id, folder)   does it belong to the project asked for by folder name
//   recent(folder)                [{ proj, id, mtime }]: its sessions in that project (all of them without one)
//   listSessions()                its most recent sessions with a title each, to pick from (rows have at least proj, id, mtime, title)
//   boardRows({ now, windowMs })  what each session written to in the last windowMs is doing (rows have at least proj, id, mtime, state)
//
// A source is made from the folder its files are in and the reader (reader.js) that remembers what was read of each file.
const { createReader } = require('./reader');
const { createTimeline } = require('./timeline');
const { createFeed } = require('./feed');
const { createBoard } = require('./board');
const { createCurrent } = require('./current');
const { createClaudeSource } = require('./sources/claude');
const { createCodexSource } = require('./sources/codex');
const { configFromEnv } = require('./config');

// root:      the folder Claude Code writes its sessions to (one folder per project, see config.js)
// codexHome: the folder Codex keeps its files in, or null to leave Codex sessions out
function createCore({ root, codexHome = null }) {
  if (!root) throw new Error('createCore needs the folder the sessions are in (root)');
  const reader = createReader();
  const claude = createClaudeSource({ root, reader });
  const codex = createCodexSource({ home: codexHome, reader });

  const sources = [claude, codex];
  // Claude Code's projects are the folders of `root`: it takes whatever the other sources do not claim.
  const sourceOf = (proj) => [codex].find((source) => source.owns(proj)) || claude;

  const { buildTimeline } = createTimeline({ sourceOf });
  const { timelineEntry, timeline, feedSince } = createFeed({ sourceOf, reader, buildTimeline });
  const { listSessions, boardRows } = createBoard({ sources });
  const { currentSession, sessionMtime } = createCurrent({ sources, sourceOf });

  return {
    root, sources: { claude, codex },
    exists: (proj, id) => sourceOf(proj).exists(proj, id),   // is the session there
    timelineEntry, timeline, feedSince,                      // a session as a timeline of events, and what is new in it
    listSessions, boardRows,                                 // the sessions to pick from, and what each one is doing
    currentSession, sessionMtime,                            // which session to follow
  };
}

module.exports = { createCore, configFromEnv };
