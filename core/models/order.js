const { Event } = require('./event');

// An agent giving work to another (`to`): the lead launching a sub-agent, or a workflow starting one (`wf`: which workflow).
// `toolId` is the call that launched it, `bg` whether it runs in the background.
class Order extends Event {
  static kind = 'order';
  constructor({ ts, agent, to, toolId, bg, wf, text, title, key }) {
    super({ ts, agent });
    this.to = to;
    if (toolId) this.toolId = toolId;
    this.bg = bg;
    if (wf) this.wf = wf;
    this.text = text;
    this.title = title;
    this.k = key;
  }

  signatureDetail() { return `${this.toolId},${this.bg},${this.title}`; }
}

module.exports = { Order };
