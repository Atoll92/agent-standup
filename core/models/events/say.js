const { Event } = require('../event');

// What an agent says. `thought`: what it was thinking before, when the transcript kept it (shown as an inner thought).
// `translations`: the same text in other languages, by language code ({ fr: '…' }), when they are known in advance (the demo).
class Say extends Event {
  static kind = 'say';
  constructor({ timestamp, agentId, text, thought, translations, key }) {
    super({ timestamp, agentId, key });
    this.text = text;
    this.thought = thought || '';
    this.translations = translations || {};
  }
}

module.exports = { Say };
