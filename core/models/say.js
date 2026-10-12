const { Event } = require('./event');

// What an agent says. `thought`: what it was thinking before, when the transcript kept it (shown as an inner thought).
class Say extends Event {
  static kind = 'say';
  constructor({ ts, agent, text, thought }) {
    super({ ts, agent });
    this.text = text;
    if (thought) this.th = thought;
  }
}

module.exports = { Say };
