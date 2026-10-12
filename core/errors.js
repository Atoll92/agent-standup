// What can go wrong when reading sessions, by name (as ActiveRecord::RecordNotFound is in Rails): check the class, not the message.
class SessionNotFound extends Error {
  constructor() {
    super('session not found');
    this.name = 'SessionNotFound';
  }
}

// A source did not implement something the core asks of it (see sources/source.js).
class NotImplemented extends Error {
  constructor(owner, method) {
    super(`${owner} does not implement ${method}`);
    this.name = 'NotImplemented';
  }
}

module.exports = { SessionNotFound, NotImplemented };
