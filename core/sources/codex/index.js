// Codex (OpenAI's Codex: the desktop app and the command line) as a source of sessions (see core/index.js for what a source is).
// A Codex session is one file somewhere else (see files.js), in another format (see record.js), and has no sub-agents.
// Its records become the events a Claude Code record gives (say, user, tool, results, usage, compact), so everything after that is shared:
// the timeline, the live feed, the board.
const fs = require('fs');
const { PROJ, createCodexFiles } = require('./files');
const { parser } = require('./record');
const { toolLabel, clip, RESULT_MAX } = require('../../transcript');

const MAX_BOARD_ROWS = 20;   // rows on the board
const MAX_LISTED = 30;       // sessions in the list to pick from

// `home`: the folder Codex keeps its files in, or null for no Codex sessions. `scanTtlMs`: see createCodexFiles.
function createCodexSource({ home = null, scanTtlMs, reader }) {
  const codex = createCodexFiles({ home, scanTtlMs });
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
    try { const s = fs.statSync(codex.fileOf(id) || ''); return s.mtimeMs + s.size; } catch { return 0; }
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
    recent: (projFilter) => codex.sessions().filter((r) => !projFilter || codex.inProject(r.id, projFilter)).map((r) => ({ proj: PROJ, id: r.id, mtime: r.mtime })),

    listSessions: () => codex.sessions(MAX_LISTED).map((r) => ({
      proj: PROJ, id: r.id, mtime: r.mtime, size: r.size, agents: 0, title: codex.title(r), project: codex.projectLabel(r.cwd), source: 'codex',
    })),
    boardRows: ({ now, windowMs }) => codex.sessions().filter((r) => now - r.mtime < windowMs).slice(0, MAX_BOARD_ROWS).map((r) => codex.boardRow(r, now)),

    files: codex,   // what the Codex files say, for the tests
  };
}

module.exports = { createCodexSource };
