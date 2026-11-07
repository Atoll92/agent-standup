// The numbers behind agent-standup.com/review/: one pass over Claude Code transcripts (~/.claude/projects/**/*.jsonl), line by line, in the visitor's browser.
// Nothing here sends anything: the page calls add() for each line of each file and reads result() at the end. Node can require it too (see test/review-stats.test.js).
// Old transcript formats lack fields (isSidechain, isMeta, message.id, subagents/ folders): every read below tolerates their absence.
// The short prompts counted as "your most detailed instruction". The review says the most frequent one aloud, so each has a recording (scripts/review-voices.js): add one there too.
const REVIEW_SHORT = ['y', 'yes', 'yep', 'yeah', 'ok', 'okay', 'k', 'go', 'go on', 'go ahead', 'continue', 'proceed', 'do it', 'fix it', 'fix', 'try again', 'again', 'next', 'more', 'keep going', 'sure', 'lgtm', 'ship it', 'oui', 'vas-y', 'ok go', 'yes please', 'ok continue', 'no', 'nope', 'non'];
function reviewStats() {
  const R = {
    files: 0, subFiles: 0, lines: 0, sessions: new Set(), projects: new Set(), first: Infinity, last: 0,
    prompts: 0, promptWords: 0, short: {}, caps: 0, please: 0, thanks: 0, swears: {}, swearPrompts: 0, slash: {},
    esc: 0, night: 0, weekend: 0, latest: null, days: {}, hours: Array(24).fill(0),
    ar: 0, right: 0, perfect: 0, sorry: 0, words: 0, outTokens: 0, tools: {}, spawned: 0,
    active: 0, alone: 0, aloneAt: 0,
  };
  const seen = new Set(), buckets = new Map(), BUCKET = 60e3, IDLE = 5 * 60e3;   // seen: ids of records already counted (an old resume copied the whole conversation into a new file); buckets: 1-minute slots -> the files busy in them; IDLE: a longer gap is a pause, not work
  let f = null;
  const SHORT = new Set(REVIEW_SHORT);
  const SWEARS = [['wtf', /\bwtf\b/g], ['f***', /\bf+u+c+k+\w*/g], ['s***', /\bshit\w*/g], ['damn', /\bdamn\w*/g], ['ffs', /\bffs\b/g], ['what the hell', /\bwhat the hell\b/g], ['p*tain', /\bputain\b/g], ['m*rde', /\bmerde\b/g], ['bordel', /\bbordel\b/g]];
  const AR = /\b(?:you[’']?re|you are) absolutely right\b|\b(?:vous avez|tu as) (?:absolument|tout à fait|parfaitement) raison\b/gi;
  const RIGHT = /\b(?:you[’']?re|you are) (?:totally |completely |quite |so |entirely )?right\b|\b(?:vous avez|tu as) raison\b/gi;
  const count = (s, re) => { re.lastIndex = 0; let n = 0; while (re.exec(s)) n++; return n; };
  const tsOf = (line) => { const i = line.indexOf('"timestamp":"'); return i < 0 ? 0 : Date.parse(line.slice(i + 13, i + 37).replace(/".*/, '')) || 0; };

  function open(path) {   // a new file; path is relative to whatever folder the visitor picked
    end();
    const sub = /(^|\/)subagents\//.test(path) || /\/agent-[^/]*\.jsonl$/.test(path);
    R.files++; if (sub) R.subFiles++;
    const parts = path.split('/'), proj = parts.length > 1 ? parts[parts.length - (sub ? 4 : 2)] : '';
    if (proj) R.projects.add(proj);
    f = { sub, idx: R.files, prev: 0, prompt: 0, lastA: 0, run: 0, ids: new Set() };
  }
  function end() {   // close the file: its last unanswered stretch of work counts as "alone"
    if (!f) return; stretch(); f = null;
  }
  function stretch() { if (f.prompt && f.run > R.alone) { R.alone = f.run; R.aloneAt = f.prompt; } f.run = 0; }
  function tick(t, work) {
    if (!t) return;
    if (t < R.first) R.first = t; if (t > R.last) R.last = t;
    const gap = f.prev ? t - f.prev : 0; f.prev = t;
    if (gap > 0 && gap < IDLE) { R.active += gap; if (f.prompt && work) f.run += gap; }
    const b = Math.floor(t / BUCKET); let s = buckets.get(b); if (!s) buckets.set(b, (s = new Set())); s.add(f.idx);
  }
  function prompt(text, t, sid) {
    const raw = text.trim();
    if (/^\[Request interrupted by user/.test(raw)) { R.esc++; return; }
    const cmd = /<command-name>\s*\/?([\w:-]+)\s*<\/command-name>/.exec(raw); if (cmd) { R.slash['/' + cmd[1]] = (R.slash['/' + cmd[1]] || 0) + 1; return; }
    if (/^<|^Caveat:|^This session is being continued from a previous conversation/.test(raw)) return;   // command output, hook text, reminders, compaction summaries: not typed by the person
    stretch(); f.prompt = t;
    R.prompts++; if (sid) R.sessions.add(sid);
    const words = raw.split(/\s+/).filter(Boolean).length; R.promptWords += words;
    const low = raw.toLowerCase(), norm = low.replace(/[.!?,;:…]+$/g, '').replace(/\s+/g, ' ').trim();
    if (SHORT.has(norm)) R.short[norm] = (R.short[norm] || 0) + 1;
    const letters = raw.replace(/[^A-Za-z]/g, ''); if (letters.length >= 12 && letters === letters.toUpperCase()) R.caps++;
    if (/\b(?:please|pls|plz|stp|svp)\b|s[’']il (?:te|vous) pla[iî]t/.test(low)) R.please++;
    if (/\b(?:thanks|thank you|thx|ty|merci|cheers)\b/.test(low)) R.thanks++;
    let any = false; for (const [k, re] of SWEARS) { const n = count(low, re); if (n) { R.swears[k] = (R.swears[k] || 0) + n; any = true; } } if (any) R.swearPrompts++;
    if (t) {
      const d = new Date(t), h = d.getHours(), m = d.getMinutes(), day = d.getDay(); R.hours[h]++;
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); R.days[key] = (R.days[key] || 0) + 1;
      if (h < 5) R.night++; if (day === 0 || day === 6) R.weekend++;
      const late = (h < 6 ? h + 24 : h) * 60 + m;   // how late at night: 3:47 AM is later than 11 PM
      if (h < 6 || h >= 21) if (!R.latest || late > R.latest.late) R.latest = { late, t };
    }
  }
  function add(line) {
    if (!f) open('unknown.jsonl');
    R.lines++;
    // the big records (tool output, progress) are only timestamps for us: no JSON.parse for them
    if (line.indexOf('"tool_result"') >= 0 || line.indexOf('"type":"progress"') >= 0) { tick(tsOf(line), true); return; }
    let o; try { o = JSON.parse(line); } catch { return; }
    if (!o || typeof o !== 'object') return;
    const t = o.timestamp ? Date.parse(o.timestamp) || 0 : 0;
    if (o.type === 'user' || o.type === 'assistant') tick(t, o.type === 'assistant');   // the time before a prompt is the person thinking, not the agents working
    const m = o.message, c = m && m.content, dup = o.uuid ? seen.has(o.uuid) : false; if (o.uuid) seen.add(o.uuid);
    if (dup) return;
    if (o.type === 'user' && !f.sub && !o.isSidechain && !o.isMeta && !o.isCompactSummary && !o.toolUseResult) {
      const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((b) => b && b.type === 'tool_result') ? c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n') : '';
      if (text) prompt(text, t, o.sessionId);
    } else if (o.type === 'assistant' && Array.isArray(c)) {
      const mid = m.id, u = m.usage; if (u && mid && !f.ids.has(mid)) { f.ids.add(mid); R.outTokens += +u.output_tokens || 0; } else if (u && !mid) R.outTokens += +u.output_tokens || 0;
      for (const b of c) {
        if (!b) continue;
        if (b.type === 'tool_use' && b.name) { R.tools[b.name] = (R.tools[b.name] || 0) + 1; if (/^(?:Task|Agent)$/.test(b.name)) R.spawned++; }
        else if (b.type === 'text' && b.text && !f.sub && !o.isSidechain) {
          R.ar += count(b.text, AR); R.right += count(b.text, RIGHT);
          if (/^\s*Perfect[!.]/.test(b.text)) R.perfect++;
          if (/\b(?:I apologi[sz]e|my apologies|sorry about that|sorry for the)\b/i.test(b.text)) R.sorry++;
          R.words += b.text.split(/\s+/).filter(Boolean).length;
        }
      }
    }
  }
  function result() {
    end();
    let peak = 0, peakAt = 0; for (const [b, s] of buckets) if (s.size > peak) { peak = s.size; peakAt = b * BUCKET; }
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
    const busiest = top(R.days)[0] || null;
    return {
      files: R.files, subFiles: R.subFiles, sessions: R.sessions.size, projects: R.projects.size, first: R.first === Infinity ? 0 : R.first, last: R.last,
      prompts: R.prompts, avgWords: R.prompts ? R.promptWords / R.prompts : 0, short: top(R.short), caps: R.caps, please: R.please, thanks: R.thanks,
      swears: top(R.swears), swearPrompts: R.swearPrompts, slash: top(R.slash), esc: R.esc, night: R.night, weekend: R.weekend, latest: R.latest ? R.latest.t : 0,
      busiest: busiest ? { day: busiest[0], prompts: busiest[1] } : null, hours: R.hours,
      ar: R.ar, right: R.right, perfect: R.perfect, sorry: R.sorry, words: R.words, outTokens: R.outTokens, tools: top(R.tools),
      spawned: Math.max(R.spawned, R.subFiles), peak, peakAt, activeHours: R.active / 36e5, alone: R.alone, aloneAt: R.aloneAt,
    };
  }
  return { open, add, end, result };
}
if (typeof module === 'object' && module.exports) module.exports = { reviewStats, REVIEW_SHORT };
