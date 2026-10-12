const { Event } = require('../event');

// What the human typed. `translations`: as for Say.
class UserMessage extends Event {
  static kind = 'user';
  constructor({ timestamp, text, translations, key }) {
    super({ timestamp, agentId: 'user', key });
    this.text = text;
    this.translations = translations || {};
  }
}

module.exports = { UserMessage };
