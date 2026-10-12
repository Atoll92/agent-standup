const { Event } = require('../event');

// What tool calls returned. Each item is { callId, failed, output (trimmed), pictures (how many came back) }.
class Results extends Event {
  static kind = 'results';
  constructor({ timestamp, agentId, items, key }) {
    super({ timestamp, agentId, key });
    this.items = items;
  }
}

module.exports = { Results };
