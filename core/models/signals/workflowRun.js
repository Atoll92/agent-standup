const { Signal } = require('../signal');

// The answer to a Workflow call (`callId`) names the run it started: that run's agents are in subagents/workflows/<run>/.
class WorkflowRun extends Signal {
  static kind = 'wfrun';
  constructor({ timestamp, agentId, callId, run, key }) {
    super({ timestamp, agentId, key });
    this.callId = callId;
    this.run = run;
  }
}

module.exports = { WorkflowRun };
