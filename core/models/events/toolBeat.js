const { Event } = require('../event');

// The consecutive tool calls of one agent, as one activity. It keeps the key and the thought of its first call;
// a beat that closed a turn takes no more calls.
class ToolBeat extends Event {
  static kind = 'tools';
  constructor({ timestamp, agentId, tools, thought, key }) {
    super({ timestamp, agentId, key });
    this.tools = tools;
    this.thought = thought || '';
  }

  static startingWith(call) {
    const beat = new ToolBeat({ timestamp: call.timestamp, agentId: call.agentId, tools: [call.tool], thought: call.thought, key: call.key });
    if (call.endsTurn) beat.endTurn();
    return beat;
  }

  // Can this call join the beat? (the same agent, and the turn is not over)
  accepts(call) { return call.agentId === this.agentId && !this.endsTurn; }

  add(call) {
    this.tools.push(call.tool);
    if (call.endsTurn) this.endTurn();
  }

  signatureDetail() { return this.tools.length + ':' + this.tools[this.tools.length - 1].id; }
}

module.exports = { ToolBeat };
