const { Event } = require('./event');

// One call of a tool, as the transcript has it. A timeline shows consecutive calls of one agent as one ToolBeat.
// `tool` is what the call looks like on a screen (see transcript.toolLabel).
class ToolCall extends Event {
  static kind = 'tool';
  constructor({ timestamp, agentId, tool, thought, key }) {
    super({ timestamp, agentId, key });
    this.tool = tool;
    this.thought = thought || '';
  }
}

module.exports = { ToolCall };
