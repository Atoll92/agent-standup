// The core: reads Claude Code and Codex sessions and builds what a display needs. No web server, no UI, no environment:
// everything it reads and keeps belongs to the core that createCore returns, so two cores can live side by side.
const { createCodex } = require('../codex.js');
const { createSessionFiles } = require('./sessionFiles');
const { createReader } = require('./reader');
const { createTimeline } = require('./timeline');
const { createFeed } = require('./feed');
const { createBoard } = require('./board');
const { createCurrent } = require('./current');
const { configFromEnv } = require('./config');

// root:      the folder Claude Code writes its sessions to (one folder per project, see config.js)
// codexHome: the folder Codex keeps its files in, or null to leave Codex sessions out
function createCore({ root, codexHome = null }) {
  if (!root) throw new Error('createCore needs the folder the sessions are in (root)');
  const codex = createCodex({ home: codexHome });
  const files = createSessionFiles({ root });
  const reader = createReader();
  const { buildTimeline } = createTimeline({ root, codex, files, reader });
  const { timelineEntry, timeline, feedSince } = createFeed({ root, codex, files, reader, buildTimeline });
  const { listSessions, boardRows } = createBoard({ root, codex, files });
  const { currentSession, sessionMtime } = createCurrent({ root, codex, files });

  return {
    root, codex,
    subFiles: files.subFiles,                      // the transcripts of a session's sub-agents
    timelineEntry, timeline, feedSince,            // a session as a timeline of events, and what is new in it
    listSessions, boardRows,                       // the sessions to pick from, and what each one is doing
    currentSession, sessionMtime,                  // which session to follow
  };
}

module.exports = { createCore, configFromEnv };
