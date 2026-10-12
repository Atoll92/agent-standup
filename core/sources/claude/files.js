// Where Claude Code keeps a session on disk: <root>/<project>/<session>.jsonl, and its sub-agent transcripts, workflow journals and .meta.json files beside it.
const fs = require('fs'), path = require('path');

const mtimeOf = (file) => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };   // 0 for a file that is gone, or a symlink that points nowhere: never an exception
// Where the files of the sessions in `root` are. The only thing kept is the .meta.json files already read.
function createClaudeFiles({ root }) {
  // Every sub-agent transcript of a session: <id>/subagents/*.jsonl, plus the ones a workflow launched, one folder deeper in <id>/subagents/workflows/<run>/agent-*.jsonl (each run also keeps a journal.jsonl, which is not an agent).
  function subFiles(proj, id) {
    const subAgentsDir = path.join(root, proj, id, 'subagents'), out = [], seen = new Set(['main', 'user']); out.dirs = [subAgentsDir]; out.journals = [];
    const add = (dir, fileName, run) => { let agentId = fileName.replace(/^agent-/, '').replace(/\.jsonl$/, '').replace(/[^\w.-]/g, '_'); const baseId = agentId; if (seen.has(agentId)) agentId = (run || 'agent').replace(/[^\w.-]/g, '_') + '.' + agentId; seen.add(agentId); out.push({ file: path.join(dir, fileName), aid: agentId, id0: baseId, run }); };   // an id is the file name; the same name in two folders gets its run in front
    let names; try { names = fs.readdirSync(subAgentsDir); } catch { return out; }
    for (const fileName of names) if (fileName.endsWith('.jsonl')) add(subAgentsDir, fileName, '');
    if (!names.includes('workflows')) return out;
    const workflowsDir = path.join(subAgentsDir, 'workflows'); let runs = []; try { runs = fs.readdirSync(workflowsDir).sort(); } catch {} out.dirs.push(workflowsDir);
    for (const run of runs) {
      const dir = path.join(workflowsDir, run); let runFileNames; try { runFileNames = fs.readdirSync(dir).sort(); } catch { continue; } out.dirs.push(dir);
      for (const fileName of runFileNames) { if (/^agent-.*\.jsonl$/.test(fileName)) add(dir, fileName, run); else if (fileName === 'journal.jsonl') out.journals.push({ file: path.join(dir, fileName), run }); }
    }
    return out;
  }
  const metaCache = new Map();   // meta file path → { mtime, value }
  function readMeta(file) {
    try { const modifiedAt = fs.statSync(file).mtimeMs, cached = metaCache.get(file); if (cached && cached.mtime === modifiedAt) return cached.value; const meta = JSON.parse(fs.readFileSync(file, 'utf8')); if (metaCache.size > 3000) metaCache.clear(); metaCache.set(file, { mtime: modifiedAt, value: meta }); return meta; } catch { return {}; }
  }

  // Every main transcript of every Claude Code project: { proj, id, stat }.
  // A project folder that cannot be read is skipped, and so is a transcript that cannot be looked at (a link to a file that is gone).
  function* transcripts() {
    for (const proj of fs.existsSync(root) ? fs.readdirSync(root) : []) {
      let names;
      try { names = fs.readdirSync(path.join(root, proj)).filter((fileName) => fileName.endsWith('.jsonl')); } catch { continue; }
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
