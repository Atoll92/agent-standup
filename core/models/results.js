const { Event } = require('./event');

// What tool calls returned: items of { id (of the call), err, out (trimmed), img? (how many pictures came back) }.
class Results extends Event {
  static kind = 'results';
  constructor({ ts, agent, items }) {
    super({ ts, agent });
    this.items = items;
  }
}

module.exports = { Results };
