const { Event } = require('./event');

// The sub-agent that a call launched (`callId`) is done: it answered, or a notification says it stopped. Never sent to a display.
class AgentDone extends Event {
  static kind = 'agentdone';
  constructor({ timestamp, agentId, callId, key }) {
    super({ timestamp, agentId, key });
    this.callId = callId;
  }
}

module.exports = { AgentDone };
