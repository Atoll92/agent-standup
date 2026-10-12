const { Event } = require('./event');

// What the human typed.
class UserMessage extends Event {
  static kind = 'user';
  constructor({ timestamp, text, key }) {
    super({ timestamp, agentId: 'user', key });
    this.text = text;
  }
}

module.exports = { UserMessage };
