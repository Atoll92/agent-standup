// test/report-here.test.js: report --here keeps past Codex, Mistral Vibe and Claude Code sessions from this folder, and still excludes sessions from another folder
const { test, after } = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-report-here-')), PROJECTS = path.join(tmp, 'projects'), CODEX = path.join(tmp, 'codex'), VIBE = path.join(tmp, 'vibe'), X0 = path.join(tmp, 'x'), Y0 = path.join(tmp, 'y');
fs.mkdirSync(X0); fs.mkdirSync(Y0); const X = fs.realpathSync(X0), Y = fs.realpathSync(Y0);
const DAY = '2026-01-02', AT = new Date(2026, 0, 2, 12, 0).toISOString(), LATER = new Date(2026, 0, 2, 12, 1).toISOString(), MTIME = new Date(2026, 0, 2, 13, 0), CLI = path.join(__dirname, '..', 'bin', 'agent-standup.js'), SERVER = path.join(__dirname, '..', 'server.js');
const ENV = { ...process.env, AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_CC_SESSIONS: path.join(tmp, 'cc-sessions'), AGENT_STANDUP_CLAUDE_DIRS: 'off' };
const projectKey = (dir) => dir.replace(/[^a-zA-Z0-9]/g, '-');
const report = (cwd, codex, vibe) => JSON.parse(execFileSync(process.execPath, [CLI, 'report', '--json', '--day', DAY, '--here', '--projects', PROJECTS, '--codex', codex, '--vibe', vibe, '--cowork', 'off'], { cwd, env: ENV, encoding: 'utf8' }));
const sessionRow = (id) => JSON.parse(execFileSync(process.execPath, ['-e', `const r = require(${JSON.stringify(SERVER)}).sessionRows().find((x) => x.id === ${JSON.stringify(id)}); process.stdout.write(JSON.stringify(r));`], { env: { ...ENV, AGENT_STANDUP_PROJECTS: PROJECTS, AGENT_STANDUP_CODEX: 'off', AGENT_STANDUP_VIBE: VIBE, AGENT_STANDUP_COWORK: 'off' }, encoding: 'utf8' }));
const ids = (r) => r.rows.map((x) => x.id);
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const CID = '01a00000-0000-7000-8000-0000000000d1', rollout = path.join(CODEX, 'sessions', '2026', '01', '02', `rollout-${DAY}T20-00-00-${CID}.jsonl`);
fs.mkdirSync(path.dirname(rollout), { recursive: true }); fs.writeFileSync(rollout, [
  { timestamp: AT, type: 'session_meta', payload: { id: CID, session_id: CID, timestamp: AT, cwd: X, originator: 'codex_cli_rs' } },
  { timestamp: AT, type: 'event_msg', payload: { type: 'user_message', message: 'Past Codex work' } },
  { timestamp: LATER, type: 'event_msg', payload: { type: 'agent_message', message: 'Done.' } },
].map(JSON.stringify).join('\n') + '\n'); fs.utimesSync(rollout, MTIME, MTIME);

const VID = 'session_20260102_200000_aaaa1111', vibeDir = path.join(VIBE, 'logs', 'session', VID), vibeMessages = path.join(vibeDir, 'messages.jsonl');
fs.mkdirSync(vibeDir, { recursive: true }); fs.writeFileSync(path.join(vibeDir, 'meta.json'), JSON.stringify({ session_id: VID, start_time: AT, environment: { working_directory: X }, origin_directory: X, child_sessions: [] }));
fs.writeFileSync(vibeMessages, [JSON.stringify({ role: 'user', content: 'Past Vibe work' }), JSON.stringify({ role: 'assistant', content: 'Done.' })].join('\n') + '\n'); fs.utimesSync(vibeMessages, MTIME, MTIME);

const NO_CWD_ID = 'session_20260102_120000_bbbb2222', noCwdDir = path.join(VIBE, 'logs', 'session', NO_CWD_ID), noCwdMessages = path.join(noCwdDir, 'messages.jsonl');
fs.mkdirSync(noCwdDir, { recursive: true }); fs.writeFileSync(path.join(noCwdDir, 'meta.json'), JSON.stringify({ session_id: NO_CWD_ID, start_time: AT, child_sessions: [] }));
fs.writeFileSync(noCwdMessages, [JSON.stringify({ role: 'user', content: 'Past Vibe work without a folder' }), JSON.stringify({ role: 'assistant', content: 'Done.' })].join('\n') + '\n'); fs.utimesSync(noCwdMessages, MTIME, MTIME);

const CLAUDE_ID = 'claude-past', claudeDir = path.join(PROJECTS, projectKey(X)), claudeFile = path.join(claudeDir, CLAUDE_ID + '.jsonl');
fs.mkdirSync(claudeDir, { recursive: true }); fs.writeFileSync(claudeFile, [
  { type: 'user', timestamp: AT, message: { role: 'user', content: 'Past Claude Code work' } },
  { type: 'assistant', timestamp: LATER, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } },
].map(JSON.stringify).join('\n') + '\n'); fs.utimesSync(claudeFile, MTIME, MTIME);

test('report --here keeps a past Codex session only in the folder where it started', () => {
  assert.ok(ids(report(X, CODEX, 'off')).includes(CID));
  assert.ok(!ids(report(Y, CODEX, 'off')).includes(CID));
});

test('report --here keeps a past Mistral Vibe session only in the folder where it started', () => {
  assert.ok(ids(report(X, 'off', VIBE)).includes(VID));
  assert.ok(!ids(report(Y, 'off', VIBE)).includes(VID));
});

test('report --here does not treat Vibe storage as the folder of a session without a working directory', () => {
  assert.ok(!ids(report(noCwdDir, 'off', VIBE)).includes(NO_CWD_ID));
  assert.equal(sessionRow(NO_CWD_ID).dir, undefined);
});

test('report --here still filters Claude Code sessions by folder', () => {
  assert.ok(ids(report(X, 'off', 'off')).includes(CLAUDE_ID));
  assert.ok(!ids(report(Y, 'off', 'off')).includes(CLAUDE_ID));
});
