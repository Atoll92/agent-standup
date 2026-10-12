const { Signal } = require('../signal');

// A workflow's journal says an agent (`childId`, by the name of its file) handed its result back. The journal has no times.
class WorkflowDone extends Signal {
  static kind = 'wfdone';
  constructor({ agentId, childId, key }) {
    super({ timestamp: 0, agentId, key });
    this.childId = childId;
  }
}

module.exports = { WorkflowDone };
