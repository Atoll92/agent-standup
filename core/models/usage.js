const { Event } = require('./event');

// The tokens one message used: tokens = { input, output, cacheReads, cacheWrites }, and the model.
// `contextWindow`: the size of the model's context window, when the transcript says.
class Usage extends Event {
  static kind = 'usage';
  constructor({ timestamp, agentId, tokens, model, contextWindow, key }) {
    super({ timestamp, agentId, key });
    this.tokens = tokens;
    this.model = model;
    this.contextWindow = contextWindow;
  }

  get bookkeeping() { return true; }
  signatureDetail() {
    const { input, output, cacheReads, cacheWrites } = this.tokens;
    return `${input},${output},${cacheReads},${cacheWrites},${this.model}`;
  }
}

module.exports = { Usage };
