// Only one window at a time plays sound: the last one that claimed it. Each window says it is still there every few seconds;
// a window that stopped saying so loses the sound.
const CLIENT_ID = /^[\w-]{4,40}$/;
const EXPIRES_MS = 6000;

class AudioOwner {
  #owner = null;
  #seenAt = 0;

  // A window checks in (claiming the sound, or just saying it is there); the answer is who owns the sound now, or null.
  checkIn(clientId, { claim = false } = {}) {
    const valid = CLIENT_ID.test(clientId);
    if (valid && claim) { this.#owner = clientId; this.#seenAt = Date.now(); }
    else if (valid && this.#owner === clientId) this.#seenAt = Date.now();
    if (this.#owner && Date.now() - this.#seenAt > EXPIRES_MS) { this.#owner = null; this.#seenAt = 0; }
    return this.#owner;
  }
}

module.exports = { AudioOwner };
