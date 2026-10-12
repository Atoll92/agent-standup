const { Event } = require('../event');

// The tool compacted the conversation.
class Compact extends Event {
  static kind = 'compact';
  get bookkeeping() { return true; }
}

module.exports = { Compact };
