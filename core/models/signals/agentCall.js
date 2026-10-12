const { Signal } = require('../signal');

// The lead launching a sub-agent (Claude Code's Agent tool) with the call `callId`. The timeline turns it into an Order
// once it knows which sub-agent that call created. `name`: the name the agent was given at launch, if any (see claude/agentNames.js).
class AgentCall extends Signal {
  static kind = 'agentcall';
  constructor({ timestamp, agentId, callId, background, text, title, name, key }) {
    super({ timestamp, agentId, key });
    this.callId = callId;
    this.background = background;
    this.text = text;
    this.title = title;
    if (name) this.name = name;
  }
}

module.exports = { AgentCall };
