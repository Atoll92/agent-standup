const { Event } = require('./event');

// The tokens one message used: u = { i (input), o (output), r (cache reads), w (cache writes) }, and the model.
// `cw`: the size of the context window, when the transcript says.
class Usage extends Event {
  static kind = 'usage';
  constructor({ ts, agent, u, model, cw, key }) {
    super({ ts, agent });
    this.u = u;
    this.model = model;
    if (cw) this.cw = cw;
    this.k = key;
  }

  get bookkeeping() { return true; }
  signatureDetail() { return `${this.u.i},${this.u.o},${this.u.r},${this.u.w},${this.model}`; }
}

module.exports = { Usage };
