// What a session is doing right now: one row of the board.
//
// Its state is one of:
//   working   an agent is at work                   waiting  the lead waits for a sub-agent
//   blocked   it needs the person: a question, or an edit waiting for permission (a guess: Claude Code does not record permission prompts)
//   turn      the lead answered: it is the person's turn
//   idle      nothing for a while
class SessionStatus {
  static STATES = ['working', 'waiting', 'blocked', 'turn', 'idle'];

  constructor({ project, sessionId, source, title, lastActiveAt, state, pendingTool, stateAgeMs, activeSubAgents, subAgents, folderKey }) {
    if (!SessionStatus.STATES.includes(state)) throw new Error(`a session cannot be ${JSON.stringify(state)}`);
    this.project = project;                  // as its source calls it (see sources/source.js)
    this.sessionId = sessionId;
    this.source = source;                    // 'claude', 'codex'
    this.title = title;
    this.lastActiveAt = lastActiveAt;        // when its transcript was last written to (ms)
    this.state = state;
    this.pendingTool = pendingTool || '';    // the tool call that has no result yet, if any
    this.stateAgeMs = stateAgeMs;            // how long it has been so: since that call was made, or else since the transcript was written to
    this.activeSubAgents = activeSubAgents || 0;   // sub-agents written to in the last 90 s
    this.subAgents = subAgents || 0;
    this.folderKey = folderKey;              // the folder it was started in, named as Claude Code names its project folders (a Codex session says it)
  }

  get isWorking() { return this.state === 'working'; }
  get isWaitingOnSubAgent() { return this.state === 'waiting'; }
  get needsYou() { return this.state === 'blocked'; }
  get isYourTurn() { return this.state === 'turn'; }
  get isIdle() { return this.state === 'idle'; }
}

module.exports = { SessionStatus };
