// test/cursor.test.js: Cursor Agent CLI sessions (cursor.js) read as a call, next to a Claude Code session that must stay exactly as it was.
// Made-up agent-transcripts + chats/meta.json under a stand-in ~/.cursor, and a real server on a free port.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cursor-')), CU = path.join(tmp, 'cursor'), PROJECTS = path.join(tmp, 'projects');
process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_KOKORO_DIR = path.join(tmp, 'kokoro'); process.env.AGENT_STANDUP_PROJECTS = PROJECTS; process.env.AGENT_STANDUP_CURSOR = CU;
const get = (port, p) => new Promise((res, rej) => http.get({ port, path: p }, (x) => { let b = ''; x.on('data', (d) => { b += d; }); x.on('end', () => res({ status: x.statusCode, json: () => JSON.parse(b) })); }).on('error', rej));
const serve = async () => { const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); return { port: srv.address().port, stop: () => { srv.close(); require('../server.js').shutdown(); } }; };

const NOW = Date.now(), WORK = path.join(os.homedir(), 'work', 'shop'), HASH = crypto.createHash('md5').update(WORK).digest('hex');
const NEW = '01b00000-0000-7000-8000-00000000000a', OLD = '01b00000-0000-7000-8000-00000000000b', KID = '01b00000-0000-7000-8000-00000000000c';
const SLUG = 'home-work-shop';
const put = (id, lines, meta, mtime, sub) => {
  const dir = path.join(CU, 'projects', SLUG, 'agent-transcripts', id); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id + '.jsonl'); fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  if (sub) { const sd = path.join(dir, 'subagents'); fs.mkdirSync(sd, { recursive: true }); for (const [aid, rows] of Object.entries(sub)) { const f = path.join(sd, aid + '.jsonl'); fs.writeFileSync(f, rows.map((l) => JSON.stringify(l)).join('\n') + '\n'); fs.utimesSync(f, mtime / 1000, mtime / 1000); } }
  const cd = path.join(CU, 'chats', HASH, id); fs.mkdirSync(cd, { recursive: true });
  fs.writeFileSync(path.join(cd, 'meta.json'), JSON.stringify({ schemaVersion: 1, createdAtMs: meta.created || mtime - 60000, hasConversation: true, title: meta.title || '', updatedAtMs: mtime, cwd: WORK }));
  fs.utimesSync(file, mtime / 1000, mtime / 1000); return file;
};
const user = (text, at) => ({ role: 'user', message: { content: [{ type: 'text', text: `<timestamp>${new Date(at).toUTCString()}</timestamp>\n<user_query>\n${text}\n</user_query>` }] } });
const asst = (parts) => ({ role: 'assistant', message: { content: parts } });
const text = (t) => ({ type: 'text', text: t });
const tool = (name, input) => ({ type: 'tool_use', id: null, name, input });

const TASK = 'Find every place the cart total is computed.\nReport the files.';
put(NEW, [
  user('Why is the cart total wrong?', NOW - 8 * 60e3),
  asst([text('I will read the cart code first.'), tool('Shell', { command: 'cat src/cart.js' })]),
  asst([tool('Read', { path: path.join(WORK, 'src/cart.js') }), tool('AskQuestion', { title: 'Ship it?', questions: [{ id: 'q1', prompt: 'Ship the fix now?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'Not yet' }] }] })]),
  asst([tool('CallDynamicTool', { namespace: 'cursor', toolName: 'Task', arguments: { description: 'Find total sites', subagent_type: 'explore', prompt: TASK, run_in_background: false } })]),
  asst([text('Waiting on the scout.')]),
  { type: 'turn_ended', status: 'success' },
], { title: 'Fix the cart total', created: NOW - 10 * 60e3 }, NOW - 5 * 60e3, {
  [KID]: [user(TASK, NOW - 7 * 60e3), asst([text('Two places: cart.js and checkout.js.')]), { type: 'turn_ended', status: 'success' }],
});
put(OLD, [user('An older question', NOW - 30 * 3600e3), asst([text('An older answer.')]), { type: 'turn_ended', status: 'success' }], { title: '', created: NOW - 30 * 3600e3 }, NOW - 29 * 3600e3);

const claudeDir = path.join(PROJECTS, '-c'); fs.mkdirSync(claudeDir, { recursive: true });
fs.writeFileSync(path.join(claudeDir, 'cc.jsonl'), [{ type: 'user', timestamp: new Date(NOW - 3600e3).toISOString(), message: { role: 'user', content: 'a Claude Code order' } }, { type: 'assistant', timestamp: new Date(NOW - 3599e3).toISOString(), message: { id: 'm1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'A Claude Code answer.' }] } }].map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.utimesSync(path.join(claudeDir, 'cc.jsonl'), (NOW - 3599e3) / 1000, (NOW - 3599e3) / 1000);

test('Cursor sessions are listed with their names and project; the Claude Code session is still there', async () => {
  const s = await serve();
  try {
    const rows = (await get(s.port, '/api/sessions')).json(), cu = rows.filter((r) => r.proj === '_cursor');
    assert.deepEqual(cu.map((r) => r.id), [NEW, OLD]);
    assert.equal(cu[0].title, 'Fix the cart total'); assert.equal(cu[1].title, 'An older question');
    assert.equal(cu[0].project, 'Cursor · work/shop'); assert.equal(cu[0].source, 'cursor'); assert.equal(cu[0].agents, 1);
    const c = rows.find((r) => r.proj === '-c'); assert.equal(c.id, 'cc'); assert.equal(c.title, 'a Claude Code order'); assert.equal(c.source, undefined);
  } finally { s.stop(); }
});

test('a Cursor session becomes the same events as a Claude Code one: lines, tools, a question, a sub-agent, the end of the turn', async () => {
  const s = await serve();
  try {
    const tl = (await get(s.port, '/api/session?proj=_cursor&id=' + NEW)).json();
    assert.ok(tl.agents.some((a) => a.id === 'main')); assert.ok(tl.agents.some((a) => a.id === KID));
    const kinds = tl.events.map((e) => e.kind);
    assert.ok(kinds.includes('user')); assert.ok(kinds.includes('say')); assert.ok(kinds.includes('tools') || kinds.includes('tool') || tl.events.some((e) => e.kind === 'tools' || (e.tools && e.tools.length)));
    const flat = tl.events.filter((e) => e.kind === 'tools').flatMap((e) => e.tools).concat(tl.events.filter((e) => e.kind === 'tool').map((e) => e.tool)).filter(Boolean);
    const names = flat.map((t) => t.name || t); assert.ok(names.includes('Bash') || names.includes('Shell') || flat.some((t) => /Bash|Shell|cat/.test(JSON.stringify(t))));
    assert.ok(tl.events.some((e) => e.kind === 'agentcall' || e.kind === 'order'));
    assert.ok(tl.events.some((e) => e.kind === 'say' && /Waiting on the scout|cart code|Two places/.test(e.text || '')));
  } finally { s.stop(); }
});

test('the board shows a Cursor session that asked a question as needing you', async () => {
  // Rewrite NEW without turn_ended, ending on AskQuestion, recently written
  const dir = path.join(CU, 'projects', SLUG, 'agent-transcripts', NEW);
  const lines = [
    user('Ship?', NOW - 30e3),
    asst([tool('AskQuestion', { title: 'Go?', questions: [{ id: 'q', prompt: 'Ready to ship?', options: [{ id: 'y', label: 'Yes' }] }] })]),
  ];
  const file = path.join(dir, NEW + '.jsonl'); fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n'); fs.utimesSync(file, Date.now() / 1000, Date.now() / 1000);
  const s = await serve();
  try {
    const board = (await get(s.port, '/api/board')).json(), row = board.find((r) => r.proj === '_cursor' && r.id === NEW);
    assert.ok(row); assert.equal(row.state, 'blocked'); assert.equal(row.source, 'cursor'); assert.match(row.ask || '', /Ready to ship/);
  } finally { s.stop(); }
});
