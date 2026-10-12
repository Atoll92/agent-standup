// Codex (OpenAI's Codex: the desktop app and the command line) as a source of sessions (see core/index.js for what a source is).
// A Codex session is one file somewhere else (see files.js), in another format (see record.js), and has no sub-agents.
// Its records become the events a Claude Code record gives (say, user, tool, results, usage, compact), so everything after that is shared:
// the timeline, the live feed, the board.
const fs = require('fs');
const { PROJ, createCodexFiles } = require('./files');
const { createCodexBoard } = require('./board');
const { parser } = require('./record');
const { toolLabel, clip, RESULT_MAX } = require('../../transcript');

// `home`: the folder Codex keeps its files in, or null for no Codex sessions. `scanTtlMs`: see createCodexFiles.
function createCodexSource({ home = null, scanTtlMs, reader }) {
  const codex = createCodexFiles({ home, scanTtlMs });
  const board = createCodexBoard({ files: codex });
  const record = parser({ toolLabel, clip, resultMax: RESULT_MAX });

  // Just the lead: the thread is the only agent.
  function readSession(proj, id, touched) {
    const mainFile = codex.fileOf(id) || '';
    if (!fs.existsSync(mainFile)) throw new Error('session not found');
    touched.push(mainFile);
    return {
      agents: { main: { id: 'main', role: 'Lead', type: 'main', name: 'Codex' } },
      states: [reader.readNew(mainFile, 'main', false, record)],
      runs: {},
    };
  }

  function stamp(proj, id) {
    try { const stat = fs.statSync(codex.fileOf(id) || ''); return stat.mtimeMs + stat.size; } catch { return 0; }
  }

  return {
    name: 'codex',
    home,
    // Every Codex session is listed under one made-up project. No Claude Code project folder can have that name.
    owns: (proj) => proj === PROJ,
    readSession,
    stamp,
    exists: (proj, id) => !!codex.fileOf(id),
    mtime: (proj, id) => { const row = codex.row(id); return row ? row.mtime : 0; },
    // A Codex session counts for a project when it was started in that folder.
    inProject: (proj, id, folder) => codex.inProject(id, folder),
    recent: (projFilter) => codex.sessions().filter((rollout) => !projFilter || codex.inProject(rollout.id, projFilter)).map((rollout) => ({ proj: PROJ, id: rollout.id, mtime: rollout.mtime })),

    listSessions: board.listSessions,
    boardRows: board.boardRows,

    files: codex,   // what the Codex files say, for the tests
  };
}

module.exports = { createCodexSource };
