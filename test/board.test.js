// test/board.test.js: the Sessions board. What the server says of each session (its pull request, the question it stopped on), and in a real browser the sections by state and the sessions put away as done.
// The browser part needs puppeteer-core (npm i) and a Chrome (CHROME_PATH, or the usual places), like the test/live-*.test.js files: skipped with a note when they are missing, except in CI where that is a failure.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-board-')), PROJECTS = path.join(tmp, 'projects');
process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_KOKORO_DIR = path.join(tmp, 'kokoro'); process.env.AGENT_STANDUP_PROJECTS = PROJECTS;
fs.writeFileSync(process.env.AGENT_STANDUP_PREFS, JSON.stringify({ lang: 'en', voice: false, view: 'board', _t: Date.now() }));
let puppeteer = null; for (const m of ['puppeteer-core', path.join(process.env.PUPPETEER_DIR || '/tmp/as/pp', 'node_modules/puppeteer-core')]) { try { puppeteer = require(m); break; } catch {} }
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => p && fs.existsSync(p));
const missing = !puppeteer ? 'puppeteer-core is not installed (npm i)' : !CHROME ? 'no Chrome found (set CHROME_PATH)' : '';
if (missing && process.env.CI) throw new Error('board tests cannot run: ' + missing);

const now = Date.now(), iso = (ago) => new Date(now - ago).toISOString(), id = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const user = (text, ago) => ({ type: 'user', timestamp: iso(ago), message: { role: 'user', content: text } }), say = (text, ago) => ({ type: 'assistant', timestamp: iso(ago), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const call = (name, input, ago) => ({ type: 'assistant', timestamp: iso(ago), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_' + name, name, input }] } }), title = (t) => ({ type: 'ai-title', aiTitle: t }), pr = (url) => ({ type: 'pr-link', prNumber: 30, prUrl: url, prRepository: 'acme/shop' });
const file = (n) => path.join(PROJECTS, '-work-shop', id(n) + '.jsonl'), put = (n, recs, ago) => { fs.mkdirSync(path.dirname(file(n)), { recursive: true }); fs.writeFileSync(file(n), recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); const t = new Date(now - ago); fs.utimesSync(file(n), t, t); };
const ASK = 1, PR = 2, WORK = 3, NOTES = 4, OLD = 5, LINK = 6;
put(ASK, [title('Checkout'), user('Add the checkout', 200e3), call('AskUserQuestion', { questions: [{ question: 'Stripe or Paddle?' }, { question: 'Which currency?' }] }, 120e3)], 120e3);
put(PR, [title('Flaky test'), user('Fix the flaky test', 400e3), pr('https://github.com/acme/shop/pull/29'), say('Fixed.', 180e3), pr('https://github.com/acme/shop/pull/30')], 180e3);
put(WORK, [title('Migration'), user('Migrate orders', 90e3), call('Bash', { command: 'npm run migrate' }, 20e3)], 20e3);
put(NOTES, [title('Release notes'), user('Release notes', 900e3), say('Here are the notes.', 600e3)], 600e3);
put(OLD, [title('Pricing page'), user('Pricing page', 4000e3), say('Done.', 3000e3)], 3000e3);
put(LINK, [title('A link that is not a pull request'), user('x', 5000e3), pr('https://evil.example/acme/shop/pull/1'), pr('javascript:alert(1)'), pr('https://github.com/acme/shop/pull/1/files?x=<b>'), say('y', 4500e3)], 4500e3);

test('a card of the board carries the pull request of its session and the question it stopped on; nothing but a pull request on github.com is given as a link', () => {
  const core = require('../server.js'), row = (n) => core.boardRows().find((r) => r.id === id(n));
  assert.deepEqual(row(PR).pr, { n: 30, url: 'https://github.com/acme/shop/pull/30' });   // the latest one
  assert.equal(row(LINK).pr, undefined); assert.equal(row(NOTES).pr, undefined);
  assert.equal(row(ASK).state, 'blocked'); assert.equal(row(ASK).ask, 'Stripe or Paddle?');
  assert.equal(row(WORK).state, 'working'); assert.equal(row(WORK).ask, undefined); assert.equal(row(PR).ask, undefined);   // a command is not a question: it is not shown on the card
});
test('the board is in sections, what waits for you first; a session put away as done stays so until it moves again', { skip: missing || false, timeout: 120000 }, async () => {
  const core = require('../server.js'), srv = core.start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--mute-audio', '--no-sandbox'] });
  try {
    const page = await browser.newPage(), errs = []; page.on('pageerror', (e) => errs.push(String(e))); await page.setViewport({ width: 1180, height: 820 });
    await page.goto(`http://localhost:${port}/?live=1`); await page.waitForSelector('#boardv .bcard', { timeout: 20000 });
    const read = () => page.evaluate(() => [...document.querySelectorAll('#boardv .bsec')].map((s) => [s.querySelector('.bl').textContent, s.querySelector('.bhd i').textContent, [...s.querySelectorAll('.bt')].map((t) => t.textContent).join(', ')].join(' | ')));
    const press = (name, sel) => page.evaluate((name, sel) => [...document.querySelectorAll('#boardv .bcard')].find((c) => c.querySelector('.bt').textContent === name).querySelector(sel).click(), name, sel);
    const kept = () => core.boardRows().filter((r) => r.done).map((r) => r.title), tabs = () => page.evaluate(() => [...document.querySelectorAll('#tabs .stab span')].map((x) => x.textContent).sort());
    const post = (body) => page.evaluate(async (body) => (await (await fetch('/api/done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()).ok, body);
    await page.waitForFunction(() => document.querySelectorAll('#tabs .stab span').length === 4, { timeout: 15000 }); assert.deepEqual(await tabs(), ['Checkout', 'Flaky test', 'Migration', 'Release notes']);   // the call is in Migration, the latest; an idle session has no tab
    assert.deepEqual(await read(), ['needs you? | 1 | Checkout', 'your turn | 2 | Flaky test, Release notes', 'working | 1 | Migration', 'idle | 2 | Pricing page, A link that is not a pull request']);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.bcard')].map((c) => [c.querySelector('.bt').textContent, (c.querySelector('.bq') || {}).textContent || '', (c.querySelector('.bpr') || {}).textContent || '', !!c.querySelector('.bdo')].join(' | '))),
      ['Checkout | Stripe or Paddle? |  | false', 'Flaky test |  | PR #30 ↗ | true', 'Release notes |  |  | true', 'Migration |  |  | false', 'Pricing page |  |  | true', 'A link that is not a pull request |  |  | true']);   // a session at work, or one that waits for you, cannot be put away
    await press('Release notes', '.bdo'); assert.deepEqual(await tabs(), ['Checkout', 'Flaky test', 'Migration']);   // its tab leaves the row at once
    await press('Pricing page', '.bdo');
    assert.deepEqual(await read(), ['needs you? | 1 | Checkout', 'your turn | 1 | Flaky test', 'working | 1 | Migration', 'idle | 1 | A link that is not a pull request', 'Done | 2 | Release notes, Pricing page']);
    assert.equal(await page.evaluate(() => document.querySelector('.bdone').open), false);   // put away means out of sight: the section opens when asked
    await page.evaluate(() => { document.querySelector('.bdone').open = true; }); await sleep(3200);   // past a refresh of the board, and the time the marks take to reach the settings file
    assert.equal(await page.evaluate(() => document.querySelector('.bdone').open), true); assert.deepEqual(kept().sort(), ['Pricing page', 'Release notes']); assert.deepEqual(await tabs(), ['Checkout', 'Flaky test', 'Migration']);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(tmp, 'done.json'), 'utf8'))).sort(), ['-work-shop/' + id(NOTES), '-work-shop/' + id(OLD)]);   // a file of its own beside the settings: another window, on another server, reads it
    assert.equal(await post({ proj: '-work-shop', id: id(ASK) }), false); assert.equal(await post({ proj: '-work-shop', id: id(WORK) }), false); assert.equal(await post({ proj: '-work-shop', id: 'nope' }), false); assert.deepEqual(kept().sort(), ['Pricing page', 'Release notes']);   // a session that waits for you, or at work, is not put away, whoever asks
    await press('Pricing page', '.bdo');   // ↩ in the Done section
    assert.deepEqual((await read()).slice(3), ['idle | 2 | Pricing page, A link that is not a pull request', 'Done | 1 | Release notes']);
    fs.appendFileSync(file(NOTES), JSON.stringify(user('One more thing', 0)) + '\n'); await sleep(3600);   // the session moves again: it is back among the others by itself, and its mark is forgotten
    assert.ok(!(await read()).some((s) => /^Done/.test(s)), 'no Done section left'); assert.ok((await read()).some((s) => /Release notes/.test(s))); assert.deepEqual(kept(), []); assert.ok((await tabs()).includes('Release notes'));
    assert.deepEqual(errs, []);
  } finally { await browser.close(); srv.close(); core.shutdown(); }
});
