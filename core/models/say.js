const { Event } = require('./event');

// What an agent says. `thought`: what it was thinking before, when the transcript kept it (shown as an inner thought).
class Say extends Event {
  static kind = 'say';
  constructor({ timestamp, agentId, text, thought, key }) {
    super({ timestamp, agentId, key });
    this.text = text;
    this.thought = thought || '';
  }
}

module.exports = { Say };
