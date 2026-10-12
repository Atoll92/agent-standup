// The page itself: the files of public/, and nothing outside it.
const fs = require('fs'), path = require('path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

class AssetsController {
  // GET /<file>, and / for index.html
  show(exchange) {
    const file = path.join(PUBLIC, exchange.path === '/' ? 'index.html' : exchange.path);
    let stat = null;
    try { stat = fs.statSync(file); } catch {}
    if (!file.startsWith(PUBLIC + path.sep) || !stat || !stat.isFile()) return exchange.refuse(404, 'not found');
    exchange.send(200, fs.readFileSync(file), { 'content-type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream' });
  }
}

module.exports = { AssetsController };
