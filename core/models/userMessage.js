const { Event } = require('./event');

// What the human typed.
class UserMessage extends Event {
  static kind = 'user';
  constructor({ ts, text }) {
    super({ ts, agent: 'user' });
    this.text = text;
  }
}

module.exports = { UserMessage };
