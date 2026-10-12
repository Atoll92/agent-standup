const { Event } = require('./event');

// The answer to a Workflow call names the run it started: that run's agents are in subagents/workflows/<run>/.
class WorkflowRun extends Event {
  static kind = 'wfrun';
  constructor({ ts, agent, toolId, run }) {
    super({ ts, agent });
    this.toolId = toolId;
    this.run = run;
  }
}

module.exports = { WorkflowRun };
