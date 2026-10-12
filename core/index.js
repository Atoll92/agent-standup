// The core: reads the sessions of the agent tools (Claude Code, Codex) and builds what a display needs.
// No web server, no UI, no environment: everything it reads and keeps belongs to the core that createCore returns, so two cores can live side by side.
//
// Each tool's sessions are a SOURCE (see sources/source.js for what one is): the rest of the core knows no tool by name.
const { createReader } = require('./reader');
const { createTimeline } = require('./timeline');
const { createFeed } = require('./feed');
const { createBoard } = require('./board');
const { createCurrent } = require('./current');
const { ClaudeSource } = require('./sources/claude');
const { CodexSource } = require('./sources/codex');
const { configFromEnv } = require('./config');

// root:      the folder Claude Code writes its sessions to (one folder per project, see config.js)
// codexHome: the folder Codex keeps its files in, or null to leave Codex sessions out
function createCore({ root, codexHome = null }) {
  if (!root) throw new Error('createCore needs the folder the sessions are in (root)');
  const reader = createReader();
  const claude = new ClaudeSource({ root, reader });
  const codex = new CodexSource({ home: codexHome, reader });

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
