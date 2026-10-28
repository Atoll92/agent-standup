// test/cowork.test.js: the sessions of Cowork (a tab of the Claude desktop app), kept in the app's own folder in the format of Claude Code, against a real server on a free port
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cowork-')), PROJECTS = path.join(tmp, 'projects'), CW = path.join(tmp, 'Claude', 'local-agent-mode-sessions');
process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_KOKORO_DIR = path.join(tmp, 'kokoro'); process.env.AGENT_STANDUP_PROJECTS = PROJECTS; process.env.AGENT_STANDUP_COWORK = CW;
const get = (port, p) => new Promise((res, rej) => { http.get({ port, path: p }, (x) => { let b = ''; x.on('data', (d) => { b += d; }); x.on('end', () => res({ status: x.statusCode, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); }).on('error', rej); });
const talk = (ask, answer) => [{ type: 'user', timestamp: '2026-10-13T10:00:00Z', message: { role: 'user', content: ask } }, { type: 'assistant', timestamp: '2026-10-13T10:00:05Z', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: answer }] } }].map((r) => JSON.stringify(r)).join('\n') + '\n';
const S1 = '11111111-1111-4111-8111-111111111111', S2 = '22222222-2222-4222-8222-222222222222', CC = '33333333-3333-4333-8333-333333333333';
const one = path.join(CW, 'acct', 'org', 'local_one'), two = path.join(CW, 'acct', 'org', 'local_two'), p1 = path.join(one, '.claude', 'projects', '-sessions-calm-keen-ada'), p2 = path.join(two, '.claude', 'projects', '-sessions-bold-wise-hopper');
fs.mkdirSync(path.join(p1, S1, 'subagents'), { recursive: true }); fs.mkdirSync(p2, { recursive: true }); fs.mkdirSync(path.join(PROJECTS, '-work-app'), { recursive: true }); fs.mkdirSync(path.join(CW, 'skills-plugin', 'org', 'acct'), { recursive: true });
fs.writeFileSync(path.join(p1, S1 + '.jsonl'), talk('Sort my invoices', 'Done: three folders.')); fs.writeFileSync(path.join(p1, S1, 'subagents', 'agent-a1.jsonl'), talk('Read the invoices', 'Read.'));
fs.writeFileSync(one + '.json', JSON.stringify({ sessionId: 'local_one', cliSessionId: S1, title: 'Invoices of October', systemPrompt: 'not for us' }));   // the note the app keeps beside the folder: its title is the one the app's own list shows
fs.writeFileSync(path.join(p2, S2 + '.jsonl'), talk('Plan the trip', 'Here is a plan.')); fs.writeFileSync(two + '.json', '{ not json');   // a note that cannot be read costs the title, not the session
fs.writeFileSync(path.join(PROJECTS, '-work-app', CC + '.jsonl'), talk('Fix the build', 'Fixed.'));
const at = (f, ago) => { const t = new Date(Date.now() - ago); fs.utimesSync(f, t, t); };
at(path.join(p1, S1 + '.jsonl'), 60e3); at(path.join(p1, S1, 'subagents', 'agent-a1.jsonl'), 60e3); at(path.join(p1, S1, 'subagents'), 60e3); at(path.join(p2, S2 + '.jsonl'), 3600e3); at(path.join(PROJECTS, '-work-app', CC + '.jsonl'), 600e3);

test('Cowork sessions are listed under Cowork with the name the app gave them, and open like any Claude Code session', async () => {
  const core = require('../server.js'), srv = core.start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  try {
    const rows = core.sessionRows(), cw = rows.filter((r) => r.proj === '_cowork');
    assert.deepEqual(cw.map((r) => [r.id, r.title, r.project, r.agents]), [[S1, 'Invoices of October', 'Cowork', 1], [S2, 'Plan the trip', 'Cowork', 0]]);
    assert.equal(rows.filter((r) => r.proj === '-work-app').length, 1);
    const board = core.boardRows().find((r) => r.id === S1); assert.equal(board.proj, '_cowork'); assert.equal(board.title, 'Invoices of October'); assert.equal(board.subTotal, 1);
    const tl = await get(port, '/api/session?proj=_cowork&id=' + S1); assert.equal(tl.status, 200); assert.ok(tl.json.events.some((e) => JSON.stringify(e).includes('three folders')));
    assert.equal(tl.json.project.key, 'cowork:' + p1);
    assert.equal((await get(port, '/api/session?proj=_cowork&id=' + S2)).json.project.key, 'cowork:' + p2, 'each VM project has its own lead name, never one for all Cowork');
    assert.equal((await get(port, '/api/session?proj=_cowork&id=44444444-4444-4444-8444-444444444444')).status, 404);
    assert.equal((await get(port, '/api/session?proj=_cowork&id=' + CC)).status, 404);   // a Claude Code session is not one of Cowork
    assert.ok((await get(port, '/api/projects')).json.some((p) => p.proj === '_cowork' && p.sessions === 2));
    assert.equal((await get(port, '/api/current')).json.id, S1);   // the most recent of anywhere
    assert.equal((await get(port, '/api/current?proj=-work-app')).json.id, CC);   // a window that follows a folder stays in it
    assert.equal((await get(port, '/api/current?proj=_cowork')).json.id, S1);
    assert.equal((await get(port, `/api/current?pproj=_cowork&pid=${S2}`)).json.id, S2);   // the one you went to from the board
  } finally { srv.close(); core.shutdown(); }
});
test('Cowork sessions are left out when turned off, and when the app is pointed at one folder without being asked for them', async () => {
  const core = require('../server.js'), keep = process.env.AGENT_STANDUP_COWORK, later = () => new Promise((r) => setTimeout(r, 1300));   // the call goes by the list of sessions, which is worked out at most once every 1.2 s
  try {
    process.env.AGENT_STANDUP_COWORK = 'off'; await later(); assert.equal(core.currentSession('', null, null).id, CC); assert.deepEqual(core.currentSession('_cowork', { proj: '_cowork', id: S2 }, null), core.currentSession('_cowork', null, null));
    delete process.env.AGENT_STANDUP_COWORK; await later(); assert.equal(core.currentSession('', null, null).id, CC);   // AGENT_STANDUP_PROJECTS is set (as in every other test file): the real folder of the desktop app is left alone
    process.env.AGENT_STANDUP_COWORK = CW; await later(); assert.equal(core.currentSession('', null, null).id, S1);
  } finally { process.env.AGENT_STANDUP_COWORK = keep; }
});
test('a task Cowork runs on a schedule is nobody typing: it does not take the call from the session you went to; and Cowork sessions take no place of a Claude Code session in the list or on the board', async () => {
  const core = require('../server.js'), later = () => new Promise((r) => setTimeout(r, 3200));   // the folders of Cowork are looked at once every 3 s
  const S3 = '55555555-5555-4555-8555-555555555555', three = path.join(CW, 'acct', 'org', 'local_three'), p3 = path.join(three, '.claude', 'projects', '-sessions-fair-kind-lovelace'), cc = { proj: '-work-app', id: CC };
  await later(); const went = core.currentSession('', cc, null); assert.deepEqual([went.id, went.pick], [CC, 1]);   // you go to the Claude Code session
  fs.mkdirSync(p3, { recursive: true }); fs.writeFileSync(three + '.json', JSON.stringify({ sessionId: 'local_three', cliSessionId: S3, title: 'Daily mail', scheduledTaskId: 'daily-mail' }));
  fs.writeFileSync(path.join(p3, S3 + '.jsonl'), [{ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: '<scheduled-task name="daily-mail" file="/tasks/daily-mail/SKILL.md">\nThis is an automated run of a scheduled task. The user is not present.\n</scheduled-task>' } },
    { type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'm1', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'sleep 60' } }] } }].map((r) => JSON.stringify(r)).join('\n') + '\n');   // then a task starts by itself, and is at work
  await later(); const task = core.boardRows().find((r) => r.id === S3); assert.equal(task.state, 'working'); assert.ok(!task.asked, 'the prompt of a scheduled task is not an order someone typed');
  assert.ok(core.boardRows().find((r) => r.id === S1).asked > 0);   // what you type in a Cowork session is
  const still = core.currentSession('', { ...cc, since: went.asked }, null); assert.deepEqual([still.id, still.pick], [CC, 1], 'the call stays in the session you went to');
  const old = path.join(PROJECTS, '-old-app'); fs.mkdirSync(old, { recursive: true });   // sixty more Claude Code sessions, all older than those of Cowork
  for (let i = 0; i < 60; i++) { const f = path.join(old, 'aaaaaaaa-0000-4000-8000-' + String(i).padStart(12, '0') + '.jsonl'); fs.writeFileSync(f, talk('Task ' + i, 'Done.')); at(f, 2 * 3600e3 + i * 1000); }
  await later(); const rows = core.sessionRows(), board = core.boardRows(), cowork = (r) => r.proj === '_cowork';
  assert.deepEqual([rows.filter((r) => !cowork(r)).length, rows.filter(cowork).length], [60, 3], 'the list: sixty Claude Code sessions as before Cowork was read, and the Cowork ones beside them');
  assert.deepEqual([board.filter((r) => !cowork(r)).length, board.filter(cowork).length], [40, 3], 'the board: forty, and the Cowork ones beside them');
});
