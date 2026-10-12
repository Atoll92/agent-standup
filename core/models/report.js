const { Say } = require('./say');

// The last thing a sub-agent says: its report back to whoever gave it the work (`recipientId`, filled in once every order is known).
class Report extends Say {
  static kind = 'report';
  constructor({ timestamp, agentId, text, thought, recipientId = null, key }) {
    super({ timestamp, agentId, text, thought, key });
    this.recipientId = recipientId;
  }

  static from(say) {
    const report = new Report({ timestamp: say.timestamp, agentId: say.agentId, text: say.text, thought: say.thought, key: say.key });
    if (say.endsTurn) report.endTurn();
    return report;
  }
}

module.exports = { Report };
