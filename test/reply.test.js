// test/reply.test.js: the human's line, typed into the tmux pane of a session, with a stand-in tmux and a stand-in sessions folder
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-reply-')), SESS = path.join(tmp, 'sessions'), LOG = path.join(tmp, 'tmux.log'), TMUX = path.join(tmp, 'tmux');
fs.mkdirSync(SESS);
fs.writeFileSync(TMUX, `#!/usr/bin/env node
const a = process.argv.slice(2); require('fs').appendFileSync(process.env.FAKE_TMUX_LOG, JSON.stringify(a) + '\\n');
if (process.env.FAKE_TMUX_FAIL) process.exit(1);
if (a[0] === 'list-panes') console.log('%7 ' + process.env.FAKE_PANE_PID);
const flip = process.env.FAKE_FLIP_FILE; if (flip && a[0] === 'send-keys' && a.includes('-l')) { const fs = require('fs'); fs.writeFileSync(flip, JSON.stringify({ ...JSON.parse(fs.readFileSync(flip, 'utf8')), status: 'busy' })); }   // the session starts working between the text and Enter
`, { mode: 0o755 });
Object.assign(process.env, { AGENT_STANDUP_TMUX: TMUX, AGENT_STANDUP_CC_SESSIONS: SESS, FAKE_TMUX_LOG: LOG, FAKE_PANE_PID: String(process.pid) });
const reply = require('../reply.js');
const ID = '11111111-2222-3333-4444-555555555555';
const calls = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const linux = { skip: process.platform !== 'linux' && 'needs /proc (Linux)' };
// A stand-in for claude: a child of this test process, so its parent chain reaches the fake pane pid. Only on Linux: its start time is read from /proc
const claude = linux.skip ? null : spawn('sleep', ['60']); test.after(() => claude && claude.kill());
const SF = claude && path.join(SESS, claude.pid + '.json'), withStatus = async (status, fn) => { const orig = fs.readFileSync(SF, 'utf8'); fs.writeFileSync(SF, JSON.stringify({ ...JSON.parse(orig), status })); try { await fn(); } finally { fs.writeFileSync(SF, orig); } };
if (claude) { const st = fs.readFileSync(`/proc/${claude.pid}/stat`, 'utf8'); fs.writeFileSync(SF, JSON.stringify({ pid: claude.pid, procStart: st.slice(st.lastIndexOf(')') + 2).split(' ')[19], sessionId: ID, status: 'idle', name: 'agents-19' })); }   // field 22: the start time

test('send refuses unless the session is idle, with no keys typed', linux, async () => {
  for (const [status, error] of [['waiting', 'waiting'], ['busy', 'busy'], ['shell', 'busy'], ['', 'busy']]) await withStatus(status, async () => {
    fs.rmSync(LOG, { force: true }); assert.deepEqual(await reply.send(ID, 'hi'), { error }); assert.equal(calls().filter((a) => a[0] === 'send-keys').length, 0);
  });
});

test('send types the text but not Enter when the session starts working meanwhile', linux, async () => {
  const orig = fs.readFileSync(SF, 'utf8'); fs.rmSync(LOG, { force: true }); process.env.FAKE_FLIP_FILE = SF;
  try { assert.deepEqual(await reply.send(ID, '1 yes'), { error: 'changed' }); assert.deepEqual(calls().filter((a) => a[0] === 'send-keys'), [['send-keys', '-t', '%7', '-l', '--', '1 yes']]); } finally { delete process.env.FAKE_FLIP_FILE; fs.writeFileSync(SF, orig); }
});

test('uidIn finds the owner of the client end of a loopback connection', () => {
  const T = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   9: 0100007F:D431 0100007F:128B 06 00000000:00000000 03:00000000 00000000     0        0 0 3 0000000000000000
   0: 0100007F:128B 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 1 0000000000000000 100 0 0 10 0
   1: 0100007F:128B 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 2 1 0000000000000000 20 4 30 10 -1
   2: 0100007F:D431 0100007F:128B 01 00000000:00000000 00:00000000 00000000  1001        0 3 1 0000000000000000 20 4 30 10 -1`;
  assert.equal(reply.tcpKey('127.0.0.1', 54321), '0100007F:D431');
  assert.equal(reply.tcpKey('127.0.0.1', 4747, true), '0000000000000000FFFF00000100007F:128B');   // v4-mapped, as /proc/net/tcp6 writes it
  assert.equal(reply.uidIn(T, '0100007F:D431', '0100007F:128B'), 1001);   // the client row, not the server row of the same connection nor the TIME_WAIT row (uid 0) of an older one
  assert.equal(reply.uidIn(T, '0100007F:D432', '0100007F:128B'), null);
  assert.equal(reply.peerUid({ remoteAddress: undefined }), null);
});

test('clean flattens control characters and trims', () => {
  assert.equal(reply.clean('  a\nb\r\tc\u001b[2J  '), 'a b c [2J');
  assert.equal(reply.clean(42), '');
});

test('lookup finds the pane through the parent chain', linux, async () => {
  assert.deepEqual(await reply.lookup(ID), { ok: true, pane: '%7', status: 'idle', name: 'agents-19' });
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

test('send types the text literally, then Enter on its own', linux, async () => {
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
test('/api/reply: off by default, token, cross-site and peer guards, answers', linux, async () => {
  process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_PROJECTS = path.join(tmp, 'projects');
  const server = require('../server.js'), srv = server.start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  const post = (o, h = {}) => get(port, '/api/reply', { 'content-type': 'application/json', ...h }, 'POST', JSON.stringify(o));
  try {
    delete process.env.AGENT_STANDUP_REPLY;
    assert.equal((await get(port, '/api/reply?id=' + ID)).status, 404);
    assert.doesNotMatch((await get(port, '/api/prefs.js')).body, /REPLY_TOKEN/);
    process.env.AGENT_STANDUP_REPLY = 'on';
    const token = /REPLY_TOKEN = "([0-9a-f]{48})"/.exec((await get(port, '/api/prefs.js')).body)[1];
    assert.deepEqual(JSON.parse((await get(port, '/api/reply?id=' + ID)).body), { ok: true, status: 'idle', name: 'agents-19' });   // this test process runs as the same user: the peer check passes
    const real = reply.peerUid; reply.peerUid = () => process.getuid() + 1;   // another user's process
    try { for (const r of [await get(port, '/api/reply?id=' + ID), await post({ id: ID, text: 'hi', token })]) { assert.equal(r.status, 403); assert.deepEqual(JSON.parse(r.body), { error: 'peer' }); } } finally { reply.peerUid = real; }
    reply.peerUid = () => null;   // owner not found: refused too
    try { assert.equal((await get(port, '/api/reply?id=' + ID)).status, 403); } finally { reply.peerUid = real; }
    assert.equal((await post({ id: ID, text: 'hi' })).status, 403);
    assert.equal((await post({ id: ID, text: 'hi', token: 'x'.repeat(48) })).status, 403);
    assert.equal((await post({ id: ID, text: 'hi', token }, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await get(port, '/api/reply?id=' + ID, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post({ id: ID, text: '', token })).status, 400);
    assert.equal((await post({ id: '99999999-2222-3333-4444-555555555555', text: 'hi', token })).status, 409);
    assert.equal((await post({ id: ID, text: 'hi', token: 'é'.repeat(48) })).status, 403);   // 48 characters, 96 bytes: must not crash the server
    assert.equal((await get(port, '/api/reply?id=' + ID)).status, 200);
    await withStatus('waiting', async () => { const w = await post({ id: ID, text: 'hi', token }); assert.equal(w.status, 409); assert.deepEqual(JSON.parse(w.body), { error: 'waiting' }); });
    await withStatus('busy', async () => { const w = await post({ id: ID, text: 'hi', token }); assert.equal(w.status, 409); assert.deepEqual(JSON.parse(w.body), { error: 'busy' }); });
    fs.rmSync(LOG, { force: true });
    const ok = await post({ id: ID, text: 'hi', token }); assert.equal(ok.status, 200); assert.deepEqual(JSON.parse(ok.body), { ok: true });
    assert.deepEqual(calls().filter((a) => a[0] === 'send-keys').map((a) => a.at(-1)), ['hi', 'Enter']);
  } finally { delete process.env.AGENT_STANDUP_REPLY; srv.close(); server.shutdown(); }
});
