// test/waiting.test.js: a session that waits on you, read from its transcript and from the status Claude Code keeps in <config>/sessions/<pid>.json. A Bash approval shows only there;
// since when it has waited, apart from how long it worked before; a status file whose process has ended says nothing.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-waiting-')), PROJECTS = path.join(tmp, 'projects'), SESSIONS = path.join(tmp, 'sessions');
Object.assign(process.env, { AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_KOKORO_DIR: path.join(tmp, 'kokoro'), AGENT_STANDUP_PROJECTS: PROJECTS, AGENT_STANDUP_CC_SESSIONS: SESSIONS });
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

test('a Bash approval needs you, with the command, since the menu opened, apart from the time it worked', () => {
  const core = require('../server.js'), rows = core.boardRows(), row = (n) => rows.find((r) => r.id === id(n));
  assert.equal(row(MENU).state, 'blocked'); assert.equal(row(MENU).tool, 'Bash'); assert.equal(row(MENU).ask, 'Bash(npm run build --prod)');   // on one line, the way Claude Code shows it
  assert.equal(row(MENU).since, now - 35e3); assert.equal(row(MENU).ran, 265e3);   // from the order to the menu
  assert.equal(row(LONG).state, 'blocked'); assert.equal(row(LONG).since, now - 2690e3);   // a menu left open for 45 minutes still waits: it is not "idle"
  assert.equal(row(STALE).state, 'working'); assert.equal(row(STALE).ask, undefined);   // the process is gone: its file says nothing
  assert.equal(row(BUSY).state, 'working'); assert.equal(row(BUSY).since, undefined);   // a command that runs is not a question
  assert.equal(row(TURN).state, 'turn'); assert.equal(row(TURN).since, now - 600e3); assert.equal(row(TURN).ran, 300e3);
  assert.equal(row(GUESS).state, 'blocked'); assert.equal(row(GUESS).ask, 'Edit(header.js)'); assert.equal(row(GUESS).since, now - 20e3);   // no status file: still the guess from a file edit left pending
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
