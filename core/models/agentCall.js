const { Event } = require('./event');

// The lead launching a sub-agent (Claude Code's Agent tool), as the transcript has it. The timeline turns it into an Order
// once it knows which sub-agent it created. Never sent to a display.
class AgentCall extends Event {
  static kind = 'agentcall';
  constructor({ timestamp, agentId, callId, background, text, title, key }) {
    super({ timestamp, agentId, key });
    this.callId = callId;
    this.background = background;
    this.text = text;
    this.title = title;
  }
}

module.exports = { AgentCall };
