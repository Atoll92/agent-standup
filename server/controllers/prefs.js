// The page's settings (see services/prefsFile.js).
class PrefsController {
  constructor({ prefsFile }) { this.prefsFile = prefsFile; }

  // GET /api/prefs
  show(exchange) { exchange.json(this.prefsFile.read() || {}); }

  // GET /api/prefs.js: the settings as a script the page loads before anything else, so it starts with them.
  script(exchange) {
    exchange.send(200, 'window.SAVED_PREFS = ' + JSON.stringify(this.prefsFile.read()).replace(/</g, '\\u003c') + ';', { 'content-type': 'application/javascript', 'cache-control': 'no-store' });
  }

  // PUT /api/prefs { … }: replaces them all.
  async update(exchange) {
    const body = await exchange.readBody();
    try {
      const prefs = JSON.parse(body);
      if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) throw new Error('prefs must be an object');
      this.prefsFile.write(prefs);
      exchange.json({ ok: true });
    } catch (error) { exchange.json({ error: String(error.message || error) }, 400); }
  }
}

module.exports = { PrefsController };
