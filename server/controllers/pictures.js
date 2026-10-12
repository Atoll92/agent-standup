// GET /api/media?proj&id&agent&tool&n: picture n of what tool call `tool` of `agent` returned (see services/pictures.js).
const { isSafeName } = require('./sessions');

const MAX_PICTURES = 10;   // per tool result
const MIN_CALL_ID = 6;     // no tool call has an id that short, and looking for one meant reading the whole transcript

class PicturesController {
  constructor({ pictures }) { this.pictures = pictures; }

  show(exchange) {
    const param = (name) => exchange.param(name) || '';
    const index = +param('n') || 0, names = [param('proj'), param('id'), param('agent'), param('tool')];
    const bad = names.some((name) => !isSafeName(name)) || param('tool').length < MIN_CALL_ID;
    const picture = bad || !Number.isInteger(index) || index < 0 || index >= MAX_PICTURES ? null : this.pictures.find(param('proj'), param('id'), param('agent'), param('tool'), index);
    if (!picture) return bad ? exchange.refuse(400, 'bad request') : exchange.refuse(404, 'not found');
    exchange.send(200, picture.bytes, { 'content-type': picture.type, 'content-length': picture.bytes.length, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
  }
}

module.exports = { PicturesController };
