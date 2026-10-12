// One request and its answer, as a controller sees them.
const fs = require('fs');

const MAX_BODY_BYTES = 256 * 1024;   // request bodies are small JSON
const BODY_TIMEOUT_MS = 10000;

class Exchange {
  constructor(request, response, url) {
    this.request = request;
    this.response = response;
    this.url = url;
  }

  get method() { return this.request.method; }
  get path() { return this.url.pathname; }
  header(name) { return this.request.headers[name]; }

  // A parameter of the address, or null when it is not there.
  param(name) { return this.url.searchParams.get(name); }

  // ---- Answers

  // Also called from callbacks that run later, where nothing would catch an exception: a failure ends this answer, not the server.
  json(body, status = 200) {
    try { this.response.writeHead(status, { 'content-type': 'application/json' }); this.response.end(JSON.stringify(body)); } catch { this.response.destroy(); }
  }

  // Bytes or a string that are already what to send.
  send(status, body, headers = {}) {
    this.response.writeHead(status, headers);
    this.response.end(body);
  }

  // A short plain answer: 'bad request', 'not found', 'forbidden'…
  refuse(status, text) { this.send(status, text); }

  // A file streamed from disk. A file that vanished between the check and the read ends this answer, not the server.
  sendFile(file, headers) {
    this.response.writeHead(200, headers);
    const stream = fs.createReadStream(file);
    stream.on('error', () => this.response.destroy());
    stream.pipe(this.response);
  }

  // ---- The body

  // The body as text. Stops reading beyond 256 KB (answering 413) and gives up after 10 s: then the promise never settles.
  readBody() {
    return new Promise((resolve) => {
      const chunks = [];
      let size = 0, tooLarge = false;
      this.request.setTimeout(BODY_TIMEOUT_MS, () => this.request.destroy());
      if (+this.request.headers['content-length'] > MAX_BODY_BYTES) { this.refuse(413, 'too large'); this.request.destroy(); return; }
      this.request.on('data', (data) => {
        if (tooLarge) return;
        size += data.length;   // bytes, not characters
        if (size > MAX_BODY_BYTES) { tooLarge = true; this.refuse(413, 'too large'); this.request.destroy(); } else chunks.push(data);
      });
      this.request.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8')); });
    });
  }
}

module.exports = { Exchange };
