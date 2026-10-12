// Something an agent said or did, at a time: an event of a session's timeline.
//
// Events cross the wire as JSON, so what a display receives is an event's own properties: ts, agent, kind, and what each kind adds.
// Everything else (methods, getters) is for the core. `k` is the key of the event in the live feed (see feed.js): it never changes.
class Event {
  constructor({ ts, agent }) {
    this.ts = ts;                          // when, in ms
    this.agent = agent;                    // who: the id of the agent ('main' for the lead, 'user' for the human)
    this.kind = this.constructor.kind;     // what: 'say', 'tools', 'order'…
  }

  // Says nothing about what an agent is doing: it neither starts the call nor interrupts a beat of tool calls.
  get bookkeeping() { return false; }

  // Did this close the lead's turn?
  get endsTurn() { return this.end === 1; }
  endTurn() { this.end = 1; }

  // A copy with its time relative to time zero (`t`, in ms). The event itself is kept as it is: it is shared by every build of a timeline.
  relativeTo(start) {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    copy.t = Math.max(0, this.ts - start);
    return copy;
  }

  // Everything about the event that can differ from one build of a timeline to the next (see feed.js). Its text, its tool calls,
  // its results and its time never do: they come from one transcript record (same key = same record).
  signature() {
    return `${this.kind}|${this.agent}|${this.to || ''}|${this.end || ''}|${this.signatureDetail()}`;
  }
  signatureDetail() { return ''; }
}

module.exports = { Event };
