// What can go wrong when reading sessions, by name (as ActiveRecord::RecordNotFound is in Rails): check the class, not the message.
class SessionNotFound extends Error {
  constructor() {
    super('session not found');
    this.name = 'SessionNotFound';
  }
}

// Data that says it is an event of a kind no class is for (see models/index.js).
class UnknownEventKind extends Error {
  constructor(kind) {
    super(`no event is of the kind ${JSON.stringify(kind)}`);
    this.name = 'UnknownEventKind';
    this.kind = kind;
  }
}

// A source did not implement something the core asks of it (see sources/source.js).
class NotImplemented extends Error {
  constructor(owner, method) {
    super(`${owner} does not implement ${method}`);
    this.name = 'NotImplemented';
  }
}

module.exports = { SessionNotFound, UnknownEventKind, NotImplemented };
