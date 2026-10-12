// A session to pick from: what it is called and where it is, as far as can be said without reading it all.
class SessionListing {
  constructor({ project, sessionId, source, title, projectLabel, lastActiveAt, sizeBytes, subAgents }) {
    this.project = project;             // as its source calls it (see sources/source.js)
    this.sessionId = sessionId;
    this.source = source;               // 'claude', 'codex'
    this.title = title;                 // the name the person gave it, else the tool's, else what was first typed
    this.projectLabel = projectLabel;   // the project as a person reads it ('code/agent-standup', 'Codex · work/site')
    this.lastActiveAt = lastActiveAt;   // when its transcript was last written to (ms)
    this.sizeBytes = sizeBytes;         // of its main transcript
    this.subAgents = subAgents || 0;    // how many sub-agent transcripts it has
  }
}

module.exports = { SessionListing };
