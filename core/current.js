// Which session the live view follows.

// A session written to in the last 90 s keeps the call, so another session writing elsewhere does not steal it mid-line.
const STICK_MS = 90000;

const isSafeName = (name) => typeof name === 'string' && /^[\w.\-]+$/.test(name) && name !== '..';

// `sources` are all the sources, `sourceOf(proj)` gives the one a project belongs to.
function createCurrent({ sources, sourceOf }) {
  const sessionMtime = (proj, id) => sourceOf(proj).mtime(proj, id);

  // The session to follow, as { proj, id, mtime } ({} when there is none), chosen in this order:
  //   1. `stick`, the one followed so far, while it is still active (and still in the project asked for)
  //   2. the one named by projFilter + idFilter (pinned from the board)
  //   3. the most recently active one (limited to projFilter when given; everywhere if that project has none)
  function currentSession(projFilter, idFilter, stick) {
    return stickyChoice(projFilter, stick) || pinnedChoice(projFilter, idFilter) || newestChoice(projFilter)
      || (projFilter ? currentSession('', '', stick) : {});
  }

  function stickyChoice(projFilter, stick) {
    if (!stick || !isSafeName(stick.id) || !isSafeName(stick.proj)) return null;
    const inProject = !projFilter || sourceOf(stick.proj).inProject(stick.proj, stick.id, projFilter);
    if (!inProject || Date.now() - sessionMtime(stick.proj, stick.id) >= STICK_MS) return null;
    return { proj: stick.proj, id: stick.id, mtime: sessionMtime(stick.proj, stick.id) };
  }

  function pinnedChoice(projFilter, idFilter) {
    if (!idFilter || !projFilter || !isSafeName(idFilter) || !isSafeName(projFilter)) return null;
    return sourceOf(projFilter).exists(projFilter, idFilter) ? { proj: projFilter, id: idFilter, mtime: Date.now() } : null;
  }

  function newestChoice(projFilter) {
    let best = null;
    for (const source of sources) {
      for (const { proj, id, mtime } of source.recent(projFilter)) if (!best || mtime > best.mtime) best = { proj, id, mtime };
    }
    return best;
  }

  return { currentSession, sessionMtime };
}

module.exports = { createCurrent };
