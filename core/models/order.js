const { Event } = require('./event');

// An agent giving work to another (`recipientId`): the lead launching a sub-agent, or a workflow starting one (`workflow`: which run).
// `callId` is the tool call that launched it, `background` whether it runs in the background.
class Order extends Event {
  static kind = 'order';
  constructor({ timestamp, agentId, recipientId, callId, background, workflow, text, title, key }) {
    super({ timestamp, agentId, key });
    this.recipientId = recipientId;
    this.callId = callId;
    this.background = background;
    this.workflow = workflow;
    this.text = text;
    this.title = title;
  }

  signatureDetail() { return `${this.callId},${this.background},${this.title}`; }
}

module.exports = { Order };
