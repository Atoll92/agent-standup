const { Event } = require('./event');

// The consecutive tool calls of one agent, as one activity. It keeps the key and the thought of its first call;
// a beat that closed a turn takes no more calls.
class ToolBeat extends Event {
  static kind = 'tools';
  constructor({ ts, agent, tools }) {
    super({ ts, agent });
    this.tools = tools;
  }

  static startingWith(call) {
    const beat = new ToolBeat({ ts: call.ts, agent: call.agent, tools: [call.tool] });
    if (call.endsTurn) beat.endTurn();
    if (call.th) beat.th = call.th;
    beat.k = call.k;
    return beat;
  }

  // Can this call join the beat? (the same agent, and the turn is not over)
  accepts(call) { return call.agent === this.agent && !this.end; }

  add(call) {
    this.tools.push(call.tool);
    if (call.endsTurn) this.endTurn();
  }

  signatureDetail() { return this.tools.length + ':' + this.tools[this.tools.length - 1].id; }
}

module.exports = { ToolBeat };
