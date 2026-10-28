// test/waiting.test.js: a session that waits on you, read from its transcript and from the status Claude Code keeps in <config>/sessions/<pid>.json. A Bash approval shows only there;
// since when it has waited, apart from how long it worked before; a status file whose process has ended says nothing.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-waiting-')), PROJECTS = path.join(tmp, 'projects'), SESSIONS = path.join(tmp, 'sessions');
Object.assign(process.env, { AGENT_STANDUP_ANSWER: 'dry', AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_KOKORO_DIR: path.join(tmp, 'kokoro'), AGENT_STANDUP_PROJECTS: PROJECTS, AGENT_STANDUP_CC_SESSIONS: SESSIONS });
fs.mkdirSync(SESSIONS, { recursive: true });

const now = Date.now(), iso = (ago) => new Date(now - ago).toISOString(), id = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const user = (text, ago) => ({ type: 'user', timestamp: iso(ago), message: { role: 'user', content: text } }), say = (text, ago) => ({ type: 'assistant', timestamp: iso(ago), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const call = (name, input, ago) => ({ type: 'assistant', timestamp: iso(ago), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_' + name + ago, name, input }] } });
const file = (n) => path.join(PROJECTS, '-work-shop', id(n) + '.jsonl'), put = (n, recs, ago) => { fs.mkdirSync(path.dirname(file(n)), { recursive: true }); fs.writeFileSync(file(n), recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); const t = new Date(now - ago); fs.utimesSync(file(n), t, t); };
const status = (k, n, pid, st, ago) => fs.writeFileSync(path.join(SESSIONS, k + '.json'), JSON.stringify({ pid, sessionId: id(n), status: st, statusUpdatedAt: now - ago, updatedAt: now - ago }));
const gone = spawnSync(process.execPath, ['-e', '0']).pid;   // a process that has ended: its file is left behind, as after a crash

const MENU = 1, STALE = 2, BUSY = 3, LONG = 4, TURN = 5, GUESS = 6, ASK = 7, PLAN = 8, OTHER = 9, DIALOG = 0;
const PLANS = path.join(tmp, '.claude', 'plans'), PF = path.join(PLANS, 'tidy-plan.md'); fs.mkdirSync(PLANS, { recursive: true }); fs.writeFileSync(PF, '# Plan\n1. Check\n2. Write hello.txt\n');
put(MENU, [user('Build it', 300e3), call('Bash', { command: 'npm run build\n  --prod', description: 'Build for production' }, 40e3)], 40e3); status(101, MENU, process.pid, 'waiting', 35e3);
put(STALE, [user('Migrate', 90e3), call('Bash', { command: 'npm run migrate' }, 20e3)], 20e3); status(102, STALE, gone, 'waiting', 20e3);
put(BUSY, [user('Test', 90e3), call('Bash', { command: 'npm test' }, 20e3)], 20e3); status(103, BUSY, process.pid, 'busy', 20e3);
put(LONG, [user('Deploy', 3000e3), call('Bash', { command: './deploy.sh' }, 2700e3)], 2700e3); status(104, LONG, process.pid, 'waiting', 2690e3);
put(TURN, [user('Release notes', 900e3), say('Here are the notes.', 600e3)], 600e3);
put(ASK, [user('Plan the menu', 60e3), call('AskUserQuestion', { questions: [{ question: 'Which fruits?', header: 'Fruit', multiSelect: true, options: [{ label: 'Apple', description: 'Crisp' }, { label: 'Banana', description: '' }] }, { question: 'Which drink?', options: [{ label: 'Tea' }, { label: 'Coffee' }] }] }, 30e3)], 30e3); status(107, ASK, process.pid, 'waiting', 28e3);
const done = (name, ago) => ({ type: 'user', timestamp: iso(ago), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_' + name + ago, content: 'ok' }] } });
put(PLAN, [user('Plan it', 90e3), call('Write', { file_path: PF, content: 'old' }, 60e3), done('Write', 60e3)], 50e3); status(108, PLAN, process.pid, 'waiting', 45e3);   // the plan menu is open, its call not written yet
put(OTHER, [user('Go on', 90e3), say('Ok.', 80e3)], 80e3); status(109, OTHER, process.pid, 'waiting', 30e3);   // a menu the transcript does not record
put(GUESS, [user('Fix the header', 100e3), call('Edit', { file_path: '/work/shop/src/header.js', old_string: 'a', new_string: 'b' }, 20e3)], 20e3);
put(DIALOG, [user('Thanks', 90e3), say('Done.', 80e3)], 80e3); fs.writeFileSync(path.join(SESSIONS, '110.json'), JSON.stringify({ pid: process.pid, sessionId: id(DIALOG), status: 'waiting', waitingFor: 'dialog open', statusUpdatedAt: now - 20e3 }));   // /model, /config… opened by you in a session whose turn is over

const OLD = path.join(PROJECTS, '-work-old'), oid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`, oput = (sid, recs, ago) => { fs.mkdirSync(OLD, { recursive: true }); const f = path.join(OLD, sid + '.jsonl'); fs.writeFileSync(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); const t = new Date(now - ago); fs.utimesSync(f, t, t); };
oput(oid('a'), [user('Deploy', 10800e3), call('Bash', { command: './deploy.sh' }, 7200e3)], 7200e3); fs.writeFileSync(path.join(SESSIONS, '111.json'), JSON.stringify({ pid: process.pid, sessionId: oid('a'), status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: now - 7195e3 }));   // a menu left open two hours ago
oput(oid('b'), [user('Release notes', 360e3), say('Here they are.', 240e3)], 240e3);   // the session you were in, done four minutes ago

const folder = (key, cwd, c, ago) => { const d = path.join(PROJECTS, key); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, oid(c) + '.jsonl'); fs.writeFileSync(f, [{ ...user('Hello', ago + 60e3), cwd }, { ...say('Done.', ago), cwd }].map((r) => JSON.stringify(r)).join('\n') + '\n'); const t = new Date(now - ago); fs.utimesSync(f, t, t); };
folder('-work-app', '/work/app', 'c', 900e3); folder('-work-app-sub', '/work/app/sub', 'd', 600e3); folder('-work-app-old', '/work/app-old', 'e', 300e3);   // the folder, one inside it, and the newest beside it

const two = { type: 'assistant', timestamp: iso(30e3), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: 'npm test' } }, { type: 'tool_use', id: 'toolu_t2', name: 'Bash', input: { command: 'npm run lint' } }] } };
fs.mkdirSync(path.join(PROJECTS, '-work-two'), { recursive: true }); fs.writeFileSync(path.join(PROJECTS, '-work-two', oid('f') + '.jsonl'), JSON.stringify(user('Check it', 60e3)) + '\n' + JSON.stringify(two) + '\n'); fs.writeFileSync(path.join(SESSIONS, '112.json'), JSON.stringify({ pid: process.pid, sessionId: oid('f'), status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: now - 25e3 }));   // two commands in one message: the menu asks about the first

const sput = (sid, recs, ago) => { const f = path.join(PROJECTS, '-work-shop', sid + '.jsonl'); fs.writeFileSync(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); const t = new Date(now - ago); fs.utimesSync(f, t, t); };
const ORPHAN = '0a0a0a0a-0a0a-40a0-80a0-0a0a0a0a0a0a', SLOW = '0b0b0b0b-0b0b-40b0-80b0-0b0b0b0b0b0b';
sput(ORPHAN, [user('Note the launch date', 200e3), call('Edit', { file_path: '/work/memory/launch.md', old_string: 'a', new_string: 'b' }, 120e3), user('Would we launch any earlier?', 100e3), say('I would keep the 29th.', 90e3), { type: 'cost-state' }, { type: 'mode' }], 5e3);   // an edit you passed over by typing: it never got its answer; records without a date moved the file since
sput(SLOW, [user('Fix the header', 90e3), call('Edit', { file_path: '/work/shop/src/header.js', old_string: 'a', new_string: 'b' }, 60e3)], 60e3); fs.writeFileSync(path.join(SESSIONS, '113.json'), JSON.stringify({ pid: process.pid, sessionId: SLOW, status: 'busy', statusUpdatedAt: now - 60e3 }));   // Claude Code says it works: no menu is open

const PROG = '0c0c0c0c-0c0c-40c0-80c0-0c0c0c0c0c0c'; sput(PROG, [user('Ask me red or blue', 60e3), call('AskUserQuestion', { questions: [{ question: 'Red or blue?', options: [{ label: 'Red' }, { label: 'Blue' }] }] }, 30e3)], 30e3); fs.writeFileSync(path.join(SESSIONS, '114.json'), JSON.stringify({ pid: process.pid, sessionId: PROG, status: 'waiting', waitingFor: 'input needed', entrypoint: 'sdk-cli', statusUpdatedAt: now - 28e3 }));   // a session a program runs (claude -p, the Agent SDK): its question goes to that program

const NOSTAT = '0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f'; sput(NOSTAT, [user('Plan the menu', 60e3), call('AskUserQuestion', { questions: [{ question: 'Tea or coffee?', options: [{ label: 'Tea' }, { label: 'Coffee' }] }] }, 20e3)], 20e3);   // Cowork, or Claude Code before 2.1.269: no status file

const tag = (recs, version, entrypoint) => recs.map((r) => ({ ...r, version, entrypoint })), CLOSED = '0b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b', COWORKQ = '0c1c1c1c-1c1c-41c1-81c1-1c1c1c1c1c1c';
sput(CLOSED, [...tag([user('Tea or coffee', 60e3), call('AskUserQuestion', { questions: [{ question: 'Tea or coffee?' }] }, 50e3)], '2.1.301', 'cli'), { type: 'last-prompt' }, { type: 'cost-state' }], 120e3);   // a terminal session killed with its question open: that Claude Code writes a status, and there is none
const DESKQ = '0d1d1d1d-1d1d-41d1-81d1-1d1d1d1d1d1d'; sput(DESKQ, tag([user('Plan it', 60e3), call('AskUserQuestion', { questions: [{ question: 'Now or later?' }] }, 20e3)], '2.1.247', 'claude-desktop'), 20e3);   // the desktop app's Code tab before 2.1.269 wrote no usable status
sput(COWORKQ, tag([user('Plan the menu', 60e3), call('AskUserQuestion', { questions: [{ question: 'Soup or salad?' }] }, 20e3)], '2.1.280', 'local-agent'), 20e3);   // Cowork: its status is kept elsewhere

test('with no status from Claude Code, a question open in the transcript still needs you; a pending edit stays a guess', () => {
  const core = require('../server.js'), rows = core.boardRows(), r = rows.find((x) => x.id === NOSTAT);
  assert.equal(rows.find((x) => x.id === CLOSED).state, 'working'); assert.equal(rows.find((x) => x.id === CLOSED).maybe, 1, 'a session closed with its question open: a guess on its tile, not a call for you');
  assert.equal(rows.find((x) => x.id === DESKQ).state, 'blocked', 'an older desktop app: its question needs you'); assert.equal(rows.find((x) => x.id === COWORKQ).state, 'blocked'); assert.equal(rows.find((x) => x.id === COWORKQ).sure, 1);
  assert.equal(r.state, 'blocked'); assert.equal(r.sure, 1); assert.equal(r.ask, 'Tea or coffee?'); assert.equal(r.menu.sure, 1); assert.equal(r.known, undefined);
  assert.equal(rows.find((x) => x.id === id(GUESS)).state, 'working');
  core.shutdown();
});

const HOST = '0a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a'; sput(HOST, [user('Ask me red or blue', 60e3), call('AskUserQuestion', { questions: [{ question: 'Red or blue?', options: [{ label: 'Red' }, { label: 'Blue' }] }] }, 30e3)], 30e3); fs.writeFileSync(path.join(SESSIONS, '115.json'), JSON.stringify({ pid: process.pid, sessionId: HOST, status: 'waiting', waitingFor: 'input needed', entrypoint: 'sdk-ts', statusUpdatedAt: now - 28e3 }));   // an Agent SDK host (Zed…) that shows its menus to a person

test('a question in a session started with claude -p is not for you: it never needs you; one in an Agent SDK host that shows it to a person still does', () => {
  const core = require('../server.js'), r = core.boardRows().find((x) => x.id === PROG);
  assert.equal(core.boardRows().find((x) => x.id === HOST).state, 'blocked');
  assert.equal(r.state, 'working'); assert.equal(r.sure, undefined); assert.equal(r.maybe, undefined); assert.equal(r.menu, undefined); assert.equal(r.known, 1);
  core.shutdown();
});

test('no "needs you" by mistake: a call left without its answer is given up at your next message, and a session Claude Code says is at work is believed', () => {
  const core = require('../server.js'), rows = core.boardRows(), row = (sid) => rows.find((r) => r.id === sid);
  assert.equal(row(ORPHAN).state, 'turn'); assert.equal(row(ORPHAN).maybe, undefined); assert.equal(row(ORPHAN).ask, undefined);
  assert.equal(row(SLOW).state, 'working'); assert.equal(row(SLOW).maybe, undefined); assert.equal(row(SLOW).menu, undefined); assert.equal(row(SLOW).known, 1);
  core.shutdown();
});

test('a Bash approval needs you, with the command, since the menu opened, apart from the time it worked', () => {
  const core = require('../server.js'), rows = core.boardRows(), row = (n) => rows.find((r) => r.id === id(n));
  assert.equal(row(MENU).state, 'blocked'); assert.equal(row(MENU).tool, 'Bash'); assert.equal(row(MENU).ask, 'Bash(npm run build --prod)');   // on one line, the way Claude Code shows it
  assert.equal(row(MENU).since, now - 35e3); assert.equal(row(MENU).ran, 265e3);   // from the order to the menu
  assert.equal(row(LONG).state, 'blocked'); assert.equal(row(LONG).since, now - 2690e3);   // a menu left open for 45 minutes still waits: it is not "idle"
  assert.equal(row(STALE).state, 'working'); assert.equal(row(STALE).ask, undefined);   // the process is gone: its file says nothing
  assert.equal(row(BUSY).state, 'working'); assert.equal(row(BUSY).since, undefined);   // a command that runs is not a question
  assert.equal(row(TURN).state, 'turn'); assert.equal(row(TURN).since, now - 600e3); assert.equal(row(TURN).ran, 300e3);
  assert.equal(row(GUESS).state, 'working'); assert.equal(row(GUESS).maybe, 1); assert.equal(row(GUESS).ask, 'Edit(header.js)'); assert.equal(row(GUESS).since, now - 20e3);   // no status file: only a guess from a file edit left pending, never "needs you"
  assert.equal(row(BUSY).maybe, undefined); assert.equal(row(BUSY).known, 1);
  core.shutdown();
});

test('a session that waits on a menu says what the menu shows, word for word: the questions with their options in order, the command, the file', () => {
  const core = require('../server.js'), rows = core.boardRows(), row = (n) => rows.find((r) => r.id === id(n));
  assert.deepEqual(row(MENU).menu, { id: 'toolu_Bash40000', tool: 'Bash', kind: 'command', cmd: 'npm run build\n  --prod', about: 'Build for production', sure: 1 });   // the command as written, its lines kept
  assert.deepEqual(row(ASK).menu, { id: 'toolu_AskUserQuestion30000', tool: 'AskUserQuestion', kind: 'question', sure: 1, questions: [{ q: 'Which fruits?', head: 'Fruit', multi: true, options: [{ label: 'Apple', about: 'Crisp' }, { label: 'Banana', about: '' }] }, { q: 'Which drink?', head: '', multi: false, options: [{ label: 'Tea', about: '' }, { label: 'Coffee', about: '' }] }] });
  assert.deepEqual(row(GUESS).menu, { id: 'toolu_Edit20000', tool: 'Edit', kind: 'edit', file: '/work/shop/src/header.js' });   // no status file: a guess, not said as sure
  assert.equal(row(BUSY).menu, undefined); assert.equal(row(TURN).menu, undefined);   // nothing waits on you there
  assert.equal(row(PLAN).state, 'blocked'); assert.deepEqual(row(PLAN).menu, { id: 'w' + (now - 45e3), tool: 'ExitPlanMode', kind: 'plan', text: '# Plan\n1. Check\n2. Write hello.txt', sure: 1 });   // read from the plan file as it is now, not as first written
  assert.equal(row(OTHER).state, 'blocked'); assert.deepEqual(row(OTHER).menu, { id: 'w' + (now - 30e3), tool: '', kind: 'menu', sure: 1 });
  assert.equal(row(DIALOG).state, 'turn'); assert.equal(row(DIALOG).menu, undefined);   // a dialog you opened yourself is not a question for you
  core.shutdown();
});

test('a menu left open for more than half an hour still needs you on the board, but no longer takes the call from the session you were in', () => {
  const core = require('../server.js'), rows = core.boardRows();
  assert.equal(rows.find((r) => r.id === oid('a')).state, 'blocked');
  assert.equal(core.currentSession('-work-old', null, { proj: '-work-old', id: oid('b') }).id, oid('b'));   // it used to move the call to the menu of two hours ago
  core.shutdown();
});

test('the call of a folder takes the sessions of the folder and of the folders inside it, never those of a folder beside it whose name starts the same', () => {
  const core = require('../server.js');
  assert.equal(core.currentSession('-work-app', null, null).id, oid('d'), 'app/sub, not app-old, which is newer');   // -work-app-old used to count as a folder inside -work-app
  assert.equal(core.currentSession('-work-app-old', null, null).id, oid('e'));
  core.shutdown();
});

test('a menu open on a message with two commands names the first one, the one Claude Code asks about', () => {
  const core = require('../server.js'), r = core.boardRows().find((x) => x.id === oid('f'));
  assert.equal(r.state, 'blocked'); assert.equal(r.ask, 'Bash(npm test)');
  core.shutdown();
});

test('a click on what needs you opens the session where it can be answered: its Claude Code tab, in the editor window that runs it', { skip: process.platform === 'win32' ? 'no process tree on Windows' : false }, async () => {
  const { spawn } = require('child_process'), http = require('http'), kid = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']), sid = '0d0d0d0d-0d0d-40d0-80d0-0d0d0d0d0d0d', sdk = '0e0e0e0e-0e0e-40e0-80e0-0e0e0e0e0e0e';   // kid: the claude of a Claude Code tab; this process: the extension host of its window
  const st = (k, id, ep) => fs.writeFileSync(path.join(SESSIONS, k + '.json'), JSON.stringify({ pid: kid.pid, sessionId: id, status: 'waiting', waitingFor: 'input needed', entrypoint: ep, statusUpdatedAt: now }));
  st(120, sid, 'claude-vscode'); st(121, sdk, 'sdk-cli');
  const core = require('../server.js'), srv = core.start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  const ask = (body, headers = {}) => new Promise((done) => { const q = http.request({ host: '127.0.0.1', port, path: '/api/answer', method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => done({ status: r.statusCode, j: (() => { try { return JSON.parse(b); } catch { return null; } })() })); }); q.end(JSON.stringify(body)); });
  try {
    core.noteEditor({ scheme: 'vscode', windowId: '7' });   // what the extension notes for its window
    assert.deepEqual((await ask({ id: sid })).j, { how: 'editor', link: `vscode://anthropic.claude-code/open?session=${sid}&windowId=7` }, 'that window, which brings up its tab');
    let here = ''; assert.deepEqual(core.answerIn(sid, { here: (x) => { here = x; } }), { how: 'editor', here: 1 }); assert.equal(here, sid, 'the extension of that very window opens it itself: no link, no prompt from the editor');
    const note = path.join(path.dirname(process.env.AGENT_STANDUP_PREFS), 'editors', process.pid + '.json'), n = JSON.parse(fs.readFileSync(note, 'utf8')); fs.writeFileSync(note, JSON.stringify({ ...n, ppid: n.ppid + 1, windowId: '9' }));
    assert.ok(!/windowId=9/.test((await ask({ id: sid })).j.link || ''), 'a note left by another process that had the same number (a crash) is not followed');
    core.forgetEditor(); const b = (await ask({ id: sid })).j; assert.ok(b.how === '' || (b.how === 'app' && b.app) || /^(vscode|vscode-insiders|cursor|windsurf|vscodium):\/\/anthropic\.claude-code\/open\?session=0d0d0d0d-0d0d-40d0-80d0-0d0d0d0d0d0d$/.test(b.link), JSON.stringify(b));   // no note: the editor among its parents, else the app it runs in (macOS), else nothing
    assert.deepEqual((await ask({ id: sdk })).j, { how: '' }, 'a session a program runs: no one to answer it there');
    assert.deepEqual((await ask({ id: '../../etc' })).j, { how: '' }); assert.deepEqual((await ask({ id: id(MENU) })).j, { how: '' }, 'where it runs not said (an older Claude Code): nothing opened');
    assert.equal((await ask({ id: sid }, { 'sec-fetch-site': 'cross-site' })).status, 403, 'another site cannot make it open anything');
  } finally { kid.kill(); core.forgetEditor(); for (const k of [120, 121]) fs.rmSync(path.join(SESSIONS, k + '.json'), { force: true }); srv.close(); core.shutdown(); }
});
