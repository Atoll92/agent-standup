const { Event } = require('./event');

// A workflow's journal says an agent (`child`, by the name of its file) handed its result back. The journal has no times.
class WorkflowDone extends Event {
  static kind = 'wfdone';
  constructor({ agent, child }) {
    super({ ts: 0, agent });
    this.child = child;
  }
}

module.exports = { WorkflowDone };
