const { Event } = require('./event');

// A workflow's journal says an agent (`childId`, by the name of its file) handed its result back. The journal has no times.
// Never sent to a display.
class WorkflowDone extends Event {
  static kind = 'wfdone';
  constructor({ agentId, childId, key }) {
    super({ timestamp: 0, agentId, key });
    this.childId = childId;
  }
}

module.exports = { WorkflowDone };
