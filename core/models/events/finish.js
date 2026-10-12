const { Event } = require('../event');

// A sub-agent is done (`recipientId`: the agent it reports to).
class Finish extends Event {
  static kind = 'finish';
  constructor({ timestamp, agentId, recipientId, key }) {
    super({ timestamp, agentId, key });
    this.recipientId = recipientId;
  }

  get bookkeeping() { return true; }
  signatureDetail() { return this.timestamp; }
}

module.exports = { Finish };
