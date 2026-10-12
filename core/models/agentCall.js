const { Event } = require('./event');

// The lead launching a sub-agent (Claude Code's Agent tool), as the transcript has it. The timeline turns it into an Order
// once it knows which sub-agent it created.
class AgentCall extends Event {
  static kind = 'agentcall';
  constructor({ ts, agent, toolId, bg, text, title }) {
    super({ ts, agent });
    this.toolId = toolId;
    this.bg = bg;
    this.text = text;
    this.title = title;
  }
}

module.exports = { AgentCall };
