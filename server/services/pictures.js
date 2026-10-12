// The pictures a tool returned (a screenshot, an image file it read), served from the transcript they are in.
// The timeline only says how many there are; the page asks for each one by its tool call and its number.
const fs = require('fs'), path = require('path');
const { blocks, resultImages } = require('../../core/transcript');

const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_SEARCH_MS = 2000;
const REMEMBERED = 12;   // pictures (and vain searches) kept in memory
const NEWLINE = 10;

class Pictures {
  #remembered = new Map();   // file|tool call|number → { type, bytes } or { missedAtSize }

  constructor({ core }) { this.core = core; }

  // { type, bytes } of picture `index` of the result of tool call `callId`, made by `agentId` in that session; null when there is none.
  find(project, sessionId, agentId, callId, index) {
    const file = this.#transcriptOf(project, sessionId, agentId);
    return file && this.#search(file, callId, index);
  }

  #transcriptOf(project, sessionId, agentId) {
    if (agentId === 'main') return path.join(this.core.root, project, sessionId + '.jsonl');
    const subAgent = this.core.sources.claude.subFiles(project, sessionId).find((sub) => sub.aid === agentId);
    return subAgent ? subAgent.file : null;
  }

  // Looks for the line of the tool call's result, 8 MB at a time, for 2 s at most. The id is looked for between its quotes,
  // so a made-up one-letter id does not match on every line.
  #search(file, callId, index) {
    const key = file + '|' + callId + '|' + index, remembered = this.#remembered.get(key);
    if (remembered && remembered.bytes) return remembered;
    const needle = Buffer.from('"' + callId + '"'), imageMark = Buffer.from('"image"'), until = Date.now() + MAX_SEARCH_MS;
    let fileDescriptor, found = null, carried = Buffer.alloc(0), position = 0, size = 0;
    try {
      fileDescriptor = fs.openSync(file, 'r');
      size = fs.fstatSync(fileDescriptor).size;
      if (remembered && remembered.missedAtSize === size) return null;   // already searched in vain, and nothing was written since
      while (position < size && !found && Date.now() < until) {
        const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, size - position));
        fs.readSync(fileDescriptor, chunk, 0, chunk.length, position);
        position += chunk.length;
        const text = carried.length ? Buffer.concat([carried, chunk]) : chunk;
        let from = 0;
        for (let hit; !found && (hit = text.indexOf(needle, from)) >= 0 && Date.now() < until;) {
          const lineStart = text.lastIndexOf(NEWLINE, hit) + 1, lineEnd = text.indexOf(NEWLINE, hit);
          if (lineEnd < 0) break;   // the line goes on in the next chunk
          from = lineEnd + 1;
          const line = text.subarray(lineStart, lineEnd);
          if (line.indexOf(imageMark) < 0) continue;
          let record;
          try { record = JSON.parse(line.toString('utf8')); } catch { continue; }
          for (const block of blocks(record)) {
            if (block.type !== 'tool_result' || block.tool_use_id !== callId) continue;
            const image = resultImages(block.content)[index];
            if (image) found = { type: image.source.media_type, bytes: Buffer.from(image.source.data, 'base64') };
          }
        }
        carried = text.subarray(text.lastIndexOf(NEWLINE) + 1);
      }
    } catch {} finally { if (fileDescriptor != null) fs.closeSync(fileDescriptor); }

    this.#remembered.delete(key);
    this.#remembered.set(key, found || { missedAtSize: size });
    if (this.#remembered.size > REMEMBERED) this.#remembered.delete(this.#remembered.keys().next().value);
    return found;
  }
}

module.exports = { Pictures };
