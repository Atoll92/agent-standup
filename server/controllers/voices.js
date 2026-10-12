// The voices of the call: which there are, a line spoken as a wav file, Kokoro's install, and which window plays the sound.
class VoicesController {
  constructor({ speech, kokoro, audioOwner }) {
    this.speech = speech;
    this.kokoro = kokoro;
    this.audioOwner = audioOwner;
  }

  // GET /api/voices[?engine=kokoro]
  index(exchange) {
    exchange.json(exchange.param('engine') === 'kokoro' ? this.speech.kokoroVoices() : this.speech.systemVoices());
  }

  // GET /api/tts?text&voice&rate&engine
  speak(exchange) {
    return this.speech.speak(exchange.param('text') || '', exchange.param('voice'), exchange.param('rate'), exchange.param('engine'))
      .then((file) => exchange.sendFile(file, { 'content-type': 'audio/wav', 'cache-control': 'max-age=86400' }))
      .catch((error) => exchange.json({ error: String(error.message) }, 400));
  }

  // GET /api/kokoro
  kokoroStatus(exchange) { exchange.json(this.kokoro.status()); }

  // POST /api/kokoro/install
  installKokoro(exchange) { exchange.json(this.kokoro.install()); }

  // GET /api/audio?cid[&claim=1]: a window checks in; the answer says which window plays the sound.
  audio(exchange) {
    exchange.json({ owner: this.audioOwner.checkIn(exchange.param('cid') || '', { claim: !!exchange.param('claim') }) });
  }
}

module.exports = { VoicesController };
