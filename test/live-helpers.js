// test/live-helpers.js: what the live-*.test.js files share. Each of those files drives the live call in a real browser: a transcript is written record by record, the way Claude Code writes it, and we check what the call says and shows.
// One case per regression that reached a release: the end of the previous call read again, answers that stopped, lines lost or said twice, a turn that "ended" in the middle.
// Needs puppeteer-core (npm i) and a Chrome (CHROME_PATH, or the usual places); skipped with a note when they are missing, except in CI where that is a failure.
// Require this file before anything requires server.js: it sets the folders the server reads, and server.js reads them when it is loaded. node --test runs each test file in its own process, so each file gets its own temporary folder, server and browser, and the files run side by side.
const assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-live-'));
process.env.AGENT_STANDUP_PING_BASE = 'http://127.0.0.1:9/';   /* the usage count of a test page goes nowhere */
process.env.AGENT_STANDUP_UPDATE_URL = 'http://127.0.0.1:9/';   /* nor its check for a newer version */
process.env.AGENT_STANDUP_ANSWER = 'dry';   /* a click on what needs you says where it would go, and opens nothing */
process.env.AGENT_STANDUP_CC_SESSIONS = path.join(tmp, 'sessions'); process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_KOKORO_DIR = path.join(tmp, 'kokoro'); process.env.AGENT_STANDUP_PROJECTS = path.join(tmp, 'projects');
process.env.AGENT_STANDUP_PACKS = path.join(tmp, 'packs'); process.env.AGENT_STANDUP_CHARACTERS = path.join(tmp, 'characters');   /* not the packs and pictures of the machine the tests run on: the same call here as in CI */
fs.writeFileSync(process.env.AGENT_STANDUP_PREFS, JSON.stringify({ lang: 'en', voice: false, chat: 'normal', banter: true, roster: true, packSeen: 2, _t: Date.now() }));   // no voice: a line lasts as long as its text, on every machine; roster: the list of agents on, the tests read it; packSeen: the Halloween line done for the season, else in October it goes before the lines the tests look for
// A stand-in for Claude Code, so that no test starts the real one: asked for Spanish it answers a Spanish sentence with the text in brackets, for any other language the name of that language.
process.env.AGENT_STANDUP_CLAUDE = path.join(tmp, 'claude'); delete process.env.ANTHROPIC_API_KEY;
fs.writeFileSync(process.env.AGENT_STANDUP_CLAUDE, `#!/usr/bin/env node
const a = process.argv.slice(2), sys = a[a.indexOf('--system-prompt') + 1] || '', lang = (s) => (/natural spoken ([A-Za-z ]+?),/.exec(s) || [])[1], tr = (l, t) => (l === 'Spanish' ? 'Ya está, todo listo y sin errores' : l) + ' [' + t + ']';
if (a.includes('--input-format')) require('readline').createInterface({ input: process.stdin }).on('line', (l) => { const m = JSON.parse(l); console.log(JSON.stringify({ type: 'result', result: tr(lang(sys), m.message.content) })); });
else { let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => { const arr = JSON.parse(s.slice(s.indexOf('\\n') + 1)); console.log(JSON.stringify(arr.map((t) => tr(lang(s), t)))); }); }
`, { mode: 0o755 });
let puppeteer = null; for (const m of ['puppeteer-core', path.join(process.env.PUPPETEER_DIR || '/tmp/as/pp', 'node_modules/puppeteer-core')]) { try { puppeteer = require(m); break; } catch {} }
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => p && fs.existsSync(p));
const missing = !puppeteer ? 'puppeteer-core is not installed (npm i)' : !CHROME ? 'no Chrome found (set CHROME_PATH)' : '';
if (missing && process.env.CI) throw new Error('live tests cannot run: ' + missing);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let srv, port, browser, nSession = 0, nId = 0;
// ---- the server and the browser of one test file, closed when its test ends ----
async function start(t) {
  srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); port = srv.address().port;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'] });
  const chrome = browser.process();
  t.after(async () => { await browser.close(); srv.close(); require('../server.js').shutdown(); for (const p of (chrome && chrome.stdio) || []) if (p) p.destroy(); });   // our ends of Chrome's pipes, closed: on a Mac, Chrome may start its updater and crash reporter, which outlive it holding those pipes, and the test file then never exits (more likely with several files, each with its Chrome)
}
// ---- a session being written ----
function session() {
  const proj = '-live' + ++nSession, dir = path.join(tmp, 'projects', proj), main = path.join(dir, 's.jsonl'), subDir = path.join(dir, 's', 'subagents'); fs.mkdirSync(subDir, { recursive: true });
  const put = (f, r, at) => fs.appendFileSync(f, JSON.stringify({ timestamp: new Date(at || Date.now()).toISOString(), ...r }) + '\n'), sub = (k) => path.join(subDir, `agent-a${k}.jsonl`);
  const s = {
    proj,
    user: (text, at) => put(main, { type: 'user', message: { role: 'user', content: text } }, at),
    say: (text, o = {}) => put(o.sub ? sub(o.sub) : main, { type: 'assistant', message: { id: o.id || 'm' + ++nId, role: 'assistant', stop_reason: o.end ? 'end_turn' : null, content: [{ type: 'text', text }] } }, o.at),
    tool: (name, input, o = {}) => { const id = 'toolu_' + ++nId; put(o.sub ? sub(o.sub) : main, { type: 'assistant', message: { id: o.id || 'm' + ++nId, role: 'assistant', stop_reason: null, content: [{ type: 'tool_use', id, name, input }] } }, o.at); return id; },
    result: (id, text, o = {}) => put(o.sub ? sub(o.sub) : main, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(o.err ? { is_error: true } : {}) }] } }, o.at),
    think: (text, o = {}) => put(o.sub ? sub(o.sub) : main, { type: 'assistant', message: { id: o.id || 'm' + ++nId, role: 'assistant', stop_reason: null, content: [{ type: 'thinking', thinking: text, signature: 'x' }] } }, o.at),   // the reasoning before a line or a call, when Claude Code keeps its text
    queued: (text, at) => put(main, { type: 'attachment', attachment: { type: 'queued_command', prompt: [{ type: 'text', text }], origin: { kind: 'human' }, commandMode: 'prompt' } }, at),   // an order typed while the lead works: written when delivered, stamped when typed
    launch: (k, title, prompt, bg) => { const id = s.tool('Agent', { description: title, prompt, subagent_type: 'general-purpose', ...(bg ? { run_in_background: true } : {}) }); fs.writeFileSync(path.join(subDir, `agent-a${k}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: title, toolUseId: id })); put(sub(k), { type: 'user', message: { role: 'user', content: prompt } }); return id; },
    notify: (id) => put(main, { type: 'queue-operation', operation: 'enqueue', content: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n</task-notification>` }),   // a background agent has stopped: Claude Code then wakes the lead
  };
  return s;
}
// ---- the call, watched ----
async function open(s, join = true, more = '') {   // more: what else the address holds (&embed=1 for the page as VS Code shows it)
  const page = await browser.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => addEventListener('DOMContentLoaded', () => {   // before the page's first answer from the server: the live call plays from the moment it opens (the sound waits for a click, the lines do not)
    window.__said = []; const o = window.startTalk; window.startTalk = function (id, line, label) { window.__said.push({ id, line: String(line), label: label || '' }); return o.apply(this, arguments); };
    window.__voice = []; const v = window.speakLine; window.speakLine = function (text, p, primary, token, fr, always) { window.__voice.push({ id: p && p.id, text: String(text), silent: !!(S.hurry && !always) }); return v.apply(this, arguments); };   // silent: shown without a voice because the call is behind
  }));
  await page.goto(`http://localhost:${port}/?proj=${s.proj}${more}`); await page.waitForFunction('typeof S !== "undefined" && S.cur', { timeout: 15000 });
  if (join) await page.click('#gB');
  const call = {
    page, errors,
    said: () => page.evaluate(() => window.__said),
    lines: async (id) => (await call.said()).filter((x) => !id || x.id === id).map((x) => x.line),
    until: (fn, arg, ms = 20000) => page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg),
    heard: (text, ms) => call.until((t) => window.__said.some((x) => x.line.includes(t)), text, ms),   // a line containing this text has started
    quiet: async (ms = 2500) => { await call.until(() => S.idle && !S.speakers.size, null, 30000); await wait(ms); },   // everything received has been played, and nothing more came
    lead: () => page.evaluate(() => agentState('main', Date.now()).k),
    close: async () => { await page.close(); assert.deepEqual(errors, [], 'page errors'); },
  };
  return call;
}
const count = (lines, text) => lines.filter((l) => l.includes(text)).length;
const closing = async (c) => (await c.said()).filter((x) => x.id === 'main' && x.label === '🎉').map((x) => x.line), closed = (c, n, ms = 20000) => c.until((k) => window.__said.filter((x) => x.label === '🎉').length === k && !S.speakers.size, n, ms);   // the lead's word when its face turns happy
const YOURS = /(Your turn|Over to you|Back to you)\.$/;

module.exports = { tmp, missing, wait, start, session, open, count, closing, closed, YOURS };
