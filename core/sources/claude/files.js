// Where Claude Code keeps a session on disk: <root>/<project>/<session>.jsonl, and its sub-agent transcripts, workflow journals and .meta.json files beside it.
const fs = require('fs'), path = require('path');

const mtimeOf = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };   // 0 for a file that is gone, or a symlink that points nowhere: never an exception
// Where the files of the sessions in `root` are. The only thing kept is the .meta.json files already read.
function createClaudeFiles({ root }) {
  // Every sub-agent transcript of a session: <id>/subagents/*.jsonl, plus the ones a workflow launched, one folder deeper in <id>/subagents/workflows/<run>/agent-*.jsonl (each run also keeps a journal.jsonl, which is not an agent).
  function subFiles(proj, id) {
    const sd = path.join(root, proj, id, 'subagents'), out = [], seen = new Set(['main', 'user']); out.dirs = [sd]; out.journals = [];
    const add = (dir, f, run) => { let aid = f.replace(/^agent-/, '').replace(/\.jsonl$/, '').replace(/[^\w.-]/g, '_'); const id0 = aid; if (seen.has(aid)) aid = (run || 'agent').replace(/[^\w.-]/g, '_') + '.' + aid; seen.add(aid); out.push({ file: path.join(dir, f), aid, id0, run }); };   // an id is the file name; the same name in two folders gets its run in front
    let names; try { names = fs.readdirSync(sd); } catch { return out; }
    for (const f of names) if (f.endsWith('.jsonl')) add(sd, f, '');
    if (!names.includes('workflows')) return out;
    const wd = path.join(sd, 'workflows'); let runs = []; try { runs = fs.readdirSync(wd).sort(); } catch {} out.dirs.push(wd);
    for (const run of runs) {
      const dir = path.join(wd, run); let fl; try { fl = fs.readdirSync(dir).sort(); } catch { continue; } out.dirs.push(dir);
      for (const f of fl) { if (/^agent-.*\.jsonl$/.test(f)) add(dir, f, run); else if (f === 'journal.jsonl') out.journals.push({ file: path.join(dir, f), run }); }
    }
    return out;
  }
  const metaCache = new Map();   // meta file path → { mtime, value }
  function readMeta(f) {
    try { const mt = fs.statSync(f).mtimeMs, c = metaCache.get(f); if (c && c.mtime === mt) return c.value; const v = JSON.parse(fs.readFileSync(f, 'utf8')); if (metaCache.size > 3000) metaCache.clear(); metaCache.set(f, { mtime: mt, value: v }); return v; } catch { return {}; }
  }

  // Every main transcript of every Claude Code project: { proj, id, stat }.
  // A project folder that cannot be read is skipped, and so is a transcript that cannot be looked at (a link to a file that is gone).
  function* transcripts() {
    for (const proj of fs.existsSync(root) ? fs.readdirSync(root) : []) {
      let names;
      try { names = fs.readdirSync(path.join(root, proj)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
      for (const name of names) {
        let stat;
        try { stat = fs.statSync(path.join(root, proj, name)); } catch { continue; }
        yield { proj, id: name.slice(0, -'.jsonl'.length), stat };
      }
    }
  }
  return { subFiles, readMeta, transcripts };
}

module.exports = { mtimeOf, createClaudeFiles };
