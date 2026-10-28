// test/server.test.js: the settings file, session stickiness, the cross-site guard and the pictures of a session, against a real server on a free port
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-test-'));
process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_KOKORO_DIR = path.join(tmp, 'kokoro'); process.env.AGENT_STANDUP_PROJECTS = path.join(tmp, 'projects');
// A stand-in for Claude Code, so that nothing here ever starts the real one: it "translates" a text into the name of the language it was asked for, a bar, and the text. Both ways the server calls it: a worker fed one line at a time, and one batch.
const CLAUDE = path.join(tmp, 'claude'); process.env.AGENT_STANDUP_CLAUDE = CLAUDE;
fs.writeFileSync(CLAUDE, `#!/usr/bin/env node
const a = process.argv.slice(2), sys = a[a.indexOf('--system-prompt') + 1] || '', lang = (s) => (/(?:natural spoken|meeting, in) ([A-Za-z ]+?)[,.]/.exec(s) || [])[1];
if (a.includes('--input-format')) require('readline').createInterface({ input: process.stdin }).on('line', (l) => { const m = JSON.parse(l); console.log(JSON.stringify({ type: 'result', result: lang(sys) + '|' + m.message.content })); });
else { let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => { const arr = JSON.parse(s.slice(s.indexOf('\\n') + 1)); console.log(JSON.stringify(arr.map((t) => lang(s) + '|' + t))); }); }
`, { mode: 0o755 });
const get = (port, p, headers = {}, method = 'GET', body) => new Promise((res, rej) => { const r = http.request({ port, path: p, method, headers }, (x) => { let b = '', n = 0; x.on('data', (d) => { b += d; n += d.length; }); x.on('end', () => res({ status: x.statusCode, body: b, type: x.headers['content-type'], bytes: n })); }); r.on('error', rej); if (body) r.write(body); r.end(); });
test('settings are kept in a file; cross-site writes are refused', async () => {
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  try {
    assert.match((await get(port, '/api/prefs.js')).body, /SAVED_PREFS = null/);
    assert.equal((await get(port, '/api/prefs', { 'content-type': 'application/json' }, 'PUT', '{"lang":"fr","_t":5}')).status, 200);
    assert.match((await get(port, '/api/prefs.js')).body, /"lang":"fr"/);
    assert.equal((await get(port, '/api/prefs', { 'sec-fetch-site': 'cross-site' }, 'PUT', '{}')).status, 403);
    assert.equal((await get(port, '/api/prefs', { origin: 'http://localhost:3000', 'content-type': 'application/json' }, 'PUT', '{"_t":6}')).status, 403, 'another local page (a dev server on another port) is another site');
    assert.equal((await get(port, '/api/prefs', { origin: `http://localhost:${port}`, 'content-type': 'application/json' }, 'PUT', '{"lang":"fr","_t":7}')).status, 200, 'the page itself');
    assert.equal((await get(port, '/api/prefs', {}, 'PUT', '[1]')).status, 400);
    { const put = (v) => get(port, '/api/prefs', { 'content-type': 'application/json' }, 'PUT', JSON.stringify(v)), saved = async () => JSON.parse((await get(port, '/api/prefs.js')).body.match(/SAVED_PREFS = (.*?); window/)[1]);   // the usage answer: an older page cannot bring back what a newer one changed
      await put({ lang: 'fr', _t: 8, shareUsage: true, shareUsageT: 100, usageAsked: true }); await put({ lang: 'fr', _t: 9, shareUsage: false, shareUsageT: 200, usageAsked: true });
      await put({ lang: 'en', _t: 10, shareUsage: true, shareUsageT: 100, usageAsked: true }); let p = await saved(); assert.equal(p.shareUsage, false, 'a page that still holds the old yes'); assert.equal(p.shareUsageT, 200); assert.equal(p.lang, 'en', 'its other settings are written');
      await put({ lang: 'en', _t: 11, shareUsage: true }); assert.equal((await saved()).shareUsage, false, 'a page with no date for it');
      await put({ lang: 'en', _t: 12, shareUsage: true, shareUsageT: 300, usageAsked: true }); assert.equal((await saved()).shareUsage, true, 'a newer answer wins');
      await put({ lang: 'fr', _t: 13, updateNotice: true, updateNoticeT: 400, updateAsked: true }); await put({ lang: 'fr', _t: 14, updateNotice: false, updateNoticeT: 500, updateAsked: true });   // the new-version notice, the same way: turned off in one window
      await put({ lang: 'en', _t: 15, updateNotice: true, updateNoticeT: 400, updateAsked: true }); p = await saved(); assert.equal(p.updateNotice, false, 'a window opened before cannot turn the npm check back on'); assert.equal(p.lang, 'en');
      await put({ lang: 'fr', _t: 16 }); }
    { const put = (v) => get(port, '/api/prefs', { 'content-type': 'application/json' }, 'PUT', JSON.stringify(v)), saved = async () => JSON.parse((await get(port, '/api/prefs.js')).body.match(/SAVED_PREFS = (.*?); window/)[1]);   // two windows: each sends what it changed, and neither puts back what the other changed
      await put({ lang: 'fr', _t: 20, music: false, leadName: 'Old' });
      await put({ _patch: { set: { leadName: 'Bob', _t: 21 }, del: [] } }); await put({ _patch: { set: { music: true, _t: 22 }, del: [] } });
      let p = await saved(); assert.deepEqual([p.leadName, p.music, p.lang], ['Bob', true, 'fr']);
      await put({ _patch: { set: { _t: 23 }, del: ['leadName', 'nothing'] } }); p = await saved(); assert.ok(!('leadName' in p), 'a key the page removed'); assert.equal(p.music, true);
      await put({ lang: 'xx', music: false, leadName: 'Stale', _patch: { set: { _t: 23.5 }, del: [] } }); p = await saved(); assert.deepEqual([p.lang, p.music, '_patch' in p], ['fr', true, false], 'the whole settings beside a patch are for older servers: this one merges the patch only');
      await put({ lang: 'fr', _t: 30, music: true, leadName: 'Olga', _patch: { set: { lang: 'de', _t: 4 }, del: ['music'] } }); p = await saved(); assert.deepEqual([p.lang, p.music, p.leadName, p._t, '_patch' in p], ['fr', true, 'Olga', 30, false], 'a stale patch an older page carries along: its settings are written whole');
      assert.equal((await put({ _patch: { set: [1], del: 'x' } })).status, 200); assert.equal((await saved()).music, true, 'an odd patch changes nothing');
      await put({ lang: 'fr', _t: 24 }); assert.ok(!('music' in (await saved())), 'a whole object (an older page) still replaces the file'); }
    assert.equal(JSON.parse((await get(port, '/api/kokoro')).body).installed, false);
    assert.equal((await get(port, '/api/kokoro/install', { 'sec-fetch-site': 'cross-site' }, 'POST')).status, 403);
  } finally { srv.close(); require('../server.js').shutdown(); }
});
test('the page is told where it runs, for ⚙ › Rate: the store page the editor gave, a star on GitHub for the desktop app and the command line', async () => {
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port, h0 = process.env.AGENT_STANDUP_HOST, r0 = process.env.AGENT_STANDUP_RATE;
  const app = async () => JSON.parse((await get(port, '/api/prefs.js')).body.match(/window\.AS_APP = (.*);$/)[1]), GH = 'https://github.com/Atoll92/agent-standup', MP = 'https://marketplace.visualstudio.com/items?itemName=DoubleGeste.agent-standup&ssr=false#review-details';
  try {
    delete process.env.AGENT_STANDUP_HOST; delete process.env.AGENT_STANDUP_RATE; assert.deepEqual(await app(), { kind: '', rate: GH, track: true, updates: true });
    process.env.AGENT_STANDUP_HOST = 'desktop app'; process.env.AGENT_STANDUP_RATE = MP; assert.deepEqual(await app(), { kind: 'desktop', rate: GH, track: true, updates: true });   // the desktop app has no store
    process.env.AGENT_STANDUP_HOST = 'command line'; assert.deepEqual(await app(), { kind: 'cli', rate: GH, track: true, updates: true });
    process.env.AGENT_STANDUP_HOST = 'claude code plugin'; assert.deepEqual(await app(), { kind: 'plugin', rate: GH, track: true, updates: true });   // the plugin's commands: agent-standup --from plugin
    process.env.AGENT_STANDUP_HOST = 'Cursor 1.2'; assert.deepEqual(await app(), { kind: 'editor', rate: MP, track: true, updates: true });
    process.env.AGENT_STANDUP_RATE = 'https://example.com/'; assert.deepEqual(await app(), { kind: 'editor', rate: GH, track: true, updates: true });   // only the two stores
    process.env.AGENT_STANDUP_LEAD_NAME = '  Zoé</script> '; assert.equal((await app()).lead, 'Zoé</script>'); assert.doesNotMatch((await get(port, '/api/prefs.js')).body, /<\/script>/);   // the lead's name set in the editor (agentStandup.leadName): handed to the page, which cleans it
    process.env.AGENT_STANDUP_LEAD_NAME = '   '; assert.equal('lead' in (await app()), false);
  } finally {
    delete process.env.AGENT_STANDUP_LEAD_NAME;
    for (const [k, v] of [['AGENT_STANDUP_HOST', h0], ['AGENT_STANDUP_RATE', r0]]) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    srv.close(); require('../server.js').shutdown();
  }
});

test('usage, for those who said yes (in the settings file, not only in the page) in the desktop app, the command line and the plugin: one empty request a week for the counter of that kind, none for the editor, none with DO_NOT_TRACK', async () => {
  const hits = [], sink = http.createServer((q, r) => { hits.push(q.url); r.end('GIF89a'); }); await new Promise((r) => sink.listen(0, '127.0.0.1', r));
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port, keep = ['AGENT_STANDUP_HOST', 'AGENT_STANDUP_PING_BASE', 'DO_NOT_TRACK'].map((k) => [k, process.env[k]]);
  const send = async () => JSON.parse((await get(port, '/api/usage', { origin: `http://localhost:${port}` }, 'POST')).body), wait = () => new Promise((r) => setTimeout(r, 300)), dir = path.dirname(process.env.AGENT_STANDUP_PREFS);
  const app = async () => JSON.parse((await get(port, '/api/prefs.js')).body.match(/window\.AS_APP = (.*);$/)[1]), saved0 = fs.existsSync(process.env.AGENT_STANDUP_PREFS) ? fs.readFileSync(process.env.AGENT_STANDUP_PREFS, 'utf8') : null;
  try {
    process.env.AGENT_STANDUP_PING_BASE = `http://127.0.0.1:${sink.address().port}/stats/`; delete process.env.DO_NOT_TRACK;
    for (const f of fs.readdirSync(dir)) if (f.startsWith('sent-')) fs.unlinkSync(path.join(dir, f));
    const P = process.env.AGENT_STANDUP_PREFS, saved = fs.existsSync(P) ? fs.readFileSync(P, 'utf8') : null, said = (yes) => fs.writeFileSync(P, JSON.stringify({ ...JSON.parse(saved || '{}'), shareUsage: yes }));
    process.env.AGENT_STANDUP_HOST = 'command line'; said(false); assert.equal((await send()).sent, false, 'no yes in the settings file: nothing, whatever the page asks'); await wait(); assert.deepEqual(hits, []);
    said(true); process.env.AGENT_STANDUP_HOST = 'Visual Studio Code 1.99'; assert.equal((await send()).sent, false, 'the editor counts itself (extension.js)');
    process.env.AGENT_STANDUP_HOST = 'command line'; const a = await send(); assert.equal(a.sent, true); assert.match(a.week, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await send()).sent, false, 'once a week'); await wait(); assert.deepEqual(hits, ['/stats/cli-week.gif']);
    process.env.AGENT_STANDUP_HOST = 'claude code plugin'; assert.equal((await send()).sent, true); process.env.AGENT_STANDUP_HOST = 'desktop app'; assert.equal((await send()).sent, true);
    await wait(); assert.deepEqual(hits.slice().sort(), ['/stats/cli-week.gif', '/stats/desktop-week.gif', '/stats/plugin-week.gif'], 'a counter for each kind, nothing else in the request');
    for (const f of fs.readdirSync(dir)) if (f.startsWith('sent-')) fs.unlinkSync(path.join(dir, f));
    process.env.DO_NOT_TRACK = '1'; assert.equal((await send()).sent, false, 'DO_NOT_TRACK'); assert.equal((await app()).track, false, 'and the page does not ask'); assert.equal((await app()).updates, false, 'nor about new versions'); await wait(); assert.equal(hits.length, 3);
    assert.equal((await get(port, '/api/usage', { 'sec-fetch-site': 'cross-site' }, 'POST')).status, 403, 'another site cannot make it count');
  } finally {
    for (const [k, v] of keep) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    if (saved0 == null) { try { fs.unlinkSync(process.env.AGENT_STANDUP_PREFS); } catch {} } else fs.writeFileSync(process.env.AGENT_STANDUP_PREFS, saved0);
    srv.close(); sink.close(); require('../server.js').shutdown();
  }
});

test('a newer version, in the desktop app, the command line and the plugin, for those who said yes (in the settings file): npm asked once a day for all of them, again an hour after a failure, the step that updates each; nothing for the editor, without a yes, with DO_NOT_TRACK or NO_UPDATE_NOTIFIER', async () => {
  let answer = JSON.stringify({ name: '@double_geste/agent-standup', version: '99.0.0' }); const hits = [], sink = http.createServer((q, r) => { hits.push(q.url); r.setHeader('content-type', 'application/json'); r.end(answer); }); await new Promise((r) => sink.listen(0, '127.0.0.1', r));
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port, keep = ['AGENT_STANDUP_HOST', 'AGENT_STANDUP_UPDATE_URL', 'DO_NOT_TRACK', 'NO_UPDATE_NOTIFIER'].map((k) => [k, process.env[k]]);
  const P = process.env.AGENT_STANDUP_PREFS, saved0 = fs.existsSync(P) ? fs.readFileSync(P, 'utf8') : null, file = path.join(path.dirname(P), 'update-check.json'), upd = async () => JSON.parse((await get(port, '/api/update')).body);
  try {
    process.env.AGENT_STANDUP_UPDATE_URL = `http://127.0.0.1:${sink.address().port}/latest`; delete process.env.DO_NOT_TRACK; delete process.env.NO_UPDATE_NOTIFIER; try { fs.unlinkSync(file); } catch {}
    const said = (v) => fs.writeFileSync(P, JSON.stringify({ ...JSON.parse(saved0 || '{}'), updateNotice: v }));
    process.env.AGENT_STANDUP_HOST = 'command line'; said(undefined); assert.equal((await upd()).on, false, 'no yes in the settings file: nothing'); said(false); assert.equal((await upd()).on, false); said(true);
    process.env.AGENT_STANDUP_HOST = 'Visual Studio Code 1.99'; assert.equal((await upd()).on, false, 'the editor updates itself'); assert.deepEqual(hits, []);
    process.env.AGENT_STANDUP_HOST = 'command line'; const a = await upd();
    assert.equal(a.on, true); assert.equal(a.newer, true); assert.equal(a.latest, '99.0.0'); assert.match(a.current, /^\d+\.\d+\.\d+$/); assert.equal(a.notes, 'https://github.com/Atoll92/agent-standup/releases/tag/v99.0.0');
    assert.equal(a.how, 'npm', 'not run from npx\'s cache'); assert.equal(a.cmd, 'npm i -g @double_geste/agent-standup@latest'); assert.deepEqual(hits, ['/latest']);
    assert.equal((await upd()).latest, '99.0.0'); process.env.AGENT_STANDUP_HOST = 'claude code plugin'; const b = await upd();
    assert.equal(b.how, 'plugin'); assert.match(b.cmd, /claude plugin update agent-standup@double-geste/); process.env.AGENT_STANDUP_HOST = 'desktop app'; const c = await upd();
    assert.equal(c.how, 'download'); assert.equal(c.url, 'https://github.com/Atoll92/agent-standup/releases/latest'); assert.equal(hits.length, 1, 'one request a day, shared by every kind and server');
    fs.writeFileSync(file, JSON.stringify({ t: Date.now(), latest: a.current })); assert.equal((await upd()).newer, false, 'already the latest');
    fs.writeFileSync(file, JSON.stringify({ t: Date.now() - 2 * 864e5, latest: '1.0.0' })); assert.equal((await upd()).latest, '99.0.0', 'a day later: asked again'); assert.equal(hits.length, 2);
    answer = '<html>not json'; fs.writeFileSync(file, JSON.stringify({ t: Date.now() - 2 * 864e5, latest: '99.0.0' })); assert.equal((await upd()).latest, '99.0.0', 'a failure keeps what was known');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).failed, true); await upd(); assert.equal(hits.length, 3, 'and waits an hour before asking again');
    answer = JSON.stringify({ version: '99.0.0; rm -rf /' }); fs.writeFileSync(file, JSON.stringify({ t: Date.now() - 2 * 864e5, latest: '' })); const d = await upd(); assert.equal(d.on, true); assert.equal(d.latest, undefined, 'only a plain version number is believed'); assert.equal(d.newer, undefined);
    said(false); assert.equal((await upd()).on, false, 'turned off again in the settings file'); said(true);
    process.env.DO_NOT_TRACK = '1'; assert.equal((await upd()).on, false, 'DO_NOT_TRACK'); delete process.env.DO_NOT_TRACK; process.env.NO_UPDATE_NOTIFIER = '1'; assert.equal((await upd()).on, false, 'NO_UPDATE_NOTIFIER');
    assert.equal(hits.length, 4, 'none of those asked npm'); assert.equal((await get(port, '/api/update', { 'sec-fetch-site': 'cross-site' })).status, 403, 'another site cannot make it ask');
  } finally {
    for (const [k, v] of keep) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    if (saved0 == null) { try { fs.unlinkSync(P); } catch {} } else fs.writeFileSync(P, saved0); try { fs.unlinkSync(file); } catch {}
    srv.close(); sink.close(); require('../server.js').shutdown();
  }
});

test('one window at a time plays sound, also when each window has its own server (one per VS Code window): the last that claimed it, until it stops answering', async () => {
  const a = require('../server.js').start(0), b = require('../server.js').start(0); await Promise.all([a, b].map((x) => new Promise((r) => x.once('listening', r))));
  const owner = async (srv, q) => JSON.parse((await get(srv.address().port, '/api/audio?' + q)).body).owner;
  try {
    assert.equal(await owner(a, 'cid=win-one&claim=1'), 'win-one'); assert.equal(await owner(b, 'cid=win-two'), 'win-one', 'the other server knows it too');
    assert.equal(await owner(b, 'cid=win-two&claim=1'), 'win-two'); assert.equal(await owner(a, 'cid=win-one'), 'win-two');
    const f = path.join(path.dirname(process.env.AGENT_STANDUP_PREFS), 'audio.json'); fs.writeFileSync(f, JSON.stringify({ id: 'win-two', seen: Date.now() - 7000 }));   // win-two has not answered for 7 s
    assert.equal(await owner(a, 'cid=win-one'), null);
  } finally { a.close(); b.close(); }
});

test('on Windows, a claude installed with npm gets each argument whole through cmd.exe: the empty value of --tools and the system prompt stay one argument each', () => {
  const q = require('../server.js')._winArg;
  assert.equal(['-p', '--tools', '', '--system-prompt', 'Translate it, as a colleague would say it.'].map(q).join(' '), '"-p" "--tools" "" "--system-prompt" "Translate it, as a colleague would say it."');
  assert.equal(q('a "quote"\nand a line'), '"a \'quote\' and a line"');
});

test('pictures returned by tools are counted in the timeline and served from the transcript only', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', pic = (type, data) => ({ type: 'image', source: { type: 'base64', media_type: type, data } });
  const rec = (id, content) => [{ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: '/x/shot.png' } }] } }, { type: 'user', timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } }].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const dir = path.join(tmp, 'projects', '-p'); fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), rec('toolu_pic', [pic('image/png', png), pic('image/svg+xml', 'PHN2Zy8+')])); fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-a1.jsonl'), rec('toolu_sub', [pic('image/png', png)]));
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port, media = (q) => get(port, '/api/media?proj=-p&id=s1&' + q);
  try {
    const items = JSON.parse((await get(port, '/api/session?proj=-p&id=s1')).body).events.filter((e) => e.kind === 'results').flatMap((e) => e.items);
    assert.deepEqual(items.map((it) => [it.id, it.img]).sort(), [['toolu_pic', 1], ['toolu_sub', 1]]);   // the SVG is not a picture we show
    const ok = await media('agent=main&tool=toolu_pic&n=0'); assert.equal(ok.status, 200); assert.equal(ok.type, 'image/png'); assert.equal(ok.bytes, Buffer.from(png, 'base64').length);
    assert.equal((await media('agent=a1&tool=toolu_sub&n=0')).status, 200);
    assert.equal((await media('agent=main&tool=toolu_pic&n=1')).status, 404);
    assert.equal((await media('agent=main&tool=toolu_sub&n=0')).status, 404);
    assert.equal((await media('agent=..&tool=toolu_pic&n=0')).status, 400);
    assert.equal((await get(port, '/api/media?proj=..&id=s1&agent=main&tool=toolu_pic&n=0')).status, 400);
    assert.equal((await get(port, '/api/media?proj=-p&id=s1&agent=main&tool=toolu_pic&n=0', { 'sec-fetch-site': 'cross-site' })).status, 403);
  } finally { srv.close(); require('../server.js').shutdown(); }
});

test('a browser the agent drives (Claude in Chrome) is described step by step, with the page it is on and the frame its clicks are counted in', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', C = 'mcp__claude-in-chrome__';
  const tabs = '\n\nTab Context:\n- Executed on tabId: 7\n- Available tabs:\n  • tabId 7: "Sweego Application" ("https://app.sweego.io/credentials/smtp")';   // the way the extension ends its answers (1.x, October 2026)
  const calls = [['toolu_br1', C + 'computer', { action: 'screenshot', tabId: 7, scale: 0.5 }, [{ type: 'text', text: 'Successfully captured screenshot (644x474, jpeg) - ID: ss_1 — 0.5-scale view; coordinate frame: 1288x948.' + tabs }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }]],
    ['toolu_br2', C + 'computer', { action: 'left_click', coordinate: [640, 570], tabId: 7, action_summary: 'Opens the Email section' }, [{ type: 'text', text: 'Clicked at (640, 570)' }]],
    ['toolu_br3', C + 'browser_batch', { actions: [{ name: 'navigate', input: { url: 'https://example.com/a', tabId: 7 } }, { name: 'computer', input: { action: 'type', text: 'hello', tabId: 7, action_summary: 'Types the name' } }] }, [{ type: 'text', text: 'Navigated to https://example.com/a\nTyped "hello"' }]],
    ['toolu_br4', C + 'navigate', { url: 'https://nope.example', tabId: 7 }, 'Navigation failed', true]];
  const lines = calls.flatMap(([id, name, input, content, err]) => [{ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(err ? { is_error: true } : {}) }] } }]);
  const dir = path.join(tmp, 'projects', '-br'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 's1.jsonl'), lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  try {
    const ev = JSON.parse((await get(port, '/api/session?proj=-br&id=s1')).body).events, tools = ev.filter((e) => e.kind === 'tools').flatMap((e) => e.tools), res = Object.fromEntries(ev.filter((e) => e.kind === 'results').flatMap((e) => e.items).map((it) => [it.id, it]));
    assert.deepEqual(tools.map((t) => t.d), [{ kind: 'browser', steps: [{ a: 'screenshot' }] }, { kind: 'browser', steps: [{ a: 'left_click', x: 640, y: 570, n: 'Opens the Email section' }] }, { kind: 'browser', steps: [{ a: 'navigate', u: 'https://example.com/a' }, { a: 'type', t: 'hello', n: 'Types the name' }] }, { kind: 'browser', steps: [{ a: 'navigate', u: 'https://nope.example' }] }]);
    assert.equal(tools[1].arg, 'Opens the Email section'); assert.equal(tools[2].arg, 'Types the name');   // what the tile's ticker says: the agent's own account of the step
    assert.deepEqual(res.toolu_br1.web, { u: 'https://app.sweego.io/credentials/smtp', t: 'Sweego Application', f: [1288, 948] }); assert.equal(res.toolu_br1.img, 1);   // half-scale picture, full-size clicks
    assert.equal(res.toolu_br2.web, undefined); assert.deepEqual(res.toolu_br3.web, { u: 'https://example.com/a' }); assert.equal(res.toolu_br4.web, undefined);   // a call that failed says nothing about the page
  } finally { srv.close(); require('../server.js').shutdown(); }
});
test('the desktop app\'s browser and its spelling of Claude in Chrome are browsers too: their page, the frame of their screenshots, and where a click on an element landed', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', B = 'mcp__Claude_Browser__', shot = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: png } };
  const tabs = '\n\nTab Context:\n- Executed on tabId: seed\n- Available tabs:\n  • tabId seed: "Agent Standup" ("http://localhost:4747/")';   // the way the desktop app's browser ends its answers (October 2026): its tabs have names
  const calls = [['toolu_db1', B + 'navigate', { url: 'http://localhost:4747' }, [{ type: 'text', text: 'navigated to http://localhost:4747/' }, { type: 'text', text: tabs }]],
    ['toolu_db2', B + 'computer', { action: 'screenshot' }, [shot, { type: 'text', text: '[Image: source: /x/blob.jpg]' }, { type: 'text', text: 'Screenshot size: 800x600' }, { type: 'text', text: tabs }]],
    ['toolu_db3', B + 'computer', { action: 'screenshot', scale: 0.6 }, [shot, { type: 'text', text: 'Screenshot size: 480x360 0.6-scale view; coordinate frame: 800x600.' }, { type: 'text', text: tabs }]],
    ['toolu_db4', B + 'computer', { action: 'left_click', ref: 'ref_112', action_summary: 'Joins the live call' }, [{ type: 'text', text: 'left_click at (628, 441) [ref_112]' }, { type: 'text', text: tabs }]],
    ['toolu_db5', 'mcp__Claude_in_Chrome__computer', { action: 'left_click', coordinate: [10, 20], tabId: 3 }, [{ type: 'text', text: 'Clicked at (10, 20)\n\nTab Context:\n- Executed on tabId: 3\n- Available tabs:\n  • tabId 3: "Inbox "today"" (https://mail.example.com/)' }]],   // the desktop app's Chrome: no quotes around the address
    ['toolu_db6', 'mcp__Claude_in_Chrome__computer', { action: 'left_click', ref: 'ref_9', tabId: 3 }, [{ type: 'text', text: 'Clicked on element ref_9' }]]];
  const lines = calls.flatMap(([id, name, input, content]) => [{ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } }]);
  const dir = path.join(tmp, 'projects', '-db'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 's1.jsonl'), lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  try {
    const ev = JSON.parse((await get(port, '/api/session?proj=-db&id=s1')).body).events, tools = ev.filter((e) => e.kind === 'tools').flatMap((e) => e.tools), res = Object.fromEntries(ev.filter((e) => e.kind === 'results').flatMap((e) => e.items).map((it) => [it.id, it]));
    assert.deepEqual(tools.map((t) => t.d.kind), ['browser', 'browser', 'browser', 'browser', 'browser', 'browser']);
    assert.deepEqual(tools[3].d.steps, [{ a: 'left_click', n: 'Joins the live call' }]); assert.deepEqual(tools[4].d.steps, [{ a: 'left_click', x: 10, y: 20 }]);
    const page = { u: 'http://localhost:4747/', t: 'Agent Standup' };
    assert.deepEqual(res.toolu_db1.web, page); assert.deepEqual(res.toolu_db2.web, { ...page, f: [800, 600] }); assert.equal(res.toolu_db2.img, 1); assert.deepEqual(res.toolu_db3.web, { ...page, f: [800, 600] });   // full size or at 0.6, the clicks are counted in 800x600
    assert.deepEqual(res.toolu_db4.web, { ...page, p: [628, 441] });   // the click named an element: the answer says where it landed
    assert.deepEqual(res.toolu_db5.web, { u: 'https://mail.example.com/', t: 'Inbox "today"' }); assert.equal(res.toolu_db6.web, undefined);   // Chrome does not say where a click on an element landed
  } finally { srv.close(); require('../server.js').shutdown(); }
});
test('an order typed while the lead is working is part of the call', async () => {
  const at = (s) => `2026-01-01T00:00:0${s}Z`, queued = (s, prompt, origin) => ({ type: 'attachment', timestamp: at(s), attachment: { type: 'queued_command', prompt, origin, commandMode: origin.kind === 'human' ? 'prompt' : 'task-notification' } });
  const recs = [{ type: 'user', timestamp: at(0), message: { role: 'user', content: 'first order' } }, { type: 'assistant', timestamp: at(1), message: { content: [{ type: 'tool_use', id: 'toolu_q', name: 'Bash', input: { command: 'ls' } }] } },
    queued(2, [{ type: 'text', text: 'order sent meanwhile' }], { kind: 'human' }), queued(3, '<task-notification>\n<task-id>x</task-id>', { kind: 'task-notification' }), { type: 'assistant', timestamp: at(4), message: { content: [{ type: 'text', text: 'On it.' }] } }];
  const dir = path.join(tmp, 'projects', '-q'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 's2.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  try {
    const said = JSON.parse((await get(port, '/api/session?proj=-q&id=s2')).body).events.filter((e) => e.kind === 'user' || e.kind === 'say').map((e) => [e.agent, e.text]);
    assert.deepEqual(said, [['user', 'first order'], ['user', 'order sent meanwhile'], ['main', 'On it.']]);
  } finally { srv.close(); require('../server.js').shutdown(); }
});
// ---- 1.25.7: a live feed that loses nothing, the end of the lead's turn, transcripts of other shapes, requests that used to stop the server
const wait = (ms) => new Promise((r) => setTimeout(r, ms)), at = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + s * 1000).toISOString(), line = (r) => JSON.stringify(r) + '\n';
const said = (s, text, o = {}) => ({ type: 'assistant', timestamp: at(s), message: { id: o.id || 'm' + s, stop_reason: o.stop === undefined ? null : o.stop, content: [{ type: o.thinking ? 'thinking' : 'text', [o.thinking ? 'thinking' : 'text']: text }] } });
const used = (s, id, name, input, o = {}) => ({ type: 'assistant', timestamp: at(s), message: { id: o.id || 'm' + s, stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
const typed = (s, content, o = {}) => ({ type: 'user', timestamp: at(s), ...o, message: { role: 'user', content } }), result = (s, id, content, o = {}) => typed(s, [{ type: 'tool_result', tool_use_id: id, content }], o);
const serve = async () => { const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); return { srv, port: srv.address().port, stop: () => { srv.close(); require('../server.js').shutdown(); } }; };
const load = async (port, q) => JSON.parse((await get(port, '/api/session?' + q)).body);
test('a live call followed record by record ends with exactly what a fresh load shows', async () => {
  const dir = path.join(tmp, 'projects', '-f'), main = path.join(dir, 's.jsonl'), sub = path.join(dir, 's', 'subagents', 'agent-a1.jsonl'); fs.mkdirSync(path.dirname(sub), { recursive: true });
  const steps = [   // [file, record]: written one at a time, the way Claude Code writes them
    [main, typed(0, 'first order')], [main, said(1, 'I will look.')],
    [main, used(2, 'toolu_r', 'Read', { file_path: '/x/a.js' }, { id: 'mA' })], [main, used(2, 'toolu_g', 'Grep', { pattern: 'slow' }, { id: 'mA' })], [main, used(3, 'toolu_ag', 'Agent', { prompt: 'Find the slow query.', description: 'Profiler' }, { id: 'mA' })],   // one message, one record per tool call
    [sub, typed(4, 'Find the slow query.')], [sub, used(5, 'toolu_b', 'Bash', { command: 'ls' })], [sub, said(6, 'Found it: the cart query.')],
    [main, { type: 'attachment', timestamp: at(2.5), attachment: { type: 'queued_command', prompt: [{ type: 'text', text: 'ORDER TYPED MEANWHILE' }], origin: { kind: 'human' }, commandMode: 'prompt' } }],   // typed at 2.5 s, delivered after lines stamped later
    [main, result(7, 'toolu_ag', 'The cart query is slow.')],   // the sub-agent's completion record comes after its last text
    [main, used(8, 'toolu_e', 'Edit', { file_path: '/x/a.js', old_string: 'a', new_string: 'b' })], [main, typed(9, [{ type: 'text', text: '[Request interrupted by user for tool use]' }])],
    [main, typed(10, 'second order')], [main, said(11, 'Done.', { stop: 'end_turn' })]];
  fs.writeFileSync(path.join(dir, 's', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Profiler', toolUseId: 'toolu_ag' }));
  fs.writeFileSync(main, line(steps[0][1]));
  const { port, stop } = await serve(), q = 'proj=-f&id=s';
  try {
    const first = await load(port, q), have = new Map(first.events.map((e) => [e.k, e])), seen = []; let seq = first.seq, late = 0; const ep = first.ep;
    assert.equal(typeof ep, 'string'); assert.ok(Number.isInteger(seq)); assert.equal(have.size, first.events.length); assert.equal(first.marks, 1, 'before the lead has written anything, its turn is open');   // marks: the turns of this transcript end with a mark, so the lead is at work until one comes
    const marks = [];
    for (const [file, rec] of steps.slice(1)) {
      fs.appendFileSync(file, line(rec)); await wait(280);   // the server does not build a timeline twice within 250 ms
      const d = await load(port, q + '&after=' + seq + '&ep=' + ep); assert.equal(d.ep, ep); assert.ok(d.seq >= seq); assert.deepEqual(Object.keys(d).filter((k) => k !== 'marks').sort(), ['agents', 'ep', 'events', 'id', 'project', 'seq']); assert.deepEqual(d.project, { key: 'claude:-f', label: '-f' }); marks.push(d.marks || 0);
      for (const e of d.events) { seen.push([have.has(e.k) ? 'changed' : 'new', e.kind, e.agent, e.end || 0]); if (!have.has(e.k) && [...have.values()].some((x) => x.ts > e.ts)) late++; have.set(e.k, e); }   // what the page does: a known key is replaced in place, an unknown one is added
      seq = d.seq; const idle = await load(port, q + '&after=' + seq + '&ep=' + ep); assert.deepEqual(idle.events, []); assert.deepEqual(idle.project, first.project);   // asked again with the new number: nothing
    }
    const fresh = await load(port, q); assert.equal(fresh.ep, ep); assert.equal(fresh.seq, seq); assert.equal(marks[0], 0, 'a transcript whose records carry no stop reason is not said to mark its turns'); assert.equal(marks[marks.length - 1], 1); assert.equal(fresh.marks, 1);
    assert.equal(new Set(fresh.events.map((e) => e.k)).size, fresh.events.length);   // keys are unique
    assert.deepEqual([...have.keys()].sort(), fresh.events.map((e) => e.k).sort()); for (const e of fresh.events) assert.deepEqual(have.get(e.k), e);
    fs.mkdirSync(path.join(tmp, 'projects', '-f2'), { recursive: true }); fs.cpSync(dir, path.join(tmp, 'projects', '-f2'), { recursive: true });   // the same files read for the first time by a server that never saw them grow: same keys, same events
    const cold = await load(port, 'proj=-f2&id=s'); assert.notEqual(cold.ep, ep); assert.deepEqual(cold.events, fresh.events);
    // the three losses of the feed by position, each seen coming through
    assert.ok(late >= 1); assert.ok(seen.some((s) => s[0] === 'new' && s[1] === 'user')); assert.equal([...have.values()].filter((e) => e.kind === 'user').map((e) => e.text).join('|'), 'first order|ORDER TYPED MEANWHILE|second order');
    assert.ok(seen.some((s) => s[0] === 'changed' && s[1] === 'report' && s[2] === 'a1')); assert.deepEqual([...have.values()].filter((e) => e.agent === 'a1').map((e) => e.kind).sort(), ['finish', 'report', 'tools']);
    assert.ok(seen.some((s) => s[0] === 'changed' && s[1] === 'tools' && s[2] === 'main')); assert.deepEqual(fresh.events.filter((e) => e.kind === 'tools' && e.agent === 'main').map((e) => e.tools.map((t) => t.id).join('+') + (e.end ? ' end' : '')), ['toolu_r+toolu_g', 'toolu_e end']);
    assert.ok(seen.some((s) => s[0] === 'changed' && s[1] === 'tools' && s[3] === 1));   // the interruption marks a beat the page already had: it comes back under the same key
    // a page that follows another feed is told to load again; a page from before the upgrade is still answered by position
    assert.deepEqual(await load(port, q + '&after=0&ep=nope'), { resync: true }); assert.deepEqual(await load(port, q + '&after=' + (seq + 1) + '&ep=' + ep), { resync: true });
    const old = await load(port, q + '&after=2'); assert.equal(old.total, fresh.events.length); assert.deepEqual(old.events, fresh.events.slice(2)); assert.deepEqual(old.project, first.project);
    assert.equal((await load(port, q + '&after=0&ep=' + ep)).events.length, fresh.events.length);
  } finally { stop(); }
});
test('the lead\'s turn ends on end_turn or on an interruption, and only the lead\'s', async () => {
  const dir = path.join(tmp, 'projects', '-e'); fs.mkdirSync(path.join(dir, 's', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 's.jsonl'), [typed(0, 'one'), said(1, 'Looking.', { stop: 'tool_use', id: 'm1' }), used(1, 'toolu_1', 'Bash', { command: 'ls' }, { id: 'm1' }), result(2, 'toolu_1', 'a.js'),
    said(3, 'hm', { thinking: 1, stop: 'end_turn', id: 'm2' }), said(3, 'All good.', { stop: 'end_turn', id: 'm2' }),   // one message, one record per block, each with the stop reason: the mark is on the line, once
    typed(4, 'two'), said(5, 'Starting.'), used(6, 'toolu_2', 'Bash', { command: 'sleep 9' }), used(6, 'toolu_3', 'Read', { file_path: '/x' }), result(7, 'toolu_2', 'no', { toolUseResult: 'interrupted' }), typed(7, [{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
    typed(8, 'three'), said(9, 'Let me think about'), typed(10, [{ type: 'text', text: '[Request interrupted by user]' }]), typed(11, 'four'), used(12, 'toolu_4', 'Glob', { pattern: '*' })].map(line).join(''));
  fs.writeFileSync(path.join(dir, 's', 'subagents', 'agent-a1.jsonl'), [typed(1, 'sub order'), said(2, 'Sub done.', { stop: 'end_turn' })].map(line).join(''));
  const { port, stop } = await serve();
  try {
    const ev = (await load(port, 'proj=-e&id=s')).events.filter((e) => e.kind === 'say' || e.kind === 'tools' || e.kind === 'user' || e.kind === 'report');
    assert.deepEqual(ev.map((e) => e.agent + ' ' + (e.text || e.tools.map((t) => t.id).join('+')) + (e.end ? ' END' : '')), ['user one', 'main Looking.', 'main toolu_1', 'a1 Sub done.', 'main All good. END', 'user two', 'main Starting.', 'main toolu_2+toolu_3 END', 'user three', 'main Let me think about END', 'user four', 'main toolu_4']);
    assert.ok(ev.every((e) => e.end === undefined || e.end === 1));
  } finally { stop(); }
});
test('a turn that ends on a message Claude Code writes itself is over: the API is down, the limit is reached, a refusal, nothing to answer; a message of the model that is cut is not the end', async () => {
  const dir = path.join(tmp, 'projects', '-x'); fs.mkdirSync(path.join(dir, 's', 'subagents'), { recursive: true });
  const err = (s, text, stop = 'stop_sequence') => ({ ...said(s, text, { stop }), isApiErrorMessage: true });   // written by Claude Code itself, in the place of the model's answer
  const own = (r) => ({ ...r, message: { ...r.message, model: '<synthetic>' } });
  fs.writeFileSync(path.join(dir, 's.jsonl'), [typed(0, 'one'), said(1, 'Looking.'), err(2, 'API Error: 529 Overloaded.'), typed(3, 'two'), err(4, 'You have hit your limit'), typed(5, 'three'), err(6, 'API Error: the safeguards flagged this message', 'refusal'),
    typed(7, 'four'), own(said(8, 'No response requested.', { stop: 'stop_sequence' })), typed(9, 'five'), said(10, 'A long answer that was cut', { stop: 'max_tokens' }), typed(11, 'six'), said(12, 'Stopped by a safety check in the middle', { stop: 'refusal' }), said(13, 'and it goes on.', { stop: 'tool_use' }),
    typed(14, 'seven'), used(15, 'toolu_w', 'Bash', { command: 'sleep 60' }), err(16, 'API Error: Connection lost mid-response.'), result(17, 'toolu_w', 'ok'), said(18, 'Back, and done.', { stop: 'end_turn' })].map(line).join(''));   // the connection dropped while a call was out: the lead goes on when it answers
  fs.writeFileSync(path.join(dir, 's', 'subagents', 'agent-a1.jsonl'), [typed(1, 'sub order'), err(1.5, 'API Error: 500')].map(line).join(''));   // a sub-agent that fails does not end the lead's turn
  const { port, stop } = await serve();
  try {
    const ev = (await load(port, 'proj=-x&id=s')).events.filter((e) => e.kind === 'say' || e.kind === 'user');
    assert.deepEqual(ev.map((e) => e.agent + ' ' + e.text + (e.end ? ' END' : '')), ['user one', 'main Looking.', 'a1 API Error: 500', 'main API Error: 529 Overloaded. END', 'user two', 'main You have hit your limit END', 'user three', 'main API Error: the safeguards flagged this message END', 'user four', 'main No response requested. END', 'user five', 'main A long answer that was cut', 'user six', 'main Stopped by a safety check in the middle', 'main and it goes on.', 'user seven', 'main API Error: Connection lost mid-response.', 'main Back, and done. END']);
  } finally { stop(); }
});

test('compaction summaries, workflow agents, titles and a transcript rewritten in place', async () => {
  const dir = path.join(tmp, 'projects', '-w'), main = path.join(dir, 's.jsonl'), run = path.join(dir, 's', 'subagents', 'workflows', 'wf_run1'); fs.mkdirSync(run, { recursive: true });
  const wfAgent = (id, phase, recs) => { fs.writeFileSync(path.join(run, `agent-${id}.jsonl`), recs.map(line).join('')); fs.writeFileSync(path.join(run, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'workflow-subagent', description: 'check ' + id, workflowPhase: phase })); };
  fs.writeFileSync(main, [typed(0, 'x'.repeat(70000)), said(1, 'NOT THE TITLE'), typed(2, 'This session is being continued. '.repeat(400), { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
    used(3, 'toolu_wf', 'Workflow', { script: 'run()' }), result(4, 'toolu_wf', 'launched', { toolUseResult: { status: 'async_launched', runId: 'wf_run1' } }), said(5, 'Launched.', { stop: 'end_turn' })].map(line).join(''));
  wfAgent('w1', 'Review', [typed(6, 'Review the cart.'), used(7, 'toolu_w1', 'Bash', { command: 'ls' }), said(8, 'Cart is fine.')]); wfAgent('w2', 'Verify', [typed(6, 'Verify the login.'), said(9, 'Still looking.')]);
  fs.writeFileSync(path.join(run, 'journal.jsonl'), [{ type: 'launched' }, { type: 'started', agentId: 'w1', key: 'a', label: 'check w1', phase: 'Review' }, { type: 'started', agentId: 'w2', key: 'b', label: 'check w2', phase: 'Verify' }, { type: 'result', agentId: 'w1', key: 'a', result: { ok: true } }].map(line).join(''));
  const { port, stop } = await serve(), q = 'proj=-w&id=s', row = async (p) => JSON.parse((await get(port, p)).body).find((r) => r.proj === '-w');
  try {
    const tl = await load(port, q), by = (k) => tl.events.filter((e) => e.kind === k);
    assert.deepEqual(by('user').map((e) => e.text.length), [70000]);   // the summary is not something the human said
    assert.deepEqual(tl.agents.map((a) => [a.id, a.role, a.type, a.wf, a.phase]), [['main', 'Lead', 'main', undefined, undefined], ['w1', 'check w1', 'workflow-subagent', 'wf_run1', 'Review'], ['w2', 'check w2', 'workflow-subagent', 'wf_run1', 'Verify']]);   // journal.jsonl is not an agent
    assert.deepEqual(by('order').map((e) => [e.agent, e.to, e.bg, e.wf, e.toolId, e.text, e.title, e.k]), [['main', 'w1', true, 'wf_run1', 'toolu_wf', 'Review the cart.', 'check w1', 'o/w1'], ['main', 'w2', true, 'wf_run1', 'toolu_wf', 'Verify the login.', 'check w2', 'o/w2']]);
    assert.deepEqual(by('report').map((e) => [e.agent, e.to, e.text]), [['w1', 'main', 'Cart is fine.']]); assert.deepEqual(by('finish').map((e) => [e.agent, e.to, e.k]), [['w1', 'main', 'f/w1']]);   // the journal says w1 handed its result back; w2 is still at work
    assert.deepEqual(by('say').map((e) => [e.agent, e.text]), [['main', 'NOT THE TITLE'], ['main', 'Launched.'], ['w2', 'Still looking.']]);
    assert.equal((await get(port, '/api/media?proj=-w&id=s&agent=w1&tool=toolu_w1&n=0')).status, 404); assert.equal((await get(port, '/api/media?proj=-w&id=s&agent=nobody&tool=toolu_w1&n=0')).status, 404); assert.equal((await get(port, '/api/media?proj=-w&id=s&agent=main&tool=e&n=0')).status, 400);
    const b = await row('/api/board'); assert.equal(b.title, 'x'.repeat(90)); assert.equal(b.subTotal, 2); assert.equal((await row('/api/sessions')).agents, 2);   // the first prompt, cut off by the 64 KB read, and not the assistant's first line
    fs.appendFileSync(main, line({ type: 'ai-title', aiTitle: 'Named later' })); await wait(1300); assert.equal((await row('/api/board')).title, 'Named later');
    fs.appendFileSync(main, line({ type: 'custom-title', customTitle: 'Renamed by hand' }) + line({ type: 'ai-title', aiTitle: 'Named again' })); await wait(1300); assert.equal((await row('/api/board')).title, 'Renamed by hand');
    fs.appendFileSync(path.join(run, 'journal.jsonl'), line({ type: 'result', agentId: 'w2', key: 'b', result: 'done' })); await wait(280);   // only the journal changed: w2's last line becomes its report
    const d = await load(port, q + '&after=' + tl.seq + '&ep=' + tl.ep); assert.deepEqual(d.events.map((e) => [e.k, e.kind, e.agent]).sort(), [['f/w2', 'finish', 'w2'], [tl.events.find((e) => e.text === 'Still looking.').k, 'report', 'w2']]);
    const size = fs.statSync(main).size; fs.writeFileSync(main, [typed(0, 'a different conversation'), said(1, 'With other lines.'), said(2, 'x'.repeat(size + 5000), { stop: 'end_turn' })].map(line).join('')); await wait(280); assert.ok(fs.statSync(main).size > size);   // rewritten in place and longer than before: the bytes after the old length must not be read as a continuation
    assert.deepEqual(await load(port, q + '&after=' + d.seq + '&ep=' + d.ep), { resync: true });
    const again = await load(port, q); assert.notEqual(again.ep, tl.ep); assert.deepEqual(again.events.filter((e) => e.agent === 'main' || e.agent === 'user').filter((e) => e.kind !== 'order').map((e) => e.kind + (e.end ? ' end' : '')), ['user', 'say', 'say end']);
  } finally { stop(); }
});
test('no request stops the server; another site cannot read the settings', async () => {
  const dir = path.join(tmp, 'projects', '-l'); fs.mkdirSync(path.join(dir, 's', 'subagents'), { recursive: true }); fs.writeFileSync(path.join(dir, 's.jsonl'), line(typed(0, 'hello')));
  let links = true; try { fs.symlinkSync(path.join(dir, 'gone.jsonl'), path.join(dir, 'dead.jsonl')); fs.symlinkSync(path.join(dir, 'gone.jsonl'), path.join(dir, 's', 'subagents', 'agent-dead.jsonl')); } catch { links = false; }   // links that point nowhere (not allowed on every Windows account)
  const { port, stop } = await serve(), raw = (text) => new Promise((res, rej) => { const s = require('net').connect(port, '127.0.0.1', () => s.write(text)); let b = ''; s.on('data', (d) => { b += d; }); s.on('error', rej); s.on('close', () => res(b)); setTimeout(() => s.destroy(), 1500); });
  try {
    assert.match(await raw(`GET // HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 400 /);   // used to be an exception outside any try: the process died
    for (const p of ['/%', '/..%2f..%2fetc/passwd', '/api/session?proj=%00&id=%ff', '/api/media', '/api/tts?text=hi&voice=' + 'x'.repeat(300), '/characters/%', '/packs/cats/..%2f..%2fserver.js']) assert.ok((await get(port, p)).status >= 400, p);
    for (const p of ['/api/sessions', '/api/projects', '/api/current', '/api/current?proj=-l', '/api/current?proj=..&id=..&sproj=..&sid=..', '/api/board', '/api/session?proj=-l&id=s']) assert.equal((await get(port, p)).status, 200, p + (links ? ' with a dangling link next to the transcripts' : ''));
    assert.deepEqual(JSON.parse((await get(port, '/api/sessions')).body).filter((r) => r.proj === '-l').map((r) => r.id), ['s']); assert.equal(JSON.parse((await get(port, '/api/current?proj=-l')).body).id, 's');
    assert.equal((await get(port, '/api/prefs.js', { 'sec-fetch-site': 'cross-site' })).status, 403); assert.equal((await get(port, '/api/prefs.js', { 'sec-fetch-site': 'same-site' })).status, 403);   // a <script src> on another site's page
    assert.equal((await get(port, '/api/prefs.js', { 'sec-fetch-site': 'same-origin' })).status, 200); assert.equal((await get(port, '/api/prefs.js')).status, 200);
    assert.equal((await get(port, '/')).status, 200);   // still there
  } finally { stop(); }
});
test('the reasoning before a line or a call rides on it when the transcript keeps its text', async () => {
  const at = (n) => `2026-01-01T00:00:0${n}Z`, asst = (n, id, content) => ({ type: 'assistant', timestamp: at(n), message: { id, content } });
  const recs = [{ type: 'user', timestamp: at(0), message: { role: 'user', content: 'why is it slow' } }, asst(1, 'm1', [{ type: 'thinking', thinking: 'The query scans the whole table.\nI should check the index.', signature: 's' }]), asst(2, 'm1', [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: 'ls' } }]),
    asst(3, 'm2', [{ type: 'thinking', thinking: '', signature: 's' }]), asst(4, 'm2', [{ type: 'text', text: 'Found it.' }])];   // most of the time only the signature is kept: nothing to show
  const dir = path.join(tmp, 'projects', '-th'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 's3.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  try {
    const ev = JSON.parse((await get(port, '/api/session?proj=-th&id=s3')).body).events.filter((e) => e.kind === 'tools' || e.kind === 'say');
    assert.deepEqual(ev.map((e) => [e.kind, e.th || null]), [['tools', 'The query scans the whole table.\nI should check the index.'], ['say', null]]);
  } finally { srv.close(); require('../server.js').shutdown(); }
});
// ---- a sub-agent the person named keeps its name; the stock types get a first name from the page; the list of voices does not hold the server up
test('own agent names: the name given at launch, or the person\'s own agent type; never a stock type', async () => {
  const dir = path.join(tmp, 'projects', '-n'), subs = path.join(dir, 's', 'subagents'); fs.mkdirSync(subs, { recursive: true });
  const kids = [['a1', 'code-reviewer', {}, 3], ['a2', 'general-purpose', {}, 4], ['a3', 'general-purpose', { name: 'Athena' }, 5], ['a4', 'code-reviewer', {}, 6], ['a5', 'my-plugin:db_migrator', {}, 7], ['a6', 'Explore', {}, 8]];
  fs.writeFileSync(path.join(dir, 's.jsonl'), [typed(0, 'review it'), ...kids.map(([id, type, extra, s]) => used(s, 'toolu_' + id, 'Agent', { prompt: 'Do ' + id, description: 'Task ' + id, subagent_type: type, ...extra }, { id: 'mN' }))].map(line).join(''));
  for (const [id, type, , s] of kids) {
    fs.writeFileSync(path.join(subs, `agent-${id}.jsonl`), [typed(s + 10, 'Do ' + id), said(s + 11, 'On it.')].map(line).join(''));
    fs.writeFileSync(path.join(subs, `agent-${id}.meta.json`), JSON.stringify({ agentType: type, description: 'Task ' + id, toolUseId: 'toolu_' + id }));
  }
  const { port, stop } = await serve();
  try {
    const tl = await load(port, 'proj=-n&id=s'), own = Object.fromEntries(tl.agents.map((a) => [a.id, a.own || null]));
    assert.deepEqual(own, { main: null, a1: 'Code Reviewer', a2: null, a3: 'Athena', a4: 'Code Reviewer 2', a5: 'Db Migrator', a6: null });
    assert.ok(!tl.events.some((e) => 'nm' in e), 'the launch name stays on the server side');
    const t0 = Date.now(), [v, h] = await Promise.all([get(port, '/api/voices'), get(port, '/api/health')]);
    assert.equal(v.status, 200); assert.equal(h.status, 200); assert.ok(Array.isArray(JSON.parse(v.body).voices)); assert.ok(Date.now() - t0 < 20000);
  } finally { stop(); }
});
test('a pack name that is not a pack is answered as such, whatever the word', async () => {
  const { port, stop } = await serve();
  try {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'nope']) {
      const list = await get(port, '/api/characters?pack=' + name); assert.equal(list.status, 200, name); assert.deepEqual(JSON.parse(list.body).chars, [], name);
      assert.equal((await get(port, '/packs/' + name + '/a.png')).status, 404, name);
    }
    assert.ok(JSON.parse((await get(port, '/api/characters?pack=cats')).body).chars.length > 0);
    assert.deepEqual(JSON.parse((await get(port, '/api/packs')).body).map((p) => p.name + (p.shop ? ' (shop)' : '')), ['cats', 'vampire', 'halloween (shop)']);
    const vamp = JSON.parse((await get(port, '/api/characters?pack=vampire')).body).chars;   // the free vampire ships with the app: the human, with its open mouth and its room
    assert.deepEqual(vamp.map((c) => [c.role, c.head, c.talk, c.bg, c.desks, c.hands]), [['you', 'you-head.png', 'you-talk.png', 'you-bg.png', ['you-desk-dark.png', 'you-desk.png'], 'you-hands.png']]);
  } finally { stop(); }
});
test('the list of sessions: a line that goes on with a tool call is not the end of the turn', async () => {
  const dir = path.join(tmp, 'projects', '-b'), f = path.join(dir, 's.jsonl'); fs.mkdirSync(dir, { recursive: true });
  const { port, stop } = await serve(), row = async (proj = '-b') => { await wait(1300); return JSON.parse((await get(port, '/api/board')).body).find((r) => r.proj === proj); }, state = async (proj) => (await row(proj)).state;   // the list is worked out at most once every 1.2 s
  try {
    fs.writeFileSync(f, [typed(0, 'Write the file'), said(1, 'I write it now.', { stop: 'tool_use' })].map(line).join('')); assert.equal(await state(), 'working');   // the call itself is written when it is whole, many seconds later for a long file
    fs.appendFileSync(f, line(used(2, 'toolu_w', 'Bash', { command: 'ls' })) + line(result(3, 'toolu_w', 'ok')) + line(said(4, 'It is written.', { stop: 'end_turn' }))); assert.equal(await state(), 'turn');
    fs.appendFileSync(f, line(typed(5, 'Thanks')) + line(said(6, 'A line that does not say why it stopped, in a session that does.'))); assert.equal(await state(), 'working');   // Claude Code up to 2.1.87 before a tool call: the call may still come
    const ago = (Date.now() - 60000) / 1000; fs.utimesSync(f, ago, ago); assert.equal(await state(), 'turn');   // none came for 45 s: that was its last word
    fs.appendFileSync(f, line(typed(7, 'Go on')) + line(used(8, 'toolu_x', 'Bash', { command: 'sleep 60' }))); assert.equal(await state(), 'working');
    fs.appendFileSync(f, line(typed(9, '[Request interrupted by user for tool use]'))); const cut = await row(); assert.equal(cut.state, 'turn'); assert.equal(cut.cut, 1);   // Esc: your turn there, and you know it
    fs.appendFileSync(f, line(typed(10, 'Again')) + line(said(11, 'Done.', { stop: 'end_turn' }))); const done = await row(); assert.equal(done.state, 'turn'); assert.equal(done.cut, undefined);
    fs.mkdirSync(path.join(tmp, 'projects', '-b2'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'projects', '-b2', 's.jsonl'), [typed(0, 'Hello'), said(1, 'A session that never says why its messages stop.')].map(line).join('')); assert.equal(await state('-b2'), 'turn');   // as before
  } finally { stop(); }
});
test('the list of sessions: a turn that ends saying it could not do the work, or on an error, is flagged; a caveat on work that was done is not', async () => {
  const dir = path.join(tmp, 'projects', '-g'), f = path.join(dir, 's.jsonl'); fs.mkdirSync(dir, { recursive: true });
  const { port, stop } = await serve(), row = async () => { await wait(1300); return JSON.parse((await get(port, '/api/board')).body).find((r) => r.proj === '-g'); };
  try {
    fs.writeFileSync(f, [typed(0, 'Draft replies to these posts'), used(1, 'toolu_a', 'WebFetch', { url: 'https://example.com' }), result(2, 'toolu_a', 'no date'), said(3, "**I couldn't verify how old the target posts were**, so I wrote 0 drafts. The pages give no date.", { stop: 'end_turn' })].map(line).join(''));
    let r = await row(); assert.equal(r.state, 'turn'); assert.equal(r.gave, "I couldn't verify how old the target posts were, so I wrote 0 drafts.");
    fs.appendFileSync(f, line(typed(4, 'Try again')) + line(said(5, "Done: 12 drafts are in drafts.md. I couldn't check the two oldest posts.", { stop: 'end_turn' }))); r = await row(); assert.equal(r.state, 'turn'); assert.equal(r.gave, undefined);   // a caveat after the work
    fs.appendFileSync(f, line(typed(6, 'And the rest?')) + line(said(7, "The tests pass, but I couldn't run the browser ones.", { stop: 'end_turn' }))); assert.equal((await row()).gave, undefined);   // what worked comes first
    fs.appendFileSync(f, line(typed(6, 'Review it')) + line(said(7, "I couldn't find any bugs in this diff. The tests pass.", { stop: 'end_turn' }))); assert.equal((await row()).gave, undefined);   // a check that came out clean
    fs.appendFileSync(f, line(typed(6, 'Look again')) + line(said(7, "I can't reproduce it: it already works on main.", { stop: 'end_turn' }))); assert.equal((await row()).gave, undefined);
    for (const [t, gave] of [["I couldn't reproduce the crash, but I found the cause in parse() and fixed it.", undefined], ["We can't use fetch in the extension host, so I switched to https.get. Tests pass.", undefined], ["I couldn't find any callers of foo(), so it's safe to remove.", undefined],   // the same sentence goes on to what was done instead
      ["I couldn't push to origin, but the commit is ready locally: run git push yourself.", "I couldn't push to origin, but the commit is ready locally"], ["I couldn't install Playwright, so I used curl instead and it also fails.", "I couldn't install Playwright, so I used curl instead and it also fails."], ["## I couldn't finish the deploy\n\nThe token expired.", "I couldn't finish the deploy."]])   // handed back, a workaround that failed too, a heading that says it
      { fs.appendFileSync(f, line(typed(6, 'Go')) + line(said(7, t, { stop: 'end_turn' }))); assert.equal((await row()).gave, gave, t); }
    fs.appendFileSync(f, line(typed(6, 'And the config?')) + line(said(7, "I couldn't find the config file, so nothing changed.", { stop: 'end_turn' }))); assert.equal((await row()).gave, "I couldn't find the config file, so nothing changed.");   // finding the file was the work
    fs.appendFileSync(f, line(typed(8, 'Encore')) + line(said(9, "Je n'ai pas pu me connecter au serveur : il refuse la connexion.", { stop: 'end_turn' }))); assert.equal((await row()).gave, "Je n'ai pas pu me connecter au serveur");
    fs.appendFileSync(f, line(typed(10, 'Go on')) + line({ ...said(11, "API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.", { stop: 'stop_sequence' }), isApiErrorMessage: true })); assert.match((await row()).gave, /^API Error: 529/);
    fs.appendFileSync(f, line(typed(12, 'Hi')) + line({ ...said(13, 'No response requested.', { stop: 'stop_sequence' }), message: { ...said(13, 'No response requested.', { stop: 'stop_sequence' }).message, model: '<synthetic>' } })); assert.equal((await row()).gave, undefined);
    fs.appendFileSync(f, line(typed(14, 'Fix it')) + line(said(15, "I couldn't find the file, let me search.", { stop: 'tool_use' })) + line(used(16, 'toolu_b', 'Bash', { command: 'sleep 60' }))); r = await row(); assert.equal(r.state, 'working'); assert.equal(r.gave, undefined);   // said on the way: the turn goes on
  } finally { stop(); }
});
test('a document a command names is a file of the session when it was written since that command: an export, a report a script made; not one it only read, listed or removed', async () => {
  const dir = path.join(tmp, 'projects', '-c'), work = path.join(tmp, 'work'), out = path.join(work, 'out'); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(out, { recursive: true });
  const T = (s) => Date.parse(at(s)), touch = (f, s) => { fs.writeFileSync(f, 'x'); fs.utimesSync(f, T(s) / 1000, T(s) / 1000); }, here = (r) => ({ ...r, cwd: work });   // each record says in which folder the session was
  const pdf = path.join(out, 'report.pdf'), csv = path.join(out, 'q3 export.csv'), zip = path.join(work, 'site.zip'), old = path.join(work, 'notes.md'), gone = path.join(out, 'draft.pdf'), late = path.join(work, 'video.mp4');
  const page = path.join(work, 'index.html'); touch(pdf, 12); touch(csv, 12); touch(zip, 31); touch(old, -900); touch(late, 60); touch(page, 56);
  fs.writeFileSync(path.join(dir, 's.jsonl'), [typed(0, 'Make the report'),
    here(used(10, 'toolu_a', 'Bash', { command: 'cd out && python3 ../make.py --pdf=report.pdf --csv "q3 export.csv" && rm draft.pdf && cat ../notes.md && curl -o x https://example.org/a.pdf && ls *.png' })), here(result(13, 'toolu_a', 'done')),
    here(used(30, 'toolu_b', 'Bash', { command: 'npm run pack' })), here(result(32, 'toolu_b', 'Packed 12 files.\nSaved to ' + zip + '.\nSee also notes.md')),
    here(used(40, 'toolu_c', 'Bash', { command: 'node render.js video.mp4' })), here(result(41, 'toolu_c', 'failed', { })), here(used(50, 'toolu_d', 'Bash', { command: "cat <<'EOF' > list.txt\nother.pdf\nEOF" })), here(result(51, 'toolu_d', '')),
    here(used(53, 'toolu_g', 'Bash', { command: 'grep -n title index.html' })), here(result(54, 'toolu_g', '3: title')), here(used(55, 'toolu_e', 'Edit', { file_path: page, old_string: 'a', new_string: 'b' })), here(result(56, 'toolu_e', 'ok')),
    said(58, 'Done.', { stop: 'end_turn' })].map(line).join(''));
  const { port, stop } = await serve(), server = require('../server.js'), run = server._reveal.run, shown = []; server._reveal.run = (f) => shown.push(f);
  const ask = (file, check) => get(port, '/api/reveal', { 'content-type': 'application/json' }, 'POST', JSON.stringify({ proj: '-c', id: 's', file, ...(check ? { check: true } : {}) })).then((r) => (check ? (r.status === 200 ? JSON.parse(r.body).reason || 200 : 'status ' + r.status) : r.status));   // a check is always answered 200: { exists: true } or { exists: false, reason }
  try {
    const tools = (await load(port, 'proj=-c&id=s')).events.filter((e) => e.kind === 'tools').flatMap((e) => e.tools), res = (await load(port, 'proj=-c&id=s')).events.filter((e) => e.kind === 'results').flatMap((e) => e.items);
    assert.deepEqual(tools[0].d.outs, [pdf, csv, gone, old]);   // named from the folder the command went to; not the link, nor the pattern
    assert.deepEqual(res.map((i) => i.files), [undefined, [zip, old], undefined, undefined, undefined, undefined]); assert.deepEqual(tools[4].d.outs, [page]); assert.deepEqual(tools[2].d.outs, [late]); assert.deepEqual(tools[3].d.outs, [path.join(work, 'list.txt')]);   // what a here-document holds is not the command
    assert.equal(await ask(pdf, true), 200); assert.equal(await ask(csv, true), 200); assert.equal(await ask(zip, true), 200); assert.deepEqual(shown, [], 'asking whether it is there opens nothing');
    assert.equal(await ask(old, true), 'unknown');    // read by a command, and written long before it
    assert.equal(await ask(page, true), 'unknown');   // looked at by a command, then changed by hand: recent for that reason, and not made by the command
    assert.equal(await ask(gone, true), 'gone');      // removed by the command
    assert.equal(await ask(path.join(work, 'make.py'), true), 'unknown'); assert.equal(await ask(path.join(work, 'other.pdf'), true), 'unknown'); assert.equal(await ask('/etc/hosts', true), 'unknown');
    assert.deepEqual(JSON.parse((await get(port, '/api/reveal', { 'content-type': 'application/json' }, 'POST', JSON.stringify({ proj: '-c', id: 's', file: pdf, check: true }))).body), { ok: true, exists: true });
    assert.deepEqual(JSON.parse((await get(port, '/api/reveal', { 'content-type': 'application/json' }, 'POST', JSON.stringify({ proj: '-c', id: 's', file: gone, check: true }))).body), { exists: false, reason: 'gone' });
    assert.equal(await ask(gone), 410); assert.deepEqual(shown, [], 'the real thing still says why it cannot');
    assert.equal(await ask(pdf), 200); assert.deepEqual(shown, [pdf]); assert.equal(await ask(old), 404); assert.deepEqual(shown, [pdf]);
    fs.writeFileSync(path.join(dir, 'big.jsonl'), [typed(0, 'Build it'), here(used(1, 'toolu_1', 'Bash', { command: 'make 2>&1 | tee \\\\server\\share\\log.txt //host/share/b.pdf ' + 'x<<1|y<<2;'.repeat(1900) })), here(result(2, 'toolu_1', ('std::cout << a << b << "report.pdf";\n').repeat(500))),
      here(used(3, 'toolu_2', 'Bash', { command: "cat <<EOF > a.txt\nx.pdf\nEOF\ncat <<'END' >> b.md\ny.pdf" })), said(4, 'Done.', { stop: 'end_turn' })].map(line).join(''));
    const t0 = Date.now(), big = (await load(port, 'proj=-c&id=big')).events.filter((e) => e.kind === 'tools').flatMap((e) => e.tools); assert.ok(Date.now() - t0 < 1500, 'a text full of "<<" is read as fast as any other: ' + (Date.now() - t0) + ' ms');
    assert.equal(big[0].d.outs, undefined); assert.deepEqual(big[1].d.outs, [path.join(work, 'a.txt'), path.join(work, 'b.md')]);   // no path on another machine; two here-documents, the second one never closed
  } finally { server._reveal.run = run; stop(); }
});

test('a file the session created is shown in its folder; no other path is, and nothing is opened from another site', async () => {
  const dir = path.join(tmp, 'projects', '-r'), made = path.join(tmp, 'made'), doc = path.join(made, 'report.md'), lost = path.join(made, 'lost.md'), other = path.join(made, 'other.md'); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(made, { recursive: true });
  fs.writeFileSync(doc, '# report'); fs.writeFileSync(other, 'read, never written');
  fs.writeFileSync(path.join(dir, 's.jsonl'), [typed(0, 'Write the report'), used(1, 'toolu_w1', 'Write', { file_path: doc, content: '# report' }), result(2, 'toolu_w1', 'ok'), used(3, 'toolu_w2', 'Write', { file_path: lost, content: 'x' }), result(4, 'toolu_w2', 'ok'),
    used(5, 'toolu_r', 'Read', { file_path: other }), result(6, 'toolu_r', 'x'), used(7, 'toolu_e', 'Edit', { file_path: other, old_string: 'a', new_string: 'b' }), result(8, 'toolu_e', 'ok'), said(9, 'Done.', { stop: 'end_turn' })].map(line).join(''));
  const { port, stop } = await serve(), server = require('../server.js'), run = server._reveal.run, shown = []; server._reveal.run = (f) => shown.push(f);
  const ask = (b, headers = {}) => get(port, '/api/reveal', { 'content-type': 'application/json', ...headers }, 'POST', typeof b === 'string' ? b : JSON.stringify(b));
  try {
    const ok = await ask({ proj: '-r', id: 's', file: doc }); assert.equal(ok.status, 200); assert.deepEqual(shown, [doc]);
    assert.equal((await ask({ proj: '-r', id: 's', file: lost })).status, 410);                    // created, then removed
    assert.equal((await ask({ proj: '-r', id: 's', file: other })).status, 404);                   // read and edited, not created by the session
    assert.equal((await ask({ proj: '-r', id: 's', file: '/etc/hosts' })).status, 404);
    assert.equal((await ask({ proj: '-r', id: 'nope', file: doc })).status, 404);
    assert.equal((await ask({ proj: '..', id: 's', file: doc })).status, 400);
    assert.equal((await ask({ proj: '-r', id: 's' })).status, 400); assert.equal((await ask('not json')).status, 400);
    assert.equal((await ask({ proj: '-r', id: 's', file: doc }, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await ask({ proj: '-r', id: 's', file: doc }, { origin: 'https://example.com' })).status, 403);
    assert.equal((await get(port, '/api/reveal?proj=-r&id=s&file=' + encodeURIComponent(doc))).status, 404);   // a link cannot do it: POST only
    assert.deepEqual(shown, [doc]);
    assert.deepEqual(shown, [doc]);
    assert.deepEqual(server._reveal.cmds('/a/b c/report.md', 'darwin'), [['open', ['-R', '/a/b c/report.md']]]);
    assert.deepEqual(server._reveal.cmds('C:\\a b\\report.md', 'win32')[0].slice(0, 2), ['explorer.exe', ['/select,"C:\\a b\\report.md"']]);
    const linux = server._reveal.cmds('/a/b c/report.md', 'linux'); assert.equal(linux[0][0], 'dbus-send'); assert.ok(linux[0][1].includes('array:string:file:///a/b%20c/report.md')); assert.deepEqual(linux[1], ['xdg-open', ['/a/b c']]);
    assert.deepEqual(server._reveal.cmds('/a/x,y.md', 'linux'), [['xdg-open', ['/a']]]);
  } finally { server._reveal.run = run; stop(); }
});

test('the errors of the app are kept in a file on this computer: each one once, without the home folder or the address of the page; another site neither reads nor writes them', async () => {
  const server = require('../server.js'), file = path.join(tmp, 'errors.log'), read = () => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const { port, stop } = await serve(), post = (body, headers = {}) => get(port, '/api/errors', { 'content-type': 'application/json', ...headers }, 'POST', body);
  try {
    const before = read().length, home = os.homedir(), e = new Error('cannot read ' + path.join(home, 'secret', 'notes.md'));
    e.stack = `Error: ${e.message}\n    at reader (${path.join(home, 'app', 'vibe.js')}:10:5)\n    at http://localhost:${port}/?live=1&proj=${home.replace(/[^a-zA-Z0-9]/g, '-')}-Documents-X:782:15`;
    server.logError('reader', e); server.logError('reader', e);   // the same error twice: one line
    const mine = read().slice(before); assert.equal(mine.length, 1); assert.equal(mine[0].where, 'reader'); assert.equal(mine[0].v, require('../package.json').version); assert.ok(!isNaN(Date.parse(mine[0].t)));
    assert.ok(!JSON.stringify(mine[0]).includes(home), 'the home folder is written ~'); assert.ok(!mine[0].stack.includes('proj='), 'the address of the page carries the project'); assert.match(mine[0].stack, /\nat page:782:15$/); assert.ok(!mine[0].stack.includes('cannot read'), 'the stack is the frames only');
    server.logError('reader', null); server.logError('reader', ''); assert.equal(read().length, before + 1);   // nothing to say: nothing written, and nothing thrown
    // an error of the page
    assert.equal((await post(JSON.stringify({ where: 'error', msg: 'paint is not a function', stack: `TypeError: paint is not a function\n    at step (http://localhost:${port}/?live=1&embed=1:900:3)` }))).status, 200);
    const rep = JSON.parse((await get(port, '/api/errors')).body), last = rep.errors[rep.errors.length - 1];
    assert.deepEqual([last.where, last.msg, last.stack], ['page error', 'paint is not a function', 'at step (page:900:3)']); assert.equal(rep.version, require('../package.json').version); assert.ok(rep.platform.startsWith(process.platform)); assert.equal(rep.node, process.version);
    assert.equal((await post('[not json')).status, 400); assert.equal((await post('{"msg":"from another site"}', { 'sec-fetch-site': 'cross-site' })).status, 403); assert.equal((await get(port, '/api/errors', { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.ok(!read().some((x) => x.msg === 'from another site'));
    // the home folder in every form it is written, on Windows too: a name with a space, the drive in the other case, "/" for "\", the path inside JSON, the folder of a Claude Code project
    const { tidy, homeRe } = server._scrub, win = homeRe('C:\\Users\\John Smith', true), w = (t) => tidy(t, 300, win);
    assert.equal(w('at f (c:\\Users\\John Smith\\.vscode\\extensions\\x\\server.js:1:2)'), 'at f (~\\.vscode\\extensions\\x\\server.js:1:2)'); assert.equal(w('C:/Users/John Smith/work/a.js'), '~/work/a.js');
    assert.equal(w('C:\\Users\\John Smith\\.claude\\projects\\c--Users-John-Smith-work-X\\a.jsonl'), '~\\.claude\\projects\\~-work-X\\a.jsonl'); assert.equal(w(JSON.stringify('C:\\Users\\John Smith\\a.js')), '"~\\\\a.js"');
    assert.equal(w('D:\\Users\\Some One Else\\a.js'), '~\\a.js'); assert.equal(tidy('tree-root in /rootfs --root-dir, file /root/a.js', 300, homeRe('/root', false)), 'tree-root in /rootfs --root-dir, file ~/a.js');   // someone else's home goes too; a home of a few letters is not found in every word
    assert.equal(tidy('Failed to load "http://localhost:4747/?live=1&proj=x" then http://[::1]:5000/?a=1:3:4', 300), 'Failed to load "page" then page:3:4');
    assert.equal(tidy('x'.repeat(299) + '😀', 300), 'x'.repeat(299)); assert.doesNotThrow(() => encodeURIComponent(tidy('x'.repeat(299) + '😀', 300)));   // a cut through an emoji leaves no half character: the link of the report could not carry it
  } finally { stop(); }
});

// ---- the shop: a pack is bought through the website (api/), which asks Stripe. Here the website and Stripe are both played by scripts/shop-dev.js, on this machine
const zipOf = (files) => {   // a zip as any tool writes it: one deflated entry per file, then the directory
  const zlib = require('zlib'), locals = [], dir = []; let at = 0;
  for (const [name, data] of files) { const n = Buffer.from(name), raw = Buffer.from(data), z = zlib.deflateRawSync(raw), crc = zlib.crc32 ? zlib.crc32(raw) : 0, h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(z.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(z.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(at, 42);
    locals.push(h, n, z); dir.push(c, n); at += 30 + n.length + z.length; }
  const d = Buffer.concat(dir), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(d.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, d, end]);
};
test('a pack of the shop: nothing before it is paid, the whole pack once it is, by the code of the purchase', async () => {
  const packs = path.join(tmp, 'packs'); process.env.AGENT_STANDUP_PACKS = packs;
  const zip = zipOf([['lead.png', 'PNG-lead'], ['lead-talk.png', 'PNG-talk'], ['lead-bg.png', 'PNG-room'], ['lead-desk.png', 'PNG-desk'], ['lead-desk-dark.png', 'PNG-dark'], ['lead-hands.png', 'PNG-hands'], ['lead+hat-1.png', 'PNG-hat1'], ['lead+hat-2.png', 'PNG-hat2'], ['lead+eyes-1.png', 'PNG-eyes'], ['nobody+hat-1.png', 'PNG-lost'], ['LICENCE.txt', 'terms'], ['../../evil.png', 'PNG-evil'], ['run.sh', 'echo no'], ['sub/.hidden.png', 'x']]);
  const shop = require('../scripts/shop-dev.js').start({ zip }); process.env.AGENT_STANDUP_STORE = await shop.ready;
  const { port, stop } = await serve(), post = async (p, b, h = {}) => { const r = await get(port, p, { 'content-type': 'application/json', ...h }, 'POST', JSON.stringify(b)); let j = {}; try { j = JSON.parse(r.body || '{}'); } catch {} return { status: r.status, ...j }; };
  const listed = async () => JSON.parse((await get(port, '/api/packs')).body).find((p) => p.name === 'halloween');
  try {
    assert.deepEqual(await listed(), { name: 'halloween', n: 0, shop: true, price: '2 €', artist: 'Fabien Coupas', artistUrl: 'https://www.instagram.com/fabien_coupas/', code: '', waiting: false });
    assert.equal((await get(port, '/packs/halloween/lead.png')).status, 404);
    assert.equal((await post('/api/packs/claim', { pack: 'halloween' })).error, 'code');   // nothing was bought here
    assert.equal((await post('/api/packs/buy', { pack: 'cats' })).status, 404); assert.equal((await post('/api/packs/buy', { pack: 'halloween' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
    const first = await post('/api/packs/buy', { pack: 'halloween' }), second = await post('/api/packs/buy', { pack: 'halloween' });   // the button pressed twice: two payment pages, either may be the one that is paid
    assert.equal(first.status, 200); assert.match(first.url, /^http:\/\/localhost:\d+\/pay\/cs_test_/); assert.equal(shop.sessions.size, 2);
    const [code1] = [...shop.sessions.keys()]; assert.ok(first.url.endsWith(code1)); assert.equal(second.status, 200);
    assert.deepEqual({ ...(await post('/api/packs/claim', { pack: 'halloween' })) }, { status: 402, error: 'unpaid' }); assert.equal((await listed()).waiting, true); assert.ok(!fs.existsSync(path.join(packs, 'halloween')));
    shop.pay(code1);   // the first page is the one paid
    assert.deepEqual(await post('/api/packs/claim', { pack: 'halloween' }), { status: 200, ok: true, n: 2 });   // lead, and the picture whose name tried to leave the folder, kept under its bare name
    assert.deepEqual(fs.readdirSync(path.join(packs, 'halloween')).sort(), ['LICENCE.txt', 'evil.png', 'lead+eyes-1.png', 'lead+hat-1.png', 'lead+hat-2.png', 'lead-bg.png', 'lead-desk-dark.png', 'lead-desk.png', 'lead-hands.png', 'lead-talk.png', 'lead.png', 'nobody+hat-1.png']);   // bare names only, pictures and the notes only
    assert.ok(!fs.existsSync(path.join(tmp, 'evil.png')) && !fs.existsSync(path.join(packs, 'evil.png')));
    const chars = JSON.parse((await get(port, '/api/characters?pack=halloween')).body).chars, lead = chars.find((c) => c.stem === 'lead');   // a room and an open mouth belong to their character: neither is a character of its own
    assert.deepEqual([lead.role, lead.talk, lead.bg, lead.desks, lead.hands], ['lead', 'lead-talk.png', 'lead-bg.png', ['lead-desk-dark.png', 'lead-desk.png'], 'lead-hands.png']);   // its laptops (light, dark) and its hands are its own too assert.deepEqual(chars.map((c) => c.stem), ['evil', 'lead']);
    assert.deepEqual(lead.extras, { eyes: ['lead+eyes-1.png'], hat: ['lead+hat-1.png', 'lead+hat-2.png'] }); assert.equal(chars[0].extras, null);   // what a character may wear, by kind: not characters either, and those of nobody are left out
    assert.equal((await get(port, '/packs/halloween/' + encodeURIComponent('lead+hat-2.png'))).body, 'PNG-hat2');
    assert.equal((await get(port, '/packs/halloween/lead-bg.png')).body, 'PNG-room'); assert.equal((await get(port, '/packs/halloween/LICENCE.txt')).status, 404);
    assert.deepEqual(await listed(), { name: 'halloween', n: 2, shop: true, price: '2 €', artist: 'Fabien Coupas', artistUrl: 'https://www.instagram.com/fabien_coupas/', code: shop.sessions.get(code1).metadata.code, waiting: false });   // the code shown is the one for people
    assert.match(shop.sessions.get(code1).metadata.code, /^HW-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/); assert.equal(shop.sessions.get(code1).form.get('payment_intent_data[description]'), 'Agent Standup: Halloween character pack. Purchase code ' + shop.sessions.get(code1).metadata.code);   // on the receipt Stripe emails
    assert.equal(shop.sessions.get(code1).form.get('invoice_creation[invoice_data][custom_fields][0][value]'), shop.sessions.get(code1).metadata.code); assert.match(shop.sessions.get(code1).form.get('custom_text[submit][message]'), /right of withdrawal/);
    assert.equal((await get(port, '/api/packs', { 'sec-fetch-site': 'cross-site' })).status, 403);   // the list carries the code of the purchase: not for another site
    // on another computer: the code is typed. A wrong one, the payment's own id (what the Stripe dashboard shows), then a refunded purchase
    fs.rmSync(packs, { recursive: true, force: true });
    assert.equal((await post('/api/packs/claim', { pack: 'halloween', code: 'cs_test_' + 'a'.repeat(30) })).error, 'code'); assert.equal((await post('/api/packs/claim', { pack: 'halloween', code: 'not a code' })).error, 'code');
    assert.equal((await post('/api/packs/claim', { pack: 'halloween', code: shop.sessions.get(code1).pi })).ok, true); assert.equal((await listed()).n, 2);
    fs.rmSync(packs, { recursive: true, force: true }); assert.equal((await post('/api/packs/claim', { pack: 'halloween', code: shop.sessions.get(code1).metadata.code.toLowerCase() })).ok, true);   // the code for people, typed as it comes
    assert.equal((await post('/api/packs/claim', { pack: 'halloween', code: 'HW-2222-2222' })).error, 'code');
    const dl = (q) => new Promise((ok) => http.get(process.env.AGENT_STANDUP_STORE + '/api/download?' + q, (r) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => ok({ status: r.statusCode, type: r.headers['content-type'], where: r.headers.location, disp: r.headers['content-disposition'], size: Buffer.concat(c).length })); }));   // the download, for a person
    const good = await dl('pack=halloween&code=' + shop.sessions.get(code1).metadata.code); assert.deepEqual([good.status, good.type, good.disp, good.size], [200, 'application/zip', 'attachment; filename="agent-standup-halloween.zip"', zip.length]);
    assert.deepEqual([(await dl('pack=halloween&code=HW-2222-2222')).status, (await dl('pack=halloween&code=HW-2222-2222')).where], [303, '/shop/?download=code#download']);
    shop.refund(code1); fs.rmSync(packs, { recursive: true, force: true });
    assert.deepEqual(await post('/api/packs/claim', { pack: 'halloween', code: code1 }), { status: 403, error: 'refunded' }); assert.equal((await listed()).n, 0);
    process.env.AGENT_STANDUP_STORE = 'http://localhost:9';   // the shop cannot be reached
    assert.deepEqual(await post('/api/packs/buy', { pack: 'halloween' }), { status: 502, error: 'offline' });
  } finally { stop(); shop.stop(); delete process.env.AGENT_STANDUP_STORE; delete process.env.AGENT_STANDUP_PACKS; }
});
test('a zip that is not a pack is refused whole', () => {
  const { installPack } = require('../server.js'); process.env.AGENT_STANDUP_PACKS = path.join(tmp, 'packs2');
  try {
    assert.throws(() => installPack('halloween', Buffer.from('not a zip at all, just some text that is long enough')), /not a zip/);
    assert.throws(() => installPack('halloween', zipOf([['notes.txt', 'x'], ['run.sh', 'y']])), /no picture/);
    assert.throws(() => installPack('halloween', zipOf([['big.png', Buffer.alloc(400 * 1024, 1)]])), /bad entry/);
    assert.ok(!fs.existsSync(path.join(tmp, 'packs2', 'halloween')));
  } finally { delete process.env.AGENT_STANDUP_PACKS; }
});
test('an artifact a session published is shown from the session file alone: each version as it was, in a frame that reaches neither the app nor the network', async () => {
  const fp = '/tmp/scratch/report.html', v1 = '<title>Report</title>\n<h1>Totals: $& "quoted" é</h1>\n<p>one</p>\n<p>one</p>', url = 'https://claude.ai/artifact/AbCdEf123456';
  let t = 0; const at = () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString();
  const use = (id, name, input) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } });
  const res = (id, content, extra = {}, err) => ({ type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(err ? { is_error: true } : {}) }] }, ...extra });
  const dc = '<!doctype html><x-dc><helmet><style>body{margin:0}</style></helmet><div id="cover">Cover</div><script type="text/x-dc" data-dc-script>class Component extends DCLogic {}</script></x-dc>';
  const lines = [
    use('toolu_write1', 'Write', { file_path: fp, content: v1 }), res('toolu_write1', 'File created'),
    use('toolu_pub001', 'Artifact', { file_path: fp, icon: 'chart', description: 'The totals of the quarter.' }), res('toolu_pub001', 'Published at ' + url, { toolUseResult: { url, title: 'Report', artifact_id: 'x' } }),
    use('toolu_edit01', 'Edit', { file_path: fp, old_string: '<p>one</p>', new_string: '<p>two $1</p>' }), res('toolu_edit01', 'ok'),
    use('toolu_edit02', 'Edit', { file_path: fp, old_string: 'Totals', new_string: 'REFUSED' }), res('toolu_edit02', 'File has been modified since read', {}, true),
    use('toolu_edit03', 'MultiEdit', { file_path: fp, edits: [{ old_string: '<p>one</p>', new_string: '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>' }, { old_string: 'é', new_string: 'e', replace_all: true }] }), res('toolu_edit03', 'ok'),
    use('toolu_other1', 'Write', { file_path: '/tmp/scratch/other.html', content: '<p>another page</p>' }), res('toolu_other1', 'File created'),
    use('toolu_pub002', 'Artifact', { file_path: fp, url }), res('toolu_pub002', 'Updated', { toolUseResult: { url, title: 'Report', seq: 2, updated: true } }),
    use('toolu_edit04', 'Edit', { file_path: fp, old_string: 'Totals', new_string: 'LATER' }), res('toolu_edit04', 'ok'),
    use('toolu_typed1', 'Artifact', { type_url: 'https://claude.ai/artifact/TypeTypeType', title: 'Deck' }), res('toolu_typed1', 'Created', { toolUseResult: { created_from_type: true, url: 'https://claude.ai/artifact/DeckDeck1234', title: 'Deck' } }),
    use('toolu_dcw000', 'Write', { file_path: '/tmp/scratch/design/project/canvas.json', content: JSON.stringify({ boards: { 'Main.dc.html': { x: 0, y: 0, w: 794, h: 1123, title: '01 · Cover' }, 'Two.dc.html': { x: 874, y: 0, w: 794, h: 1123, title: '02 · Two' } }, order: ['Two.dc.html', 'Main.dc.html'], notes: { a: { x: 0, y: -200, text: 'Intro', kind: 'title1' } } }) }), res('toolu_dcw000', 'File created'),
    use('toolu_dcw001', 'Write', { file_path: '/tmp/scratch/design/project/Main.dc.html', content: dc }), res('toolu_dcw001', 'File created'),   // a design: its artboard sent beside the canvas, then one sent on its own
    use('toolu_dcpub1', 'Artifact', { url: 'https://claude.ai/artifact/DeckDeck1234', root: '/tmp/scratch/design', file_path: '/tmp/scratch/design/project/canvas.json', files: { 'project/Main.dc.html': 'project/Main.dc.html' } }), res('toolu_dcpub1', 'Updated', { toolUseResult: { url: 'https://claude.ai/artifact/DeckDeck1234', title: 'Deck', seq: 2, updated: true, type: { url: 'https://claude.ai/artifact/TypeTypeType' } } }),
    use('toolu_dcpub2', 'Artifact', { url: 'https://claude.ai/artifact/DeckDeck1234', root: '/tmp/scratch/design', file_path: '/tmp/scratch/design/project/Main.dc.html' }), res('toolu_dcpub2', 'Updated', { toolUseResult: { url: 'https://claude.ai/artifact/DeckDeck1234', title: 'Deck', seq: 3, updated: true, type: { url: 'https://claude.ai/artifact/TypeTypeType' } } }),
    use('toolu_dcw002', 'Write', { file_path: '/tmp/scratch/design/project/Two.dc.html', content: '<p id="two">Page two</p>' }), res('toolu_dcw002', 'File created'),
    use('toolu_dcpub3', 'Artifact', { url: 'https://claude.ai/artifact/DeckDeck1234', root: '/tmp/scratch/design', file_path: '/tmp/scratch/design/project/Two.dc.html' }), res('toolu_dcpub3', 'Updated', { toolUseResult: { url: 'https://claude.ai/artifact/DeckDeck1234', title: 'Deck', seq: 4, updated: true, type: { url: 'https://claude.ai/artifact/TypeTypeType' } } }),
    use('toolu_plain1', 'Artifact', { file_path: '/tmp/scratch/notes.md', root: '/tmp/scratch', files: { 'side.html': '/tmp/scratch/other.html' } }), res('toolu_plain1', 'Published', { toolUseResult: { url: 'https://claude.ai/artifact/NotesNotes12', title: 'Notes' } }),   // a plain artifact whose main file is not a page: an HTML file it sent along is not its page
    use('toolu_nopage', 'Artifact', { file_path: '/tmp/scratch/built.html' }), res('toolu_nopage', 'Published', { toolUseResult: { url: 'https://claude.ai/artifact/BuiltBuilt12', title: 'Built by a script' } }),
    use('toolu_failed', 'Artifact', { file_path: '/tmp/scratch/other.html' }), res('toolu_failed', 'refused', { toolUseResult: 'Error: refused' }, true),
    use('toolu_asset1', 'Artifact', { url, asset: true, file_path: '/tmp/scratch/logo.png' }), res('toolu_asset1', 'Uploaded', { toolUseResult: { written: 1, asset_uploads: [] } }),
    use('toolu_read01', 'Artifact', { action: 'read', url }), res('toolu_read01', '<title>Report</title>', { toolUseResult: { file_read: true, url } }),
    use('toolu_evil01', 'Artifact', { file_path: fp }), res('toolu_evil01', 'Published', { toolUseResult: { url: 'https://claude.ai.example.com/artifact/AbCdEf123456', title: 'Elsewhere' } }),
  ];
  const dir = path.join(tmp, 'projects', '-art'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 's1.jsonl'), lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  const page = (q, headers = {}) => new Promise((ok, no) => http.get({ port, path: '/api/artifact?proj=-art&id=s1&' + q, headers }, (x) => { let b = ''; x.setEncoding('utf8'); x.on('data', (d) => { b += d; }); x.on('end', () => ok({ status: x.statusCode, body: b, csp: x.headers['content-security-policy'] || '', type: x.headers['content-type'] })); }).on('error', no));
  try {
    const ev = JSON.parse((await get(port, '/api/session?proj=-art&id=s1')).body).events, tools = ev.filter((e) => e.kind === 'tools').flatMap((e) => e.tools), items = ev.filter((e) => e.kind === 'results').flatMap((e) => e.items);
    assert.deepEqual(tools.filter((x) => x.d.kind === 'artifact').map((x) => x.id), ['toolu_pub001', 'toolu_pub002', 'toolu_typed1', 'toolu_dcpub1', 'toolu_dcpub2', 'toolu_dcpub3', 'toolu_plain1', 'toolu_nopage', 'toolu_failed', 'toolu_evil01']);   // a publish; not an upload, not a read
    assert.deepEqual(tools.find((x) => x.id === 'toolu_pub001').d, { kind: 'artifact', file: fp, title: '', note: 'The totals of the quarter.' });
    assert.deepEqual(items.filter((it) => it.art).map((it) => [it.id, it.art]), [['toolu_pub001', { url, title: 'Report' }], ['toolu_pub002', { url, title: 'Report', v: 2 }], ['toolu_typed1', { url: 'https://claude.ai/artifact/DeckDeck1234', title: 'Deck', typed: 1 }], ['toolu_dcpub1', { url: 'https://claude.ai/artifact/DeckDeck1234', title: 'Deck', v: 2, typed: 1 }], ['toolu_dcpub2', { url: 'https://claude.ai/artifact/DeckDeck1234', title: 'Deck', v: 3, typed: 1 }], ['toolu_dcpub3', { url: 'https://claude.ai/artifact/DeckDeck1234', title: 'Deck', v: 4, typed: 1 }], ['toolu_plain1', { url: 'https://claude.ai/artifact/NotesNotes12', title: 'Notes' }], ['toolu_nopage', { url: 'https://claude.ai/artifact/BuiltBuilt12', title: 'Built by a script' }]]);   // a link that is not claude.ai's is not shown
    const skel = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    const one = await page('agent=main&tool=toolu_pub001'); assert.equal(one.status, 200); assert.equal(one.type, 'text/html; charset=utf-8'); assert.equal(one.body, skel + v1);   // the first version, as it was published
    const two = await page('agent=main&tool=toolu_pub002'); assert.equal(two.body, skel + '<title>Report</title>\n<h1>Totals: $& "quoted" e</h1>\n<p>two $1</p>\n<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>');   // the edits up to the second publish, one by one; not the one that was refused, nor the one that came after
    assert.equal(await new Promise((ok, no) => http.get({ port, path: '/' }, (x) => { x.resume(); ok(x.headers['content-security-policy']); }).on('error', no)), "frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");   // the page that holds the frame lets it show the app's own address and no other
    assert.match(one.csp, /^sandbox allow-scripts; default-src 'none';/); assert.ok(!/https?:|allow-same-origin|allow-popups|allow-forms|allow-top/.test(two.csp)); assert.match(two.csp, /connect-src 'none'/);   // nothing from the network unless asked
    const net = await page('agent=main&tool=toolu_pub002&net=1'); assert.match(net.csp, /script-src 'unsafe-inline' 'unsafe-eval' https:\/\/cdnjs\.cloudflare\.com https:\/\/cdn\.jsdelivr\.net /); assert.match(net.csp, /^sandbox allow-scripts;/); assert.match(net.csp, /connect-src 'none'; frame-src 'none'; form-action 'none'/); assert.ok(!/allow-same-origin/.test(net.csp));
    assert.deepEqual(JSON.parse((await page('agent=main&tool=toolu_pub001&check=1')).body), { ok: true, net: false }); assert.deepEqual(JSON.parse((await page('agent=main&tool=toolu_pub002&check=1')).body), { ok: true, net: true });
    assert.equal(tools.find((x) => x.id === 'toolu_dcpub1').d.page, '/tmp/scratch/design/project/Main.dc.html'); assert.deepEqual(tools.find((x) => x.id === 'toolu_dcpub1').d.sent, ['/tmp/scratch/design/project/canvas.json', '/tmp/scratch/design/project/Main.dc.html']);
    assert.deepEqual(JSON.parse((await page('agent=main&tool=toolu_dcpub2&check=1')).body), { ok: true, net: false });   // one page so far: nothing more than a page
    assert.deepEqual(JSON.parse((await page('agent=main&tool=toolu_dcpub3&check=1')).body), { ok: true, net: false, pages: 2, label: '02 · Two' });   // two pages, the name the canvas gives this one
    assert.equal((await page('agent=main&tool=toolu_dcpub3')).body, skel + '<p id="two">Page two</p>');   // the page this publish sent
    const whole = await page('agent=main&tool=toolu_dcpub3&whole=1'), data = JSON.parse(/<script type="application\/json" id="d">([\s\S]*?)<\/script>/.exec(whole.body)[1]);
    assert.deepEqual(data.items.map((x) => [x.title, x.x, x.w, x.h]), [['02 · Two', 874, 794, 1123], ['01 · Cover', 0, 794, 1123]]); assert.equal(data.items[1].html, dc); assert.deepEqual(data.notes, [{ text: 'Intro', x: 0, y: -200, big: true }]);   // in the order of the canvas, where it puts them
    assert.ok(!/<\/script>/i.test(/id="d">([\s\S]*?)<\/script>/.exec(whole.body)[1]), 'a page cannot close the script that holds it'); assert.match(whole.csp, /^sandbox allow-scripts; default-src 'none';/);
    assert.equal((await page('agent=main&tool=toolu_pub002&whole=1')).body, two.body, 'a page that is not a document of several pages is itself');
    for (const id of ['toolu_dcpub1', 'toolu_dcpub2']) assert.equal((await page('agent=main&tool=' + id)).body, dc, id);   // made from a type: the artboard that was sent, as it was written
    for (const id of ['toolu_typed1', 'toolu_plain1', 'toolu_nopage', 'toolu_failed', 'toolu_asset1', 'toolu_read01', 'toolu_evil01', 'toolu_write1', 'toolu_nothere']) { assert.equal((await page('agent=main&tool=' + id)).status, 404, id); const c = await page('agent=main&tool=' + id + '&check=1'); assert.equal(c.status, 404); assert.deepEqual(JSON.parse(c.body), { ok: false }); }   // a template of claude.ai that was sent no page, a page no Write call made, a publish that failed, and what is not a publish
    assert.equal((await page('agent=a1&tool=toolu_pub001')).status, 404); assert.equal((await page('agent=..&tool=toolu_pub001')).status, 400); assert.equal((await page('agent=main&tool=x')).status, 400);
    assert.equal((await get(port, '/api/artifact?proj=..&id=s1&agent=main&tool=toolu_pub001')).status, 400); assert.equal((await get(port, '/api/artifact?proj=_codex&id=s1&agent=main&tool=toolu_pub001')).status, 404);
    assert.equal((await page('agent=main&tool=toolu_pub001', { 'sec-fetch-site': 'cross-site' })).status, 403); assert.equal((await page('agent=main&tool=toolu_pub001', { origin: 'null' })).status, 403);   // another site cannot have it; nor can the page itself, from inside its frame, ask the app for anything
  } finally { srv.close(); require('../server.js').shutdown(); }
});
test('a doc made with the Claude Docs connector, and an artifact opened on the person\'s screen, are in the line of files; once per artifact, whatever its address', async () => {
  let t = 0; const at = () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString();
  const use = (id, name, input) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } });
  const res = (id, content, extra = {}, err) => ({ type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(err ? { is_error: true } : {}) }] }, ...extra });
  const doc = '393c5caa-df0e-41e7-adc2-72c128cd02c9', docUrl = 'https://claude.ai/code/artifact/' + doc, D = 'mcp__claude_ai_Claude_Docs__batch';
  const born = (minted, url) => [{ type: 'text', text: JSON.stringify({ verdict: 'allow', acks: [{ verdict: 'allow', minted: 'e3b4362c-be18' }], created: { verdict: 'allow', minted, bound: true }, frame: { slug: minted, url, artifactUrl: url } }) }, { type: 'text', text: "The doc's viewer is at " + url }];
  const lines = [
    use('toolu_doc001', D, { container: { kind: 'project', create: { name: 'Growth report', doc: { markdown: '# Growth report' } } }, batch: [] }), res('toolu_doc001', born(doc, docUrl), { toolUseResult: born(doc, docUrl) }),
    use('toolu_open01', 'Artifact', { action: 'open', url: docUrl }), res('toolu_open01', 'Opened the Artifact', { toolUseResult: { opened: true, url: 'https://claude.ai/artifact/84voqSfc2pp96QTMGotLXS', artifact_id: doc, title: 'Growth report' } }),
    use('toolu_doc002', D, { container: { kind: 'project', id: doc }, batch: [{ verb: 'update' }] }), res('toolu_doc002', [{ type: 'text', text: JSON.stringify({ verdict: 'allow', frame: { slug: doc, url: docUrl } }) }]),
    use('toolu_pub001', 'Artifact', { file_path: '/tmp/scratch/page.html' }), res('toolu_pub001', 'Published', { toolUseResult: { url: 'https://claude.ai/artifact/PagePagePage', title: 'Page', artifact_id: 'p1' } }),
    use('toolu_open02', 'Artifact', { action: 'open', url: 'https://claude.ai/artifact/PagePagePage' }), res('toolu_open02', 'Opened', { toolUseResult: { opened: true, url: 'https://claude.ai/artifact/PagePagePage', artifact_id: 'p1', title: 'Page' } }),
    use('toolu_open03', 'Artifact', { action: 'open', url: 'https://claude.ai/artifact/OlderOlder12' }), res('toolu_open03', 'Opened', { toolUseResult: { opened: true, url: 'https://claude.ai/artifact/OlderOlder12', artifact_id: 'old1', title: 'Made last week' } }),
    use('toolu_pub002', 'Artifact', { file_path: '/tmp/scratch/noid.html' }), res('toolu_pub002', 'Published', { toolUseResult: { url: 'https://claude.ai/artifact/NoIdNoIdNoId', title: 'No id' } }),
    use('toolu_open05', 'Artifact', { action: 'open', url: 'https://claude.ai/artifact/NoIdNoIdNoId' }), res('toolu_open05', 'Opened', { toolUseResult: { opened: true, url: 'https://claude.ai/artifact/NoIdNoIdNoId', artifact_id: 'n1', title: 'No id' } }),
    use('toolu_open04', 'Artifact', { action: 'open', url: 'https://claude.ai/artifact/OlderOlder12' }), res('toolu_open04', 'Opened', { toolUseResult: { opened: true, url: 'https://claude.ai/artifact/OlderOlder12', artifact_id: 'old1', title: 'Made last week' } }),
    use('toolu_doc003', D, { container: { kind: 'project', create: { name: 'Refused' } }, batch: [] }), res('toolu_doc003', 'refused', {}, true),
    use('toolu_doc004', D, { container: { kind: 'project', create: { name: 'Elsewhere' } }, batch: [] }), res('toolu_doc004', born('aaaaaaaa-0000', 'https://claude.ai.example.com/artifact/aaaaaaaa-0000')),
    use('toolu_doc005', 'mcp__other__batch', { container: { kind: 'project', create: { name: 'Not a doc' } } }), res('toolu_doc005', born('bbbbbbbb-0000', 'https://claude.ai/artifact/bbbbbbbb-0000')),
  ];
  const dir = path.join(tmp, 'projects', '-docs'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 's1.jsonl'), lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  try {
    const ev = JSON.parse((await get(port, '/api/session?proj=-docs&id=s1')).body).events, tools = ev.filter((e) => e.kind === 'tools').flatMap((e) => e.tools), items = ev.filter((e) => e.kind === 'results').flatMap((e) => e.items);
    assert.deepEqual(tools.filter((x) => x.d.kind === 'artifact').map((x) => x.id), ['toolu_doc001', 'toolu_open01', 'toolu_pub001', 'toolu_open02', 'toolu_open03', 'toolu_pub002', 'toolu_open05', 'toolu_open04', 'toolu_doc003', 'toolu_doc004']);   // a doc being born, not its edits; no other connector
    assert.deepEqual(tools.find((x) => x.id === 'toolu_doc001').d, { kind: 'artifact', file: '', title: 'Growth report', note: '', doc: 1 });
    assert.deepEqual(tools.find((x) => x.id === 'toolu_open01').d, { kind: 'artifact', file: '', title: '', note: '', open: 1 });
    assert.deepEqual(items.filter((it) => it.art).map((it) => [it.id, it.art]), [['toolu_doc001', { url: docUrl, title: '', typed: 1 }], ['toolu_pub001', { url: 'https://claude.ai/artifact/PagePagePage', title: 'Page' }], ['toolu_open03', { url: 'https://claude.ai/artifact/OlderOlder12', title: 'Made last week', typed: 1 }], ['toolu_pub002', { url: 'https://claude.ai/artifact/NoIdNoIdNoId', title: 'No id' }]]);   // a publish that answered without an id, then opened: still the publish, with its preview   // an open of what this session made, or opened before, adds nothing; a refused birth and an address that is not claude.ai's are not shown
  } finally { srv.close(); require('../server.js').shutdown(); }
});
test('the live call is in the session you last touched: the one you typed in, or the one you went to, until you type somewhere. What the agents write moves nothing', async () => {
  const dir = path.join(tmp, 'projects', '-follow'), f = (id) => path.join(dir, id + '.jsonl'), put = (id, ...recs) => fs.appendFileSync(f(id), recs.map(line).join('')), aged = (id, s) => { const t = (Date.now() - s * 1000) / 1000; fs.utimesSync(f(id), t, t); }; fs.mkdirSync(dir, { recursive: true });
  const { port, stop } = await serve(), cur = async (q = '') => { await wait(1300); return JSON.parse((await get(port, '/api/current?proj=-follow' + q)).body); }, from = (id) => '&sproj=-follow&sid=' + id, went = (id, since) => '&pproj=-follow&pid=' + id + (since == null ? '' : '&since=' + since);   // the list of sessions is worked out at most once every 1.2 s
  const bash = (s, id) => used(s, id, 'Bash', { command: 'npm test' }), T = (s) => Date.parse(at(s));
  try {
    put('a', typed(0, 'Build the page'), bash(1, 'toolu_a1')); assert.equal((await cur()).id, 'a');
    put('b', typed(10, 'Fix the test'), bash(11, 'toolu_b1')); assert.equal((await cur(from('a'))).id, 'b', 'a session is started: the call goes there');
    put('a', result(20, 'toolu_a1', 'ok'), bash(21, 'toolu_a2')); assert.equal((await cur(from('b'))).id, 'b', 'the other session writes: the call does not move');   // it went to the session written to last, and back
    assert.equal((await cur()).id, 'b', 'nor does a page that is just opened go to the one written to last');
    put('a', result(29, 'toolu_a2', 'ok'), typed(30, 'And the footer'), bash(31, 'toolu_a3')); assert.equal((await cur(from('b'))).id, 'a', 'an order in the other session: the call goes there');
    const there = await cur(went('b')); assert.deepEqual([there.id, there.pick, there.asked], ['b', 1, T(30)], 'a session you go to by hand: the call is kept there, and the answer says what the latest order was');
    put('a', result(35, 'toolu_a3', 'ok'), bash(36, 'toolu_a4')); assert.deepEqual([(await cur(went('b', there.asked))).id, (await cur(went('b', there.asked) + from('b'))).pick], ['b', 1], 'kept there while the agents write');
    put('a', result(39, 'toolu_a4', 'ok'), typed(40, 'One more thing'), bash(41, 'toolu_a5')); const back = await cur(went('b', there.asked) + from('b')); assert.deepEqual([back.id, back.pick, back.asked], ['a', undefined, T(40)], 'until you type somewhere');
    put('b', result(50, 'toolu_b1', 'ok'), typed(51, '<task-notification>\n<task-id>x</task-id>\n<status>completed</status>\n</task-notification>'), typed(52, 'What a skill says', { isMeta: true }), typed(53, 'This session is being continued', { isCompactSummary: true }), typed(54, '[Request interrupted by user]'), typed(55, '<system-reminder>\nKeep going.\n</system-reminder>'));
    assert.equal((await cur(from('a'))).id, 'a', 'what the harness writes as a user record is not an order: the result of a tool, a task that ended, a skill, a summary, Esc, a reminder');
    put('b', typed(60, '<command-message>review</command-message>\n<command-name>/review</command-name>'), bash(61, 'toolu_b2')); assert.equal((await cur(from('a'))).id, 'b', 'a slash command is one');
    put('a', { type: 'attachment', timestamp: at(70), attachment: { type: 'queued_command', prompt: [{ type: 'text', text: 'While you are at it' }], origin: { kind: 'human' }, commandMode: 'prompt' } }); assert.equal((await cur(from('b'))).id, 'a', 'and so is an order typed while the lead works');
    put('a', { type: 'attachment', timestamp: at(71), attachment: { type: 'queued_command', prompt: '<task-notification>x</task-notification>', origin: { kind: 'task' }, commandMode: 'task-notification' } }, result(79, 'toolu_a5', 'ok'), said(80, 'All done.', { stop: 'end_turn' }));
    await wait(1300); const rows = JSON.parse((await get(port, '/api/board')).body).filter((r) => r.proj === '-follow'); assert.deepEqual(rows.map((r) => [r.id, r.state, r.asked]).sort(), [['a', 'turn', T(70)], ['b', 'working', T(60)]]);
    assert.equal((await cur(from('a'))).id, 'a', 'its turn is over: the call does not leave at once');
    aged('a', 120); assert.equal((await cur(from('a'))).id, 'b', 'finished and quiet for a minute and a half while another session works: the call goes to that one');
    assert.equal((await cur(went('a', T(70)) + from('a'))).id, 'a', 'not when you went there by hand');
    put('b', result(90, 'toolu_b2', 'ok'), said(91, 'Reviewed.', { stop: 'end_turn' })); aged('b', 100); aged('a', 200);
    assert.deepEqual([(await cur(from('a'))).id, (await cur(from('b'))).id, (await cur()).id], ['a', 'b', 'b'], 'nobody is at work: the call stays where it is, and a page that is just opened goes to the session written to last');
    assert.equal((await cur(went('gone', 0) + from('a'))).id, 'a', 'a session that is gone keeps nothing');
    const far = path.join(tmp, 'projects', '-follow2'); fs.mkdirSync(far, { recursive: true });
    fs.writeFileSync(path.join(far, 's.jsonl'), [typed(5, 'Read the whole log'), bash(6, 'toolu_f1'), result(7, 'toolu_f1', 'x'.repeat(300 * 1024)), said(8, 'Still reading.')].map(line).join(''));   // the order is further back than the 192 KB the list reads
    await wait(1300); assert.equal(JSON.parse((await get(port, '/api/board')).body).find((r) => r.proj === '-follow2').asked, T(5), 'an order far back in a long turn is found on the first look');
  } finally { stop(); }
});
test('a sub-agent that hands its report back through SubagentHandback says that report, not the sentence it opened with', async () => {
  const dir = path.join(tmp, 'projects', '-hb'), sub = path.join(dir, 's', 'subagents', 'agent-a1.jsonl'); fs.mkdirSync(path.dirname(sub), { recursive: true });
  fs.writeFileSync(path.join(dir, 's.jsonl'), [typed(0, 'order'), used(1, 'toolu_ag', 'Agent', { prompt: 'Write the notes.', description: 'Writer', run_in_background: true }), result(2, 'toolu_ag', 'Async agent launched successfully.'),
    { type: 'queue-operation', operation: 'enqueue', timestamp: at(9), content: '<task-notification>\n<tool-use-id>toolu_ag</tool-use-id>\n<status>completed</status>\n</task-notification>' }].map(line).join(''));
  fs.writeFileSync(path.join(dir, 's', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Writer', toolUseId: 'toolu_ag' }));
  fs.writeFileSync(sub, [typed(3, 'Write the notes.'), said(4, 'I am reading the changelog.'), used(5, 'toolu_b', 'Bash', { command: 'ls' }), result(6, 'toolu_b', 'ok'),
    used(7, 'toolu_hb', 'SubagentHandback', { message: 'The notes are written: six changes.' }), result(8, 'toolu_hb', '{"success":true,"message":"Report delivered to your caller."}')].map(line).join(''));   // Claude Code 2.1.293 and later: no last sentence, the report is the message of the call
  const { port, stop } = await serve();
  try {
    const ev = (await load(port, 'proj=-hb&id=s')).events, of = (k) => ev.filter((e) => e.agent === 'a1' && e.kind === k);
    assert.deepEqual(of('report').map((e) => e.text), ['The notes are written: six changes.']);
    assert.deepEqual(of('say').map((e) => e.text), ['I am reading the changelog.'], 'the sentence it opened with stays an ordinary line');
    assert.ok(!/Handback|Report delivered/.test(JSON.stringify(ev.filter((e) => e.kind === 'tools' || e.kind === 'results'))), 'the call is not shown as a tool, nor its answer as an output');
  } finally { stop(); }
});

test('a pinned call (a click on its tab) is left for an order typed in another session only: what you type in it keeps it there', async () => {
  const dir = path.join(tmp, 'projects', '-pin'), put = (id, ...recs) => fs.appendFileSync(path.join(dir, id + '.jsonl'), recs.map(line).join('')), bash = (s, id) => used(s, id, 'Bash', { command: 'npm test' }); fs.mkdirSync(dir, { recursive: true });
  const { port, stop } = await serve(), cur = async (q) => { await wait(1300); return JSON.parse((await get(port, '/api/current?proj=-pin&sproj=-pin&sid=b&pproj=-pin&pid=b' + q)).body); };   // the call is in b, the session you went to
  try {
    put('a', typed(0, 'Build the page'), bash(1, 'toolu_a1')); put('b', typed(10, 'Fix the test'), bash(11, 'toolu_b1'));
    const since = (await cur('&pin=1')).asked; assert.equal(since, Date.parse(at(10)));
    put('b', result(20, 'toolu_b1', 'ok'), typed(21, 'And its name'), bash(22, 'toolu_b2'));
    assert.deepEqual([(await cur('&pin=1&since=' + since)).pick, (await cur('&since=' + since)).pick], [1, undefined], 'pinned, the call is kept while you type in it; a session you only went to is let go (and stays the call, being the last one typed in)');
    put('a', result(30, 'toolu_a1', 'ok'), typed(31, 'And the footer'), bash(32, 'toolu_a2')); const left = await cur('&pin=1&since=' + since); assert.deepEqual([left.id, left.pick], ['a', undefined], 'an order in another session lets the pin go, and the call goes there');
  } finally { stop(); }
});

test('sessions started in the temporary folder: the call that looks everywhere leaves them out unless there is nothing else; a window open on that folder follows them', async () => {
  const temp = '-private-var-folders-zz-ab12cd-T-neutral-dcRuea', mine = '-Users-me-test-workflow', s0 = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 1000);   // s0: now, in the seconds at() counts from
  for (const [p, s, text] of [[mine, s0 - 20, 'Review the diff'], [temp, s0 - 10, 'Say OK']]) { const d = path.join(tmp, 'projects', p); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 's.jsonl'), [typed(s, text), used(s + 1, 'toolu_t' + s, 'Bash', { command: 'ls' })].map(line).join('')); }   // both at work, and the latest order is in the temporary folder, as when a script runs claude -p there
  const { port, stop } = await serve(), cur = async (q) => { await wait(1300); return JSON.parse((await get(port, '/api/current?' + q)).body); };
  try {
    assert.equal((await cur('proj=')).proj, mine, 'looking everywhere: not the session in the temporary folder');
    const wide = await cur('proj=-no-such-folder'); assert.deepEqual([wide.proj, wide.wide], [mine, 1], 'nor when the folder of the window has no session');
    assert.equal((await cur('proj=' + temp)).proj, temp, 'a window open on that folder follows it');
    assert.equal((await cur('proj=&sproj=' + temp + '&sid=s')).proj, mine, 'a call that was in it is not kept there');
    const rows = JSON.parse((await get(port, '/api/board')).body); assert.deepEqual([mine, temp].map((p) => (rows.find((r) => r.proj === p) || {}).tmp), [undefined, 1], 'the list of sessions has both, the one in the temporary folder marked');
  } finally { stop(); }
});

test('a session of the folder the call follows stays in the list however many sessions are written elsewhere: in temporary folders, or in other projects', async () => {
  const mine = '-Users-xxxx-DEV-cap-workflow', s0 = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 1000), now = Date.now();
  const put = (proj, id, s, recs, ago) => { const d = path.join(tmp, 'projects', proj), file = path.join(d, id + '.jsonl'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(file, recs.map(line).join('')); fs.utimesSync(file, (now - ago) / 1000, (now - ago) / 1000); };
  put(mine, 'mine', s0 - 70, [typed(s0 - 70, 'Write the feature'), used(s0 - 69, 'toolu_cap', 'Bash', { command: 'npm test' })], 60000);   // at work, its order the latest; then 45 sessions in temporary folders and 50 in other projects are written after it
  for (let i = 0; i < 45; i++) put('-private-var-folders-zz-ab12cd-T-neutral-cap' + i, 's', s0 - 200, [typed(s0 - 200, 'Say OK'), said(s0 - 199, 'OK', { stop: 'end_turn' })], 30000 - i * 100);
  for (let i = 0; i < 50; i++) put('-Users-xxxx-DEV-other' + i, 's', s0 - 300, [typed(s0 - 300, 'Older work'), said(s0 - 299, 'Done.', { stop: 'end_turn' })], 20000 - i * 100);
  const { port, stop } = await serve();
  try {
    await wait(1300); const rows = JSON.parse((await get(port, '/api/board')).body);
    assert.ok(rows.some((r) => r.proj === mine), 'the session of the folder is in the list'); assert.ok(rows.filter((r) => r.tmp).length <= 10, 'sessions in temporary folders have a few places of their own');
    assert.equal(rows.filter((r) => /^-Users-xxxx-DEV-other/.test(r.proj)).length, 50, 'and every other project keeps its newest sessions');   // one each here
    assert.equal(JSON.parse((await get(port, '/api/current?proj=' + mine + '&sproj=-Users-xxxx-DEV-other0&sid=s')).body).id, 'mine', 'the call goes to it');
  } finally { stop(); }
});

test('the call is translated into the language the page asks for: French when it says nothing, Spanish and Brazilian Portuguese by name', { skip: process.platform === 'win32' }, async () => {
  const key = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;   // with a key the server would call the real API
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  const post = async (p, body) => JSON.parse((await get(port, p, {}, 'POST', JSON.stringify(body))).body), line = 'I fixed server.js.';
  try {
    assert.deepEqual(await post('/api/translate', { texts: [line], lang: 'es' }), { texts: ['Spanish|' + line], ok: true });
    assert.deepEqual(await post('/api/translate', { texts: [line], lang: 'pt' }), { texts: ['Brazilian Portuguese|' + line], ok: true }, 'the same line in another language is not taken from what was kept for Spanish, and the worker changes language');
    assert.deepEqual((await post('/api/translate', { texts: [line] })).texts, ['French|' + line], 'a page that names no language gets French, as before');
    assert.deepEqual((await post('/api/translate', { texts: [line], lang: 'de' })).texts, ['French|' + line], 'a language the call cannot be held in is not passed to the prompt');
    const many = ['One.', 'Two.', 'Three.', 'Four.', line]; assert.deepEqual(await post('/api/translate', { texts: many, lang: 'es' }), { texts: many.map((t) => 'Spanish|' + t), ok: true }, 'more than three lines go in one batch, in the same language');
    assert.deepEqual((await post('/api/quips', { texts: ['Report A.'], lang: 'pt' })).texts, ['Brazilian Portuguese|Report A.']); assert.deepEqual((await post('/api/quips', { texts: ['Report A.'], lang: 'ja' })).texts, ['English|Report A.']);
  } finally { srv.close(); require('../server.js').shutdown(); if (key) process.env.ANTHROPIC_API_KEY = key; }
});

test('pictures added from the page: under the name of their role, the one replaced moved aside, nothing but images', async () => {
  const dir = path.join(tmp, 'mine'); process.env.AGENT_STANDUP_CHARACTERS = dir;
  const { port, stop } = await serve(), post = async (p, b, h = {}) => { const r = await get(port, p, { 'content-type': 'application/json', ...h }, 'POST', JSON.stringify(b)); let j = {}; try { j = JSON.parse(r.body || '{}'); } catch {} return { status: r.status, ...j }; };
  const png = (tag) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]).toString('base64'), gif = Buffer.from('GIF89a-one').toString('base64');
  try {
    assert.deepEqual(await post('/api/characters/add', { role: 'you', name: 'me.png', data: png('first') }), { status: 200, file: 'you.png' });
    assert.deepEqual(await post('/api/characters/add', { role: 'you', name: 'me again.gif', data: gif }), { status: 200, file: 'you.gif' });   // a new picture of you: the old one, of another type, is put aside
    assert.ok(!fs.existsSync(path.join(dir, 'you.png'))); assert.equal(fs.readdirSync(path.join(dir, 'replaced')).filter((f) => f.endsWith(' you.png')).length, 1);
    assert.deepEqual(await post('/api/characters/add', { role: 'agent', name: '../../Ghost Writer!.png', data: png('g') }), { status: 200, file: 'Ghost Writer.png' });
    assert.deepEqual(await post('/api/characters/add', { role: 'agent', name: 'Ghost Writer.png', data: png('g2') }), { status: 200, file: 'Ghost Writer 2.png' });   // never over another sub-agent
    assert.deepEqual(await post('/api/characters/add', { role: 'agent', name: 'lead.png', data: png('l') }), { status: 200, file: 'lead 2.png' });   // a sub-agent never takes the name of a role
    assert.equal((await post('/api/characters/add', { role: 'agent', name: 'x.png', data: Buffer.from('<svg onload=alert(1)>').toString('base64') })).error, 'type');
    assert.equal((await post('/api/characters/add', { role: 'agent', name: 'big.png', data: png('x'.repeat(310 * 1024)) })).error, 'size');
    assert.equal((await post('/api/characters/add', { role: 'you', data: png('x') }, { 'sec-fetch-site': 'cross-site' })).status, 403);
    const roles = JSON.parse((await get(port, '/api/characters')).body).chars.map((c) => c.stem + ':' + c.role).sort();
    assert.deepEqual(roles, ['Ghost Writer 2:agent', 'Ghost Writer:agent', 'lead 2:agent', 'you:you']);
    assert.deepEqual(await post('/api/characters/remove', { file: 'Ghost Writer.png' }), { status: 200, ok: true }); assert.ok(!fs.existsSync(path.join(dir, 'Ghost Writer.png')));
    assert.equal((await post('/api/characters/remove', { file: '../server.js' })).error, 'file'); assert.equal((await post('/api/characters/remove', { file: 'replaced' })).error, 'file');
    assert.equal(fs.readdirSync(path.join(dir, 'replaced')).length, 2);   // nothing deleted: you.png and Ghost Writer.png wait there
    fs.writeFileSync(path.join(dir, 'help-desk.png'), Buffer.from(png('h'), 'base64'));   // a picture of one's own whose name looks like a layer, with no character of that name: still a character, as in 1.32
    assert.ok(JSON.parse((await get(port, '/api/characters')).body).chars.some((c) => c.stem === 'help-desk'));
    assert.equal((await post('/api/characters/add', { role: 'you-talk', name: 'open.png', data: png('o') })).file, 'you-talk.png');
    assert.equal((await post('/api/characters/add', { role: 'you', name: 'new face.png', data: png('n') })).file, 'you.png');   // a new face: the old open mouth goes aside with the old picture
    assert.ok(!fs.existsSync(path.join(dir, 'you-talk.png'))); assert.equal(JSON.parse((await get(port, '/api/characters')).body).chars.find((c) => c.role === 'you').talk, null);
  } finally { stop(); delete process.env.AGENT_STANDUP_CHARACTERS; }
});
test('every session filed under a project shares its lead name key: one that started in a scratch folder, an old one without cwd, and a folder written with a trailing slash', async () => {
  const real = path.join(tmp, 'work', 'app'), scratch = path.join(tmp, 'scratch', 'x'), key = (d) => d.replace(/[^a-zA-Z0-9]/g, '-');
  const rec = (cwd, i) => [{ type: 'user', timestamp: `2026-01-01T00:0${i}:00Z`, ...(cwd ? { cwd } : {}), message: { role: 'user', content: 'hello' } }, { type: 'assistant', timestamp: `2026-01-01T00:0${i}:01Z`, ...(cwd ? { cwd: real } : {}), message: { content: [{ type: 'text', text: 'hi' }] } }];
  const write = (proj, id, lines) => { const dir = path.join(tmp, 'projects', proj); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, id + '.jsonl'), lines.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
  write(key(real), 'scratch', rec(scratch, 3)); write(key(real), 'old', rec('', 2)); write(key(real), 'plain', rec(real, 1));
  const slash = path.join(tmp, 'work', 'other'); write(key(slash), 's', [{ type: 'user', timestamp: '2026-01-01T00:00:00Z', cwd: slash + path.sep, message: { role: 'user', content: 'hello' } }]);
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port, project = async (proj, id) => JSON.parse((await get(port, `/api/session?proj=${proj}&id=${id}`)).body).project;
  try {
    for (const id of ['scratch', 'old', 'plain']) assert.equal((await project(key(real), id)).key, 'cwd:' + real, id);
    assert.equal((await project(key(real), 'scratch')).label, real, 'the folder shown under the name is the project, not the scratch folder');
    assert.equal((await project(key(slash), 's')).key, 'cwd:' + slash);
  } finally { srv.close(); require('../server.js').shutdown(); }
});
