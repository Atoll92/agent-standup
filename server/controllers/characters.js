// The person's own characters and the built-in packs (see services/characters.js): their lists, and their images by exact name.
const { charactersDir, packDir, packNames, listCharacters, characterImage } = require('../services/characters');

const decoded = (name) => { try { return decodeURIComponent(name); } catch { return ''; } };

class CharactersController {
  // GET /api/characters[?pack]
  index(exchange) { exchange.json(listCharacters(exchange.param('pack') || '')); }

  // GET /api/packs
  packs(exchange) { exchange.json(packNames().map((name) => ({ name, n: listCharacters(name).chars.length }))); }

  // GET /characters/<file>
  image(exchange) { this.#sendImage(exchange, charactersDir(), exchange.params.file); }

  // GET /packs/<pack>/<file>
  packImage(exchange) { this.#sendImage(exchange, packDir(exchange.params.pack), exchange.params.file); }

  #sendImage(exchange, dir, file) {
    const image = characterImage(dir, decoded(file));
    if (!image) return exchange.refuse(404, 'not found');
    exchange.sendFile(image.file, { 'content-type': image.type, 'cache-control': 'no-cache' });
  }
}

module.exports = { CharactersController };
