// test/accounts.test.js: Claude Code kept in several folders, one per account (alias claude-pro="CLAUDE_CONFIG_DIR=~/.claude-pro claude", issue #9). The app is started without that variable and reads them all:
// ~/.claude, each ~/.claude-<name> that holds a projects folder, and the folders AGENT_STANDUP_CLAUDE_DIRS names. Against a home folder made for the test, never the real one.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { spawn, spawnSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-accounts-')), HOME = path.join(tmp, 'home'), WORK = path.join(tmp, 'elsewhere', 'claude-work');
for (const k of ['AGENT_STANDUP_PROJECTS', 'AGENT_STANDUP_CC_SESSIONS', 'CLAUDE_CONFIG_DIR']) delete process.env[k];
Object.assign(process.env, { HOME, USERPROFILE: HOME, AGENT_STANDUP_CLAUDE_DIRS: WORK, AGENT_STANDUP_COWORK: 'off', AGENT_STANDUP_CODEX: '0', AGENT_STANDUP_VIBE: '0', AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_KOKORO_DIR: path.join(tmp, 'kokoro'), AGENT_STANDUP_CHARACTERS: path.join(tmp, 'characters'), AGENT_STANDUP_PACKS: path.join(tmp, 'packs') });
const live = [0, 1, 2].map(() => { const k = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600e3)'], { stdio: 'ignore' }); k.unref(); return k; }); process.on('exit', () => { for (const k of live) try { k.kill(); } catch {} });   // a running Claude Code per status file: one process writes one

const now = Date.now(), iso = (ago) => new Date(now - ago).toISOString(), id = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const user = (text, ago) => ({ type: 'user', timestamp: iso(ago), message: { role: 'user', content: text } }), say = (text, ago) => ({ type: 'assistant', timestamp: iso(ago), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const bash = (command, ago) => ({ type: 'assistant', timestamp: iso(ago), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_b' + ago, name: 'Bash', input: { command } }] } });
const put = (f, recs, ago) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); const t = new Date(now - ago); fs.utimesSync(f, t, t); };
const get = (port, p) => new Promise((res, rej) => { http.get({ port, path: p }, (x) => { let b = ''; x.on('data', (d) => { b += d; }); x.on('end', () => res({ status: x.statusCode, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); }).on('error', rej); });
const at = (home, proj, n) => path.join(HOME, home, 'projects', proj, id(n) + '.jsonl');

put(at('.claude', '-work-app', 1), [user('Fix the login', 120e3), say('Fixed in the default account.', 100e3)], 100e3);
put(at('.claude-pro', '-work-app', 2), [user('Build the release', 60e3), bash('npm run build', 40e3)], 40e3);   // the same project, from the other account
put(path.join(HOME, '.claude-pro', 'projects', '-work-app', id(2), 'subagents', 'agent-a1.jsonl'), [user('Check the tests', 50e3), say('They pass.', 45e3)], 45e3);
fs.mkdirSync(path.join(HOME, '.claude-pro', 'sessions'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude-pro', 'sessions', '301.json'), JSON.stringify({ pid: live[0].pid, sessionId: id(2), status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: now - 35e3, updatedAt: now - 35e3 }));   // its menu is known only from its own folder's status
put(at('.claude-perso', '-work-site', 3), [user('Write the about page', 300e3), say('Written.', 280e3)], 280e3);
put(at('.claude-perso', '-work-app', 1), [user('A stale copy', 900e3), say('Not this one.', 880e3)], 880e3);   // the same session copied into another folder: read once, from the first
put(at('.claude', '-work-app', 7), [user('Deploy it', 90e3), bash('npm run deploy', 25e3)], 25e3); fs.mkdirSync(path.join(HOME, '.claude', 'sessions'), { recursive: true });   // ~/.claude copied into ~/.claude-pro while this session ran:
fs.writeFileSync(path.join(HOME, '.claude', 'sessions', '401.json'), JSON.stringify({ pid: live[1].pid, sessionId: id(7), status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: now - 20e3, updatedAt: now - 20e3 }));
fs.writeFileSync(path.join(HOME, '.claude-pro', 'sessions', '401.json'), JSON.stringify({ pid: live[1].pid, sessionId: id(7), status: 'busy', statusUpdatedAt: now - 300e3, updatedAt: now - 300e3 }));   // the copy's status is frozen
put(at('.claude', '-work-app', 8), [user('Old plan', 48 * 3600e3), say('Planned.', 48 * 3600e3)], 48 * 3600e3); put(at('.claude-pro', '-work-app', 8), [user('Old plan', 48 * 3600e3), say('Planned.', 48 * 3600e3), user('Go on', 100e3), say('Resumed in the other account.', 95e3)], 95e3);   // copied, then resumed there
put(at('.claude', '-work-app', 9), [user('Remove the cache', 70e3), bash('rm -rf .cache', 65e3)], 65e3);   // copied while its menu waited, then /clear in the same process: a new id, the menu gone
fs.writeFileSync(path.join(HOME, '.claude-pro', 'sessions', '501.json'), JSON.stringify({ pid: live[2].pid, sessionId: id(9), status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: now - 60e3, updatedAt: now - 60e3 }));
fs.writeFileSync(path.join(HOME, '.claude', 'sessions', '501.json'), JSON.stringify({ pid: live[2].pid, sessionId: id(5), status: 'idle', statusUpdatedAt: now - 10e3, updatedAt: now - 10e3 }));
put(path.join(WORK, 'projects', '-work-api', id(4) + '.jsonl'), [user('Add the endpoint', 200e3), say('Added.', 190e3)], 190e3);
for (const d of ['.claude-pro', '.claude-perso', '.claude-tool', '.claude-pro.bak']) { fs.mkdirSync(path.join(HOME, d), { recursive: true }); fs.writeFileSync(path.join(HOME, d, '.claude.json'), '{}'); }   // Claude Code started with CLAUDE_CONFIG_DIR keeps its .claude.json there
put(at('.claude-backup', '-work-app', 1), [user('Fix the login', 120e3), say('Fixed in the default account.', 100e3)], 60e3); put(at('.claude-backup', '-work-old', 'a'), [user('Gone from ~/.claude', 9 * 86400e3), say('Done.', 9 * 86400e3)], 60e3);   // cp -r ~/.claude ~/.claude-backup: fresh dates, no .claude.json
put(at('.claude-pro.bak', '-work-old', 'b'), [user('A backup of an account', 9 * 86400e3), say('Done.', 9 * 86400e3)], 60e3);   // named like a backup
put(at('.claude-tool', '-work-site', 3), [user('Write the about page', 300e3), say('Written.', 280e3)], 10e3);   // the same bytes as ~/.claude-perso's, copied later: the first folder still
fs.mkdirSync(path.join(HOME, '.claude-max'), { recursive: true }); fs.writeFileSync(path.join(HOME, '.claude-max', '.config.json'), '{}');   // an account an old Claude Code made: .config.json, never .claude.json
put(at('.claude', '-work-lim', 'c'), [user('Long job', 30 * 3600e3), ...Array.from({ length: 40 }, (_, i) => say('Step ' + i + ' done.', (24 - i * 0.1) * 3600e3))], 20 * 3600e3);   // copied into ~/.claude-max, went on growing here, then hit the limit
put(at('.claude-max', '-work-lim', 'c'), [user('Long job', 30 * 3600e3), say('Step 0 done.', 24 * 3600e3), user('Go on', 14 * 3600e3), say('Resumed on the other account.', 14 * 3600e3)], 14 * 3600e3);   // resumed in the other account: smaller, and later
put(at('.claude', '-work-big', 'd'), [user('Read the dump', 50 * 3600e3), say('Reading it.', 49 * 3600e3)], 49 * 3600e3);   // left behind in ~/.claude two days ago
put(at('.claude-max', '-work-big', 'd'), [user('Read the dump', 50 * 3600e3), say('Reading it.', 49 * 3600e3), user('Go on', 21 * 3600e3), { type: 'user', timestamp: iso(20 * 3600e3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] }, toolUseResult: { stdout: 'y'.repeat(100e3) } }], 20 * 3600e3);   // resumed here: its last record is 100 KB long, its time at the start
fs.mkdirSync(path.join(HOME, '.claude-empty'), { recursive: true }); fs.writeFileSync(path.join(HOME, '.claude.json'), '{}');   // neither holds sessions
const JUNK = path.join(HOME, '.claude-tool', 'projects', '-junk'); fs.mkdirSync(path.join(JUNK, 'sub.jsonl'), { recursive: true });   // another tool's folder of the same shape: what it holds costs nothing to the others
fs.writeFileSync(path.join(JUNK, id(6) + '.jsonl'), ['null', '[1,2]', '"text"', '{"type":"user","message":5}', '{"type":"assistant","message":{"content":"x","stop_reason":7}}', '{"type":"user","timestamp":"never","message":{"content":[null,{"type":"tool_result"}]}}', '{not json', ''].join('\n'));
fs.writeFileSync(path.join(JUNK, 'notes.jsonl'), Buffer.from([0xff, 0xfe, 0x00, 0x0a, 0x7b]));

test('the sessions of every Claude Code folder are in one call, each read from where it was written', async () => {
  const core = require('../server.js'), srv = core.start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  try {
    const rows = core.sessionRows(), ids = rows.map((r) => r.id);
    for (const n of [1, 2, 3, 4]) assert.equal(ids.filter((x) => x === id(n)).length, 1, 'session ' + n + ' listed once');
    assert.equal(core.transcriptFile('-work-app', id(1)), at('.claude', '-work-app', 1), 'a session found twice is read from the copy that holds more of it');
    assert.ok(!ids.includes(id('a')) && !ids.includes(id('b')), 'a backup copy is not an account: no .claude.json, or a name that ends like a backup');
    assert.equal(core.transcriptFile('-work-site', id(3)), at('.claude-perso', '-work-site', 3), 'the same bytes in two folders: the first, whatever the dates say');
    assert.equal(core.transcriptFile('-work-big', id('d')), at('.claude-max', '-work-big', 'd'), 'a last record too long to find its time: the file date says which copy is newer');
    assert.equal(core.transcriptFile('-work-lim', id('c')), at('.claude-max', '-work-lim', 'c'), 'resumed in an account an old Claude Code made: read from there, though the copy left behind is larger');
    assert.equal(core.transcriptFile('-work-app', id(8)), at('.claude-pro', '-work-app', 8), 'resumed in the other account: read from there');
    assert.equal(ids.filter((x) => x === id(8)).length, 1); assert.ok(core.boardRows().some((r) => r.id === id(8)), 'its recent work is on the board');
    assert.equal(core.boardRows().find((r) => r.id === id(7)).state, 'blocked', "a copied folder's frozen status never hides a menu that waits");
    assert.notEqual(core.boardRows().find((r) => r.id === id(9)).state, 'blocked', 'nor shows one that is gone: its process says something newer under its new id');
    assert.equal(core.transcriptFile('-work-app', id(2)), at('.claude-pro', '-work-app', 2));
    assert.equal(core.transcriptFile('-work-api', id(4)), path.join(WORK, 'projects', '-work-api', id(4) + '.jsonl'));
    const one = await get(port, '/api/session?proj=-work-app&id=' + id(1)); assert.equal(one.status, 200); assert.ok(JSON.stringify(one.json.events).includes('Fixed in the default account.'));
    assert.ok(!JSON.stringify(one.json.events).includes('Not this one.'));
    const pro = await get(port, '/api/session?proj=-work-app&id=' + id(2)); assert.equal(pro.status, 200); assert.ok(JSON.stringify(pro.json.events).includes('They pass.'), "the sub-agent beside its lead's transcript");
    assert.equal((await get(port, '/api/session?proj=-work-site&id=' + id(3))).status, 200);
    assert.equal((await get(port, '/api/session?proj=-work-site&id=' + id(9))).status, 404);
    const app = (await get(port, '/api/projects')).json.find((p) => p.proj === '-work-app'); assert.equal(app.sessions, 5, 'one project, whichever account worked in it');
    assert.equal(core.boardRows().find((r) => r.id === id(2)).state, 'blocked', "the status Claude Code keeps in that account's folder says a menu waits");
    assert.equal((await get(port, '/api/current')).json.id, id(2));
    const all = await get(port, '/api/sessions'); assert.equal(all.status, 200); assert.ok([1, 2, 3, 4].every((n) => all.json.some((r) => r.id === id(n))));
    assert.equal((await get(port, '/api/board')).status, 200); assert.ok([200, 404].includes((await get(port, '/api/session?proj=-junk&id=' + id(6))).status));
  } finally { srv.close(); core.shutdown(); }
});

test('with one Claude Code folder, or one folder asked for, that folder alone is read', () => {
  const home = path.join(tmp, 'home-one'), env = { ...process.env, HOME: home, USERPROFILE: home }; delete env.AGENT_STANDUP_CLAUDE_DIRS;
  put(path.join(home, '.claude', 'projects', '-work-app', id(5) + '.jsonl'), [user('Hello', 60e3), say('Hi.', 50e3)], 50e3);
  const list = (extra) => { const r = spawnSync(process.execPath, ['-e', "const s = require(process.argv[1]); console.log(JSON.stringify(s.sessionRows().map((r) => r.id))); s.shutdown(); process.exit(0)", path.join(__dirname, '..', 'server.js')], { env: { ...env, ...extra }, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.trim().split('\n').pop()); };
  assert.deepEqual(list({}), [id(5)]);
  assert.deepEqual(list({ HOME, USERPROFILE: HOME, AGENT_STANDUP_PROJECTS: path.join(HOME, '.claude-pro', 'projects') }).sort(), [id(2), id(8)].sort(), 'the other folders are left alone');
  assert.deepEqual(list({ HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: path.join(HOME, '.claude-perso'), AGENT_STANDUP_CLAUDE_DIRS: 'off' }).sort(), [id(1), id(3)].sort(), 'off: that folder alone (its copy of session 1 included)');
});

test('the command line reads every account, or the one --config names', () => {
  const env = { ...process.env }; delete env.AGENT_STANDUP_CLAUDE_DIRS;
  const ids = (...a) => { const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'agent-standup.js'), 'status', '--json', '--codex', 'off', '--vibe', 'off', '--cowork', 'off', ...a], { env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).sessions.map((s) => s.id).filter((x) => [1, 2, 3, 4].some((n) => x === id(n))).sort(); };
  assert.deepEqual(ids(), [id(1), id(2), id(3)].sort());
  assert.deepEqual(ids('--config', path.join(HOME, '.claude-pro')), [id(2)]);
});
