const { Say } = require('./say');

// The last thing a sub-agent says: its report back to whoever gave it the work (`to`, filled in once every order is known).
class Report extends Say {
  static kind = 'report';
  constructor({ ts, agent, text, thought, to = null }) {
    super({ ts, agent, text, thought });
    this.to = to;
  }

  static from(say) {
    const report = new Report({ ts: say.ts, agent: say.agent, text: say.text, thought: say.th });
    report.k = say.k;
    if (say.endsTurn) report.endTurn();
    return report;
  }
}

module.exports = { Report };
