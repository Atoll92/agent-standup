// Something an agent said or did, at a time: an event of a session's timeline.
//
// Events are the core's own objects, with readable attributes. What a display receives is made from them by a serializer
// (core/serializers/web.js for the page), so the names on the wire and the names here are free to differ.
class Event {
  constructor({ timestamp, agentId, key }) {
    this.timestamp = timestamp;          // when, in ms since the epoch
    this.agentId = agentId;              // who: 'main' for the lead, 'user' for the human, a sub-agent's id otherwise
    this.kind = this.constructor.kind;   // what: 'say', 'tools', 'order'…
    this.key = key;                      // its key in the live feed (see feed.js): it never changes. Set when the event is read, if not given here
    this.endsTurn = false;               // did this close the lead's turn?
  }

  // Says nothing about what an agent is doing: it neither starts the call nor interrupts a beat of tool calls.
  get bookkeeping() { return false; }

  endTurn() { this.endsTurn = true; }

  // A copy with `elapsed`, its time since time zero (ms). The event itself is kept as it is: it is shared by every build of a timeline.
  relativeTo(start) {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    copy.elapsed = Math.max(0, this.timestamp - start);
    return copy;
  }

  // Everything about the event that can differ from one build of a timeline to the next (see feed.js). Its text, its tool calls,
  // its results and its time never do: they come from one transcript record (same key = same record).
  signature() {
    return `${this.kind}|${this.agentId}|${this.recipientId || ''}|${this.endsTurn ? 1 : ''}|${this.signatureDetail()}`;
  }
  signatureDetail() { return ''; }
}

module.exports = { Event };
