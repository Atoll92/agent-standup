// test/credits-here.test.js: credits --here finds Codex, Mistral Vibe and Claude Code sessions only in the folder where they started
const { test, after } = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-credits-here-')), PROJECTS = path.join(tmp, 'projects'), EMPTY_PROJECTS = path.join(tmp, 'empty-projects'), CODEX = path.join(tmp, 'codex'), VIBE = path.join(tmp, 'vibe'), X0 = path.join(tmp, 'x'), Y0 = path.join(tmp, 'y'), Z0 = path.join(tmp, 'z'), W0 = path.join(tmp, 'w');
fs.mkdirSync(PROJECTS); fs.mkdirSync(EMPTY_PROJECTS); fs.mkdirSync(X0); fs.mkdirSync(Y0); fs.mkdirSync(Z0); fs.mkdirSync(W0); const X = fs.realpathSync(X0), Y = fs.realpathSync(Y0), Z = fs.realpathSync(Z0), W = fs.realpathSync(W0);
assert.ok(fs.existsSync(X)); assert.ok(fs.existsSync(Y)); assert.ok(fs.existsSync(Z)); assert.ok(fs.existsSync(W));
const NOW = Date.now(), AT = new Date(NOW - 120000).toISOString(), LATER = new Date(NOW - 60000).toISOString(), RECENT = new Date(NOW - 30000), OLD = new Date(2026, 0, 2, 13, 0), CLI = path.join(__dirname, '..', 'bin', 'agent-standup.js'), SERVER = path.join(__dirname, '..', 'server.js');
const ENV = { ...process.env, CLAUDE_CODE_SESSION_ID: '', AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_CC_SESSIONS: path.join(tmp, 'cc-sessions'), AGENT_STANDUP_CLAUDE_DIRS: 'off' };
const projectKey = (dir) => dir.replace(/[^a-zA-Z0-9]/g, '-');
const credits = (cwd, codex, vibe, projects = PROJECTS) => spawnSync(process.execPath, [CLI, 'credits', '--here', '--json', '--projects', projects, '--codex', codex, '--vibe', vibe, '--cowork', 'off'], { cwd, env: ENV, encoding: 'utf8' });
const creditedId = (cwd, codex, vibe, projects) => { const r = credits(cwd, codex, vibe, projects); assert.equal(r.status, 0, r.stderr || r.stdout); const c = JSON.parse(r.stdout); assert.ok(c.session, r.stdout); return c.session; };
const assertNotCredited = (cwd, codex, vibe, projects) => { const r = credits(cwd, codex, vibe, projects); assert.equal(r.status, 1, r.stderr || r.stdout); assert.match(r.stderr, /No session in this folder\./); };
const sessionRow = (id, codex, vibe, projects = PROJECTS) => JSON.parse(spawnSync(process.execPath, ['-e', `const r = require(${JSON.stringify(SERVER)}).sessionRows().find((x) => x.id === ${JSON.stringify(id)}); process.stdout.write(JSON.stringify(r || null));`], { env: { ...ENV, AGENT_STANDUP_PROJECTS: projects, AGENT_STANDUP_CODEX: codex, AGENT_STANDUP_VIBE: vibe, AGENT_STANDUP_COWORK: 'off' }, encoding: 'utf8' }).stdout);
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const CID = '01a00000-0000-7000-8000-0000000000d1', rollout = path.join(CODEX, 'sessions', '2026', '11', '28', `rollout-2026-11-28T10-00-00-${CID}.jsonl`);
fs.mkdirSync(path.dirname(rollout), { recursive: true }); fs.writeFileSync(rollout, [
  { timestamp: AT, type: 'session_meta', payload: { id: CID, session_id: CID, timestamp: AT, cwd: X, originator: 'codex_cli_rs' } },
  { timestamp: AT, type: 'event_msg', payload: { type: 'user_message', message: 'Codex work' } },
  { timestamp: LATER, type: 'event_msg', payload: { type: 'agent_message', message: 'Done.' } },
].map(JSON.stringify).join('\n') + '\n'); fs.utimesSync(rollout, RECENT, RECENT);

const VID = 'session_20260102_200000_aaaa1111', vibeDir = path.join(VIBE, 'logs', 'session', VID), vibeMessages = path.join(vibeDir, 'messages.jsonl');
fs.mkdirSync(vibeDir, { recursive: true }); fs.writeFileSync(path.join(vibeDir, 'meta.json'), JSON.stringify({ session_id: VID, start_time: AT, environment: { working_directory: X }, origin_directory: X, child_sessions: [] }));
fs.writeFileSync(vibeMessages, [JSON.stringify({ role: 'user', content: 'Past Vibe work' }), JSON.stringify({ role: 'assistant', content: 'Done.' })].join('\n') + '\n'); fs.utimesSync(vibeMessages, OLD, OLD);

for (let i = 0; i < 30; i++) {
  const id = `session_20261128_1200${String(i).padStart(2, '0')}_decoy${String(i).padStart(4, '0')}`, dir = path.join(VIBE, 'logs', 'session', id), messages = path.join(dir, 'messages.jsonl'), mtime = new Date(NOW - i * 1000);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ session_id: id, start_time: AT, environment: { working_directory: Z }, origin_directory: Z, child_sessions: [] }));
  fs.writeFileSync(messages, JSON.stringify({ role: 'assistant', content: 'Decoy.' }) + '\n'); fs.utimesSync(messages, mtime, mtime);
}

const NO_CWD_ID = 'session_20261128_130000_bbbb2222', noCwdDir = path.join(VIBE, 'logs', 'session', NO_CWD_ID), noCwdMessages = path.join(noCwdDir, 'messages.jsonl');
fs.mkdirSync(noCwdDir, { recursive: true }); fs.writeFileSync(path.join(noCwdDir, 'meta.json'), JSON.stringify({ session_id: NO_CWD_ID, start_time: AT, child_sessions: [] }));
fs.writeFileSync(noCwdMessages, [JSON.stringify({ role: 'user', content: 'Vibe work without a folder' }), JSON.stringify({ role: 'assistant', content: 'Done.' })].join('\n') + '\n'); fs.utimesSync(noCwdMessages, RECENT, RECENT);
assert.ok(fs.existsSync(noCwdDir));

const CLAUDE_ID = 'claude-recent', claudeDir = path.join(PROJECTS, projectKey(X)), claudeFile = path.join(claudeDir, CLAUDE_ID + '.jsonl');
fs.mkdirSync(claudeDir, { recursive: true }); fs.writeFileSync(claudeFile, [
  { type: 'user', timestamp: AT, message: { role: 'user', content: 'Claude Code work' } },
  { type: 'assistant', timestamp: LATER, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } },
].map(JSON.stringify).join('\n') + '\n'); fs.utimesSync(claudeFile, RECENT, RECENT);

const ZID = '01a00000-0000-7000-8000-0000000000d2', zst = path.join(CODEX, 'sessions', '2026', '11', '28', `rollout-2026-11-28T11-00-00-${ZID}.jsonl.zst`), oldClaudeId = 'claude-old-w', oldClaudeDir = path.join(PROJECTS, projectKey(W)), oldClaudeFile = path.join(oldClaudeDir, oldClaudeId + '.jsonl');
if (typeof require('zlib').zstdCompressSync === 'function') {
  const raw = [
    { timestamp: AT, type: 'session_meta', payload: { id: ZID, session_id: ZID, timestamp: AT, cwd: W, originator: 'codex_cli_rs' } },
    { timestamp: AT, type: 'event_msg', payload: { type: 'user_message', message: 'Compressed Codex work' } },
    { timestamp: LATER, type: 'event_msg', payload: { type: 'agent_message', message: 'Done.' } },
  ].map(JSON.stringify).join('\n') + '\n';
  fs.writeFileSync(zst, require('zlib').zstdCompressSync(Buffer.from(raw))); fs.utimesSync(zst, RECENT, RECENT);
}
fs.mkdirSync(oldClaudeDir, { recursive: true }); fs.writeFileSync(oldClaudeFile, [
  { type: 'user', timestamp: AT, message: { role: 'user', content: 'Older Claude Code work' } },
  { type: 'assistant', timestamp: LATER, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } },
].map(JSON.stringify).join('\n') + '\n'); fs.utimesSync(oldClaudeFile, OLD, OLD);

test('credits --here credits a recent Codex session only in the folder where it started', () => {
  assert.equal(creditedId(X, CODEX, 'off', EMPTY_PROJECTS), CID);
  assertNotCredited(Y, CODEX, 'off', EMPTY_PROJECTS);
});

test('credits --here credits a Mistral Vibe session from the sessionsSince fallback only in the folder where it started', () => {
  assert.equal(sessionRow(VID, 'off', VIBE, EMPTY_PROJECTS), null);
  assert.equal(creditedId(X, 'off', VIBE, EMPTY_PROJECTS), VID);
  assertNotCredited(Y, 'off', VIBE, EMPTY_PROJECTS);
});

test('credits --here waits for a compressed Codex session before choosing an older session in its folder', { skip: typeof require('zlib').zstdCompressSync !== 'function' && 'this Node has no zstd' }, () => {
  assert.equal(creditedId(W, CODEX, 'off'), ZID);
});

test('credits --here does not treat Vibe storage as the folder of a session without a working directory', () => {
  assertNotCredited(noCwdDir, 'off', VIBE, EMPTY_PROJECTS);
});

test('credits --here still credits a recent Claude Code session only in its folder', () => {
  assert.equal(creditedId(X, 'off', 'off'), CLAUDE_ID);
  assertNotCredited(Y, 'off', 'off');
});
