// What a transcript says that is not something to show: who launched whom, who is done. The timeline reads signals to build
// its events (an Order, a Finish) and then drops them, so they never reach a display.
//
// Signals are read into the same list as the events of their file (a source's reader state.raw), because a record's key is its rank
// in that list: they take their place in it, so the keys of the events after them never change.
class Signal {
  constructor({ timestamp, agentId, key }) {
    this.timestamp = timestamp;          // when, in ms since the epoch (0 when the file has no times)
    this.agentId = agentId;              // whose file said it
    this.kind = this.constructor.kind;   // 'agentcall', 'agentdone', 'wfrun', 'wfdone'
    this.key = key;                      // its rank in its file (see above)
  }
}

module.exports = { Signal };
