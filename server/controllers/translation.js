// Lines in French and the quips of the call (see services/translator.js), and whether they can work on this machine.
const MAX_TEXTS = 200, MAX_TEXT_LENGTH = 2000;
const textsIn = (list) => (Array.isArray(list) ? list : []).slice(0, MAX_TEXTS).map((text) => String(text).slice(0, MAX_TEXT_LENGTH));

class TranslationController {
  constructor({ translator, claude }) {
    this.translator = translator;
    this.claude = claude;
  }

  // POST /api/translate { texts }
  async translate(exchange) {
    const body = await exchange.readBody();
    try { exchange.json(await this.translator.translate(textsIn(JSON.parse(body).texts))); } catch (error) { exchange.json({ error: String(error) }, 400); }
  }

  // POST /api/quips { texts, lang }
  async quips(exchange) {
    const body = await exchange.readBody();
    try { const request = JSON.parse(body); exchange.json(await this.translator.quips(textsIn(request.texts), request.lang === 'fr' ? 'fr' : 'en')); } catch (error) { exchange.json({ error: String(error) }, 400); }
  }

  // GET /api/health: what translation needs, so the page can tell what to do when it does not work.
  health(exchange) {
    exchange.json({ claude: this.claude.find(), apiKey: !!process.env.ANTHROPIC_API_KEY, trError: this.claude.lastError, platform: process.platform });
  }

  // GET /api/warm: start the translation workers before the first line comes.
  warm(exchange) {
    this.translator.warm();
    exchange.json({ ok: true });
  }
}

module.exports = { TranslationController };
