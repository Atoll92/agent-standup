// The board: one cheap row per recent session, whatever tool it is from, so many parallel sessions can be watched at once.
// What each session is doing comes from its source (see sources/claude/board.js for the states).

const HOUR_MS = 3600e3;
const SESSION_WINDOW_MS = 12 * HOUR_MS;   // sessions older than this are not on the board

// Newest first. Two sessions from different tools written to at the very same millisecond keep the order of the sources.
const listedFirst = (first, second) => second.mtime - first.mtime;
const activeFirst = (first, second) => second.lastActiveAt - first.lastActiveAt;

function createBoard({ sources }) {
  let sessionsMemo = { at: 0, rows: [] };
  // The sessions to pick from, newest first, with a title each. Shared by all the polls of two seconds.
  function listSessions() {
    if (Date.now() - sessionsMemo.at < 2000) return sessionsMemo.rows;
    const rows = sources.flatMap((source) => source.listSessions()).sort(listedFirst);
    sessionsMemo = { at: Date.now(), rows };
    return rows;
  }

  let boardMemo = { at: 0, rows: [] };
  // What each recent session is doing (SessionStatus), the most recently active first. Several windows polling at once share one scan.
  function boardRows() {
    if (Date.now() - boardMemo.at < 1200) return boardMemo.rows;
    const now = Date.now();
    const rows = sources.flatMap((source) => source.boardRows({ now, windowMs: SESSION_WINDOW_MS })).sort(activeFirst);
    boardMemo = { at: Date.now(), rows };
    return rows;
  }

  return { listSessions, boardRows };
}

module.exports = { createBoard };
