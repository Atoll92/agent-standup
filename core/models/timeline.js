// A session as a call: who is in it and what happened, in time order.
//
// `feedId` and `sequence` are the live feed's (see feed.js): which memory the timeline was numbered in, and the sequence number
// it reached. A reader holding a sequence number of that feedId asks for what is new or different since.
class Timeline {
  constructor({ sessionId, project, agents, events, durationMs, recentUntil, feedId, sequence }) {
    this.sessionId = sessionId;       // the session, within its project
    this.project = project;           // the project the session is in (a source's name for a group of sessions)
    this.agents = agents;             // Agents, the lead first
    this.events = events;             // Events, in time order, each with its time since time zero (elapsed)
    this.durationMs = durationMs;     // from the first thing said or done to the last event
    this.recentUntil = recentUntil;   // when the timeline can change without any file being written (see timeline.js), 0 when it cannot
    this.feedId = feedId;
    this.sequence = sequence;
  }

  agent(id) { return this.agents.find((agent) => agent.id === id) || null; }
  get lead() { return this.agents.find((agent) => agent.isLead) || null; }
}

module.exports = { Timeline };
