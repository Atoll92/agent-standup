const { Signal } = require('../signal');

// The sub-agent that the call `callId` launched is done: it answered, or a notification says it stopped.
// The timeline turns it into a Finish.
class AgentDone extends Signal {
  static kind = 'agentdone';
  constructor({ timestamp, agentId, callId, key }) {
    super({ timestamp, agentId, key });
    this.callId = callId;
  }
}

module.exports = { AgentDone };
