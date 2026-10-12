const { Event } = require('./event');

// The sub-agent that a call launched (`toolId`) is done: it answered, or a notification says it stopped.
class AgentDone extends Event {
  static kind = 'agentdone';
  constructor({ ts, agent, toolId }) {
    super({ ts, agent });
    this.toolId = toolId;
  }
}

module.exports = { AgentDone };
