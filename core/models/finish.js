const { Event } = require('./event');

// A sub-agent is done (`to`: the agent it reports to).
class Finish extends Event {
  static kind = 'finish';
  constructor({ ts, agent, to, key }) {
    super({ ts, agent });
    this.to = to;
    this.k = key;
  }

  get bookkeeping() { return true; }
  signatureDetail() { return this.ts; }
}

module.exports = { Finish };
