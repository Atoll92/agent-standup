const { Event } = require('./event');

// One call of a tool, as the transcript has it. A timeline shows consecutive calls of one agent as one ToolBeat.
// `tool` is what the call looks like on a screen (see transcript.toolLabel).
class ToolCall extends Event {
  static kind = 'tool';
  constructor({ ts, agent, tool, thought }) {
    super({ ts, agent });
    this.tool = tool;
    if (thought) this.th = thought;
  }
}

module.exports = { ToolCall };
