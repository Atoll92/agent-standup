// test/reply.test.js: the human's line, typed into the tmux pane of a session, with a stand-in tmux and a stand-in sessions folder
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-reply-')), SESS = path.join(tmp, 'sessions'), LOG = path.join(tmp, 'tmux.log'), TMUX = path.join(tmp, 'tmux');
fs.mkdirSync(SESS);
fs.writeFileSync(TMUX, `#!/usr/bin/env node
const a = process.argv.slice(2); require('fs').appendFileSync(process.env.FAKE_TMUX_LOG, JSON.stringify(a) + '\\n');
if (process.env.FAKE_TMUX_FAIL) process.exit(1);
if (a[0] === 'list-panes') console.log('%7 ' + process.env.FAKE_PANE_PID);
`, { mode: 0o755 });
Object.assign(process.env, { AGENT_STANDUP_TMUX: TMUX, AGENT_STANDUP_CC_SESSIONS: SESS, FAKE_TMUX_LOG: LOG, FAKE_PANE_PID: String(process.pid) });
const reply = require('../reply.js');
const ID = '11111111-2222-3333-4444-555555555555';
const calls = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
// A stand-in for claude: a child of this test process, so its parent chain reaches the fake pane pid
const claude = spawn('sleep', ['60']); test.after(() => claude.kill());
const procStart = (pid) => { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2).split(' ')[19]; };   // field 22
fs.writeFileSync(path.join(SESS, claude.pid + '.json'), JSON.stringify({ pid: claude.pid, procStart: procStart(claude.pid), sessionId: ID, status: 'busy', name: 'agents-19' }));

test('send refuses while the session waits on a permission menu', async () => {
  const f = path.join(SESS, claude.pid + '.json'), orig = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(orig), status: 'waiting' })); fs.rmSync(LOG, { force: true });
  try { assert.deepEqual(await reply.send(ID, 'hi'), { error: 'waiting' }); assert.equal(calls().filter((a) => a[0] === 'send-keys').length, 0); } finally { fs.writeFileSync(f, orig); }
});

test('clean flattens control characters and trims', () => {
  assert.equal(reply.clean('  a\nb\r\tc\u001b[2J  '), 'a b c [2J');
  assert.equal(reply.clean(42), '');
});

test('lookup finds the pane through the parent chain', async () => {
  assert.deepEqual(await reply.lookup(ID), { ok: true, pane: '%7', status: 'busy', name: 'agents-19' });
  assert.deepEqual(await reply.lookup('not-an-id'), { ok: false, why: 'none' });
  assert.deepEqual(await reply.lookup('99999999-2222-3333-4444-555555555555'), { ok: false, why: 'none' });
  const OLD = '22222222-2222-3333-4444-555555555555';   // a pid reused by another process: procStart differs
  fs.writeFileSync(path.join(SESS, process.pid + '.json'), JSON.stringify({ pid: process.pid, procStart: '1', sessionId: OLD }));
  try { assert.deepEqual(await reply.lookup(OLD), { ok: false, why: 'none' }); } finally { fs.rmSync(path.join(SESS, process.pid + '.json')); }
  process.env.FAKE_PANE_PID = '999999999';
  try { assert.equal((await reply.lookup(ID)).why, 'notmux'); } finally { process.env.FAKE_PANE_PID = String(process.pid); }
  process.env.FAKE_TMUX_FAIL = '1';
  try { assert.equal((await reply.lookup(ID)).why, 'tmux'); } finally { delete process.env.FAKE_TMUX_FAIL; }
});

test('send types the text literally, then Enter on its own', async () => {
  fs.rmSync(LOG, { force: true });
  assert.deepEqual(await reply.send(ID, '-rf\nhello'), { ok: true });
  const c = calls().filter((a) => a[0] === 'send-keys');
  assert.deepEqual(c, [['send-keys', '-t', '%7', '-l', '--', '-rf hello'], ['send-keys', '-t', '%7', 'Enter']]);
  fs.rmSync(LOG, { force: true }); await reply.send(ID, 'fix this;');   // tmux drops a final ; of an argument
  assert.deepEqual(calls().filter((a) => a[0] === 'send-keys')[0], ['send-keys', '-t', '%7', '-l', '--', 'fix this; ']);
  assert.deepEqual(await reply.send(ID, '   '), { error: 'text' });
  assert.deepEqual(await reply.send(ID, 'x'.repeat(4001)), { error: 'text' });
  assert.deepEqual(await reply.send(ID, { a: 1 }), { error: 'text' });
});

test('on reads AGENT_STANDUP_REPLY', () => {
  delete process.env.AGENT_STANDUP_REPLY; assert.equal(reply.on(), false);
  process.env.AGENT_STANDUP_REPLY = 'on'; assert.equal(reply.on(), true);
  delete process.env.AGENT_STANDUP_REPLY;
});

const http = require('http');
const get = (port, p, headers = {}, method = 'GET', body) => new Promise((res, rej) => { const r = http.request({ port, path: p, method, headers }, (x) => { let b = ''; x.on('data', (d) => (b += d)); x.on('end', () => res({ status: x.statusCode, body: b })); }); r.on('error', rej); if (body) r.write(body); r.end(); });
test('/api/reply: off by default, token and cross-site guards, answers', async () => {
  process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_PROJECTS = path.join(tmp, 'projects');
  const server = require('../server.js'), srv = server.start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  const post = (o, h = {}) => get(port, '/api/reply', { 'content-type': 'application/json', ...h }, 'POST', JSON.stringify(o));
  try {
    delete process.env.AGENT_STANDUP_REPLY;
    assert.equal((await get(port, '/api/reply?id=' + ID)).status, 404);
    assert.doesNotMatch((await get(port, '/api/prefs.js')).body, /REPLY_TOKEN/);
    process.env.AGENT_STANDUP_REPLY = 'on';
    const token = /REPLY_TOKEN = "([0-9a-f]{48})"/.exec((await get(port, '/api/prefs.js')).body)[1];
    assert.deepEqual(JSON.parse((await get(port, '/api/reply?id=' + ID)).body), { ok: true, status: 'busy', name: 'agents-19' });
    assert.equal((await post({ id: ID, text: 'hi' })).status, 403);
    assert.equal((await post({ id: ID, text: 'hi', token: 'x'.repeat(48) })).status, 403);
    assert.equal((await post({ id: ID, text: 'hi', token }, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await get(port, '/api/reply?id=' + ID, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post({ id: ID, text: '', token })).status, 400);
    assert.equal((await post({ id: '99999999-2222-3333-4444-555555555555', text: 'hi', token })).status, 409);
    assert.equal((await post({ id: ID, text: 'hi', token: 'é'.repeat(48) })).status, 403);   // 48 characters, 96 bytes: must not crash the server
    assert.equal((await get(port, '/api/reply?id=' + ID)).status, 200);
    const sf = path.join(SESS, claude.pid + '.json'), orig = fs.readFileSync(sf, 'utf8'); fs.writeFileSync(sf, JSON.stringify({ ...JSON.parse(orig), status: 'waiting' }));
    try { const w = await post({ id: ID, text: 'hi', token }); assert.equal(w.status, 409); assert.deepEqual(JSON.parse(w.body), { error: 'waiting' }); } finally { fs.writeFileSync(sf, orig); }
    fs.rmSync(LOG, { force: true });
    const ok = await post({ id: ID, text: 'hi', token }); assert.equal(ok.status, 200); assert.deepEqual(JSON.parse(ok.body), { ok: true });
    assert.deepEqual(calls().filter((a) => a[0] === 'send-keys').map((a) => a.at(-1)), ['hi', 'Enter']);
  } finally { delete process.env.AGENT_STANDUP_REPLY; srv.close(); server.shutdown(); }
});
