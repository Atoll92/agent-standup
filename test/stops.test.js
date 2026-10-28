// test/stops.test.js: a session stopped by your usage limit or by a login that is gone, said as such and not as "gave up"; a lead waiting on a background workflow, which is not your turn;
// the live Claude Code sessions whose transcript is not where the call reads (/api/missing); the title of a Cowork session in the desktop app's newer folder layout; what the command line says of all that.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { spawnSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-stops-')), PROJECTS = path.join(tmp, 'projects'), SESSIONS = path.join(tmp, 'sessions'), CW = path.join(tmp, 'cowork');
Object.assign(process.env, { AGENT_STANDUP_ANSWER: 'dry', AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_KOKORO_DIR: path.join(tmp, 'kokoro'), AGENT_STANDUP_PROJECTS: PROJECTS, AGENT_STANDUP_CC_SESSIONS: SESSIONS, AGENT_STANDUP_COWORK: CW, AGENT_STANDUP_CODEX: 'off', AGENT_STANDUP_VIBE: 'off' });
fs.mkdirSync(SESSIONS, { recursive: true });

const now = Date.now(), iso = (ago) => new Date(now - ago).toISOString(), id = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const user = (text, ago) => ({ type: 'user', timestamp: iso(ago), message: { role: 'user', content: text } }), say = (text, ago) => ({ type: 'assistant', timestamp: iso(ago), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const fail = (text, ago, error) => ({ type: 'assistant', timestamp: iso(ago), isApiErrorMessage: true, ...(error ? { error } : {}), message: { model: '<synthetic>', role: 'assistant', stop_reason: 'stop_sequence', content: [{ type: 'text', text }] } });   // what Claude Code writes when the API says no
const call = (tid, name, input, ago) => ({ type: 'assistant', timestamp: iso(ago), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: tid, name, input }] } });
const result = (tid, text, ago) => ({ type: 'user', timestamp: iso(ago), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: text }] } });
const write = (f, recs, ago) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); const t = new Date(now - ago); fs.utimesSync(f, t, t); };
const file = (n) => path.join(PROJECTS, '-work-shop', id(n) + '.jsonl'), put = (n, recs, ago) => write(file(n), recs, ago);
const launched = (task, run) => `Workflow launched in background. Task ID: ${task}\nSummary: Review the shop\nTranscript dir: /home/me/.claude/projects/-work-shop/x/subagents/workflows/${run}\nScript file: /home/me/x.js\nRun ID: ${run}`;

const LIMIT = 1, OLDLIMIT = 2, AUTH = 3, OAUTH = 4, CONTEXT = 5, LIMITBG = 6, WF = 7, WFDONE = 8, WFNEWS = 9;
put(LIMIT, [user('Ship it', 120e3), fail("You've hit your limit · resets 7:20pm (Europe/Paris)", 60e3, 'rate_limit')], 60e3);
put(OLDLIMIT, [user('Ship it', 120e3), fail('Claude AI usage limit reached|1792620000', 61e3)], 61e3);   // the oldest form: the time it resets, as a number
put(AUTH, [user('Ship it', 120e3), fail('Not logged in · Please run /login', 62e3, 'authentication_failed')], 62e3);
put(OAUTH, [user('Ship it', 120e3), fail('Failed to authenticate: OAuth session expired and could not be refreshed', 63e3)], 63e3);   // an older version, which writes no error field
put(CONTEXT, [user('Ship it', 120e3), fail('Context limit reached · /compact or /clear to continue', 64e3)], 64e3);   // not your plan's limit: an error like any other
put(LIMITBG, [user('Review it', 300e3), call('toolu_ag', 'Agent', { prompt: 'look', run_in_background: true }, 290e3), result('toolu_ag', 'Async agent launched successfully.\nagentId: a0123456789abcdef', 289e3), fail("You've hit your limit · resets 9pm", 65e3, 'rate_limit')], 65e3);
put(WF, [user('Review the shop', 3000e3), call('toolu_wf', 'Workflow', { script: 'x' }, 2990e3), result('toolu_wf', launched('wtask1', 'wf_run1'), 2989e3), say('The review runs in the background; I will report when it ends.', 2980e3)], 2980e3);
write(path.join(PROJECTS, '-work-shop', id(WF), 'subagents', 'workflows', 'wf_run1', 'agent-a1.jsonl'), [say('reading', 5e3)], 5e3);   // launched 50 minutes ago, one of its agents wrote 5 s ago
put(WFDONE, [user('Review the shop', 600e3), call('toolu_wf', 'Workflow', { script: 'x' }, 590e3), result('toolu_wf', launched('wtask2', 'wf_run2'), 589e3), say('Running.', 580e3)], 580e3);
write(path.join(PROJECTS, '-work-shop', id(WFDONE), 'subagents', 'workflows', 'wf_run2', 'agent-a2.jsonl'), [say('done', 70e3)], 70e3);
fs.mkdirSync(path.join(PROJECTS, '-work-shop', id(WFDONE), 'workflows'), { recursive: true }); fs.writeFileSync(path.join(PROJECTS, '-work-shop', id(WFDONE), 'workflows', 'wf_run2.json'), JSON.stringify({ runId: 'wf_run2', taskId: 'wtask2', status: 'completed' }));   // its record, written when it ended
put(WFNEWS, [user('Review the shop', 600e3), call('toolu_wf', 'Workflow', { script: 'x' }, 590e3), result('toolu_wf', launched('wtask3', 'wf_run3'), 589e3), say('Running.', 580e3), user('<task-notification>\n<task-id>wtask3</task-id>\n<status>completed</status>\n</task-notification>', 100e3), say('The review is done: 3 findings.', 90e3)], 90e3);
write(path.join(PROJECTS, '-work-shop', id(WFNEWS), 'subagents', 'workflows', 'wf_run3', 'agent-a3.jsonl'), [say('done', 95e3)], 95e3);
const WIN = '07070707-0707-4070-8070-070707070707', WINSUB = '06060606-0606-4060-8060-060606060606';   // Windows: Claude Code wrote c:, the editor asks for C:
write(path.join(PROJECTS, 'c--Work-app', WIN + '.jsonl'), [{ ...user('Fix it', 20e3), cwd: 'c:/Work/app' }, say('Fixed.', 19e3)], 19e3);
write(path.join(PROJECTS, 'c--Work-app-sub', WINSUB + '.jsonl'), [{ ...user('Test it', 10e3), cwd: 'c:/Work/app/sub' }, say('Tested.', 9e3)], 9e3);   // a folder inside it, told by its cwd

const status = (k, o) => fs.writeFileSync(path.join(SESSIONS, k + '.json'), JSON.stringify({ pid: process.pid, kind: 'interactive', entrypoint: 'cli', version: '2.1.304', ...o }));
const LOST = '0e0e0e0e-0e0e-40e0-80e0-0e0e0e0e0e0e';
status(201, { sessionId: LOST, cwd: '/work/lost', status: 'busy', startedAt: now - 60e3, updatedAt: now - 6e3, statusUpdatedAt: now - 6e3 });   // at work for 6 s, and its transcript is nowhere here
status(202, { sessionId: '0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f', cwd: '/work/new', status: 'idle', startedAt: now - 8e3, statusUpdatedAt: now - 8e3 });   // just opened: no message yet, no transcript yet
status(203, { sessionId: '0d0d0d0d-0d0d-40d0-80d0-0d0d0d0d0d0d', cwd: '/work/sdk', entrypoint: 'sdk-cli', status: 'busy', startedAt: now - 60e3, statusUpdatedAt: now - 5e3 });   // claude -p: a program's session
status(204, { sessionId: id(LIMIT), cwd: '/work/shop', status: 'idle', startedAt: now - 300e3, statusUpdatedAt: now - 60e3 });   // its transcript is there
status(206, { sessionId: '0b0b0b0b-0b0b-40b0-80b0-0b0b0b0b0b0b', cwd: '/work/model', status: 'waiting', waitingFor: 'dialog open', startedAt: now - 60e3, updatedAt: now - 30e3, statusUpdatedAt: now - 30e3 });   // just opened, then /model: never busy, no transcript yet
status(207, { sessionId: '0a0a0a0a-0a0a-40a0-80a0-0a0a0a0a0a0a', cwd: '/work/cleared', status: 'idle', startedAt: now - 600e3, updatedAt: now - 10e3, statusUpdatedAt: now - 40e3 });   // right after /clear: a new id and updatedAt, the status of the id before
status(208, { sessionId: '09090909-0909-4090-8090-090909090909', cwd: '/work/cleared2', status: 'busy', startedAt: now - 600e3, updatedAt: now - 10e3, statusUpdatedAt: now - 40e3 });   // the same, the id before was busy: not this id's
status(209, { sessionId: '08080808-0808-4080-8080-080808080808', cwd: '/work/started', status: 'busy', startedAt: now - 60e3, updatedAt: now - 2e3, statusUpdatedAt: now - 2e3 });   // at work for 2 s: its transcript may come with the first message
status(205, { sessionId: '0c0c0c0c-0c0c-40c0-80c0-0c0c0c0c0c0c', cwd: '/work/bg', kind: 'background', status: 'busy', startedAt: now - 60e3, statusUpdatedAt: now - 5e3 });

// Cowork, newer layout: the session's folder is named after the start of the desktop app's own id, and its note is beside it as local_<that>-….json
const ORG = path.join(CW, 'acct', 'org'), CS = '1a2b3c4d-1111-4111-8111-111111111111', CS2 = '5e6f7a8b-2222-4222-8222-222222222222';
write(path.join(ORG, '79746300', '.claude', 'projects', 'session', CS + '.jsonl'), [user('Daily todo', 50e3), say('Done.', 40e3)], 40e3);
fs.writeFileSync(path.join(ORG, 'local_79746300-c060-4ac0-a0ad-3ded3719b16c.json'), JSON.stringify({ sessionId: 'local_79746300-c060-4ac0-a0ad-3ded3719b16c', cliSessionId: CS, title: 'Daily gmail todo' }));
write(path.join(ORG, 'ab12cd34', '.claude', 'projects', 'session', CS2 + '.jsonl'), [user('Plan the trip', 50e3), say('Done.', 45e3)], 45e3);
fs.writeFileSync(path.join(ORG, 'local_ab12cd34-0000-4000-8000-000000000001.json'), JSON.stringify({ cliSessionId: 'another', title: 'Not this one' }));
fs.writeFileSync(path.join(ORG, 'local_ab12cd34-0000-4000-8000-000000000002.json'), JSON.stringify({ cliSessionId: CS2, title: 'Trip to Lisbon' }));   // two notes start the same way: the one that names the transcript

const get = (port, p) => new Promise((res, rej) => http.get({ port, path: p }, (x) => { let b = ''; x.on('data', (d) => (b += d)); x.on('end', () => res({ status: x.statusCode, body: b })); }).on('error', rej));

test('a session stopped by your usage limit says when it resets; one whose login is gone says so; neither is "gave up", and other errors still are', () => {
  const rows = require('../server.js').boardRows(), row = (n) => rows.find((r) => r.id === id(n));
  assert.equal(row(LIMIT).state, 'turn'); assert.deepEqual(row(LIMIT).limit, { resets: '7:20pm (Europe/Paris)' }); assert.equal(row(LIMIT).gave, undefined); assert.equal(row(LIMIT).auth, undefined);
  assert.equal(row(OLDLIMIT).state, 'turn'); assert.match(row(OLDLIMIT).limit.resets, /^\d\d:\d\d$/); assert.equal(row(OLDLIMIT).gave, undefined);
  for (const n of [AUTH, OAUTH]) { assert.equal(row(n).state, 'turn'); assert.equal(row(n).auth, 1); assert.equal(row(n).gave, undefined); assert.equal(row(n).limit, undefined); }
  assert.equal(row(CONTEXT).limit, undefined); assert.match(row(CONTEXT).gave, /^Context limit reached/);
  assert.equal(row(LIMITBG).state, 'turn', 'its agent launched in the background stops on the same limit: nothing goes on'); assert.deepEqual(row(LIMITBG).limit, { resets: '9pm' });
});

test('a lead that waits on a workflow it launched in the background is not waiting for you, until the workflow ends', () => {
  const rows = require('../server.js').boardRows(), row = (n) => rows.find((r) => r.id === id(n));
  assert.equal(row(WF).state, 'waiting', 'launched 50 minutes ago, its agents still write');
  assert.equal(row(WFDONE).state, 'turn', 'Claude Code wrote its record: it has ended');
  assert.equal(row(WFNEWS).state, 'turn', 'the news that it ended came');
});

test('/api/missing lists the live Claude Code sessions seen at work for 5 s whose transcript is not in the projects folder, and only those: not one just opened, one in /model, one right after /clear', async () => {
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r));
  try {
    const r = await get(srv.address().port, '/api/missing'); assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), [{ id: LOST, cwd: '/work/lost', name: 'lost', version: '2.1.304', ep: 'cli', since: now - 60e3 }]);
  } finally { srv.close(); require('../server.js').shutdown(); }
});

test('on Windows the folder the editor asks for holds the sessions written there, whatever the case of its drive letter', () => {
  const server = require('../server.js'), real = Object.getOwnPropertyDescriptor(process, 'platform');
  assert.equal(server.currentSession('C--Work-app').wide, 1, 'elsewhere a folder of another case is another folder');
  Object.defineProperty(process, 'platform', { ...real, value: 'win32' });
  try {
    const c = server.currentSession('C--Work-app'); assert.equal(c.wide, undefined); assert.equal(c.proj, 'c--Work-app-sub', 'the folder inside it, written to last'); assert.equal(c.id, WINSUB);
    assert.equal(server.currentSession('C--Work-app', null, { proj: 'c--Work-app', id: WIN }).id, WINSUB);
    assert.equal(server.currentSession('C--Work').wide, undefined, 'a folder above it too');
    assert.equal(server.currentSession('C--Work-ap').wide, 1, 'not a folder whose name only starts the same');
  } finally { Object.defineProperty(process, 'platform', real); }
});

test('a Cowork session in the newer folder layout gets the title the desktop app gave it', () => {
  const rows = require('../server.js').boardRows();
  assert.equal(rows.find((r) => r.id === CS).title, 'Daily gmail todo');
  assert.equal(rows.find((r) => r.id === CS2).title, 'Trip to Lisbon');
});

test('the command line says your usage limit and when it resets, ahead of your turn; --projects also reads the status beside it; --json gives since when, and with --titles the question and what the command is for', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'as-stops-cli-')), P = path.join(T, 'projects'), S = path.join(T, 'sessions'); fs.mkdirSync(S, { recursive: true });
  write(path.join(P, '-work-a', id(1) + '.jsonl'), [user('Ship it', 120e3), fail("You've hit your limit · resets 7:20pm (Europe/Paris)", 30e3, 'rate_limit')], 30e3);
  write(path.join(P, '-work-a', id(2) + '.jsonl'), [user('Notes', 120e3), say('Here are the notes.', 60e3)], 60e3);
  const env = { ...process.env, AGENT_STANDUP_PREFS: path.join(T, 'prefs.json') }; for (const k of ['AGENT_STANDUP_CC_SESSIONS', 'AGENT_STANDUP_PROJECTS', 'AGENT_STANDUP_COWORK', 'AGENT_STANDUP_HOST']) delete env[k];
  const cli = (...a) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'agent-standup.js'), ...a, '--projects', P, '--codex', 'off', '--vibe', 'off'], { env, encoding: 'utf8' });
  assert.equal(cli('status').stdout.trim(), '⏳ usage limit · resets 7:20pm (Europe/Paris) · ✓ your turn');
  const j = JSON.parse(cli('status', '--json').stdout); assert.deepEqual(j.sessions.find((s) => s.id === id(1)).limit, { resets: '7:20pm (Europe/Paris)' });
  write(path.join(P, '-work-a', id(3) + '.jsonl'), [user('Build it', 120e3), call('toolu_b', 'Bash', { command: 'npm run build', description: 'Build for production' }, 40e3)], 40e3);
  fs.writeFileSync(path.join(S, '301.json'), JSON.stringify({ pid: process.pid, sessionId: id(3), status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: now - 35e3 }));   // only the sessions folder beside the projects one says a menu is open
  const k = JSON.parse(cli('status', '--json').stdout), b = k.sessions.find((s) => s.id === id(3));
  assert.equal(k.needsYou, 1); assert.equal(b.state, 'blocked'); assert.equal(b.since, now - 35e3); assert.equal(b.ask, undefined, 'what a session says only with --titles'); assert.equal(b.about, undefined); assert.equal(b.title, undefined);
  const t = JSON.parse(cli('status', '--json', '--titles').stdout).sessions.find((s) => s.id === id(3)); assert.equal(t.ask, 'Bash(npm run build)'); assert.equal(t.about, 'Build for production'); assert.equal(t.since, now - 35e3);
  assert.equal(cli('status').stdout.trim(), '✋ 1 needs you · ⏳ usage limit · resets 7:20pm (Europe/Paris)');
  write(path.join(P, '-work-a', id(1) + '.jsonl'), [user('Ship it', 120e3), fail('Not logged in · Please run /login', 30e3, 'authentication_failed')], 30e3);
  assert.equal(cli('status').stdout.trim(), '✋ 1 needs you · ⚠ logged out: run /login');
  assert.equal(JSON.parse(cli('status', '--json').stdout).sessions.find((s) => s.id === id(1)).auth, 1);
  const sl = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'agent-standup.js'), 'statusline', '--projects', P, '--codex', 'off', '--vibe', 'off'], { env, encoding: 'utf8', input: '{}' });
  assert.equal(sl.stdout.trim(), '✋1 ⚠login');
});
