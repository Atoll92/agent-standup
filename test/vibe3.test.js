// test/vibe3.test.js: Mistral Vibe 3 sessions. Vibe 3 starts a sub-agent with agents.spawn and waits with self.wait, and the sub-agent keeps its own history in
// unified/child-<id>/ (named by the spawn's childSessionId). Its folder is not a session of its own: its commands and words are the sub-agent's in its lead's call.
// The shapes are those of a real Vibe 3.1.5 session (2026-11-28), cut down.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'as-vibe3-')), ROOT = path.join(HOME, 'logs', 'session'), WORK = path.join(HOME, 'work');
process.env.AGENT_STANDUP_VIBE = HOME;
const vibe = require('../vibe.js');
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const LEAD = 'e3f47ff4-f47d-6464-a4fe-0284f21c9d45', CHILD = 'child-fb35a7ba4ad114df3b980864', T0 = Date.now() - 10 * 60e3, TURN = 'turn-1', CT = 'turn-c1';
const msg = (sid, turnId, id, role, text, at) => ({ id, type: 'message', role, content: [{ type: 'text', text }], createdAt: T0 + at, updatedAt: T0 + at, generationStatus: 'completed', sessionId: sid, turnId, source: role === 'user' ? 'turn_start' : 'harness' });
const eff = (sid, turnId, id, toolName, input, state, at, end, detail = {}) => ({ id, type: 'effect', title: toolName, detail: { toolName, kind: 'tool', input, display: { message: toolName }, ...detail }, state, createdAt: T0 + at, updatedAt: T0 + end, generationStatus: 'completed', sessionId: sid, turnId });
const done = (structured_content, o = {}) => ({ status: 'completed', outputText: '', output: { type: 'success', content: [], structured_content, ...o } });
const envelope = (sid, parent, turnId, at) => ({ format: 'harness.public-session-state/v1', latestTurn: { id: turnId, status: 'completed', startedAt: T0, completedAt: T0 + at },
  session: { id: sid, rootSessionId: parent || sid, parentSessionId: parent, title: null, preview: '', status: { type: 'idle' }, createdAt: T0, updatedAt: T0 + at, tokenUsage: { inputTokens: 5000, cachedInputTokens: 500, outputTokens: 60, totalTokens: 5060 }, contextUsage: { inputTokens: 5000, cachedInputTokens: 500 } } });
function store(sid, entries, env, meta) {   // a session folder as Vibe 3 writes it: CURRENT → generation → manifest → one page of history; an empty journal after it
  const dir = path.join(ROOT, 'unified', sid), gen = '0000000000000009', g = path.join(dir, 'generations', gen), sha = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  for (const d of [g, path.join(dir, 'chunks'), path.join(dir, 'journal')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(dir, 'chunks', sha + '.json'), JSON.stringify(entries));
  fs.writeFileSync(path.join(g, 'manifest.json'), JSON.stringify({ manifest_version: 1, generation: gen, snapshot_sequence: 9, session_id: sid, execution_state: 'quiescent', projection_state: { path: 'projection-state.json', chunks: [sha] }, recovery_journal_segment: { first_sequence: 10, path: 'journal/0000000000000010.jsonl' } }));
  fs.writeFileSync(path.join(g, 'projection-state.json'), JSON.stringify({ projection_state_version: 1, session_id: sid, snapshot_sequence: 9, snapshot: env }));
  fs.writeFileSync(path.join(g, 'runtime-state.json'), JSON.stringify({ session_metadata: { active_model: 'mistral-large-4-0', cwd: WORK } }));
  fs.writeFileSync(path.join(dir, 'journal', '0000000000000010.jsonl'), '');
  if (meta) fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));   // a sub-agent's folder has none
  fs.writeFileSync(path.join(dir, 'CURRENT'), JSON.stringify({ generation: gen, snapshot_sequence: 9, session_id: sid, store_format: 'mistral.vibe.unified-session-store/v1', store_format_minor: 10 }));
  return dir;
}
const TASK = 'Review calc.js and give a verdict, APPROVE or REJECT.';
store(LEAD, [
  msg(LEAD, TURN, 'user-1', 'user', 'Write calc.js, test it, and have a sub-agent review it.', 0),
  eff(LEAD, TURN, 'effect-search', 'search_tool_functions', { mode: 'details' }, done({}), 1000, 1000),
  eff(LEAD, TURN, 'effect-bash', 'file_system.bash', { command: 'node test.js' }, done({ command: 'node test.js', returncode: 0, stdout: 'All tests passed', stderr: '' }), 2000, 2100),
  eff(LEAD, TURN, 'effect-spawn', 'agents.spawn', { agent: 'generic', task: TASK }, done({ type: 'success' }, { _meta: { 'mistral.vibe.subagent': { agentName: 'calc-reviewer', agentType: null, childSessionId: CHILD, generation: 1 } } }), 3000, 3100, { kind: 'subagent', agentName: 'calc-reviewer', childSessionId: CHILD }),
  eff(LEAD, TURN, 'effect-wait', 'self.wait', { deadline_unix_ms: T0 + 123000, timeout_ms: 120000 }, done({ reason: 'input_available' }), 3200, 6000),
  msg(LEAD, TURN, 'assistant-1', 'assistant', 'Done: the reviewer approves calc.js.', 7000),
], envelope(LEAD, null, TURN, 7000), { session_id: LEAD, parent_session_id: null, start_time: new Date(T0).toISOString(), environment: { working_directory: WORK }, child_sessions: [], title: null });
const CDIR = store(CHILD, [
  msg(CHILD, CT, 'c-user-1', 'user', TASK, 3100),
  eff(CHILD, CT, 'c-read', 'file_system.read_file', { path: path.join(WORK, 'calc.js') }, done({ content: 'function add(a, b) { return a + b; }' }), 3300, 3350),
  msg(CHILD, CT, 'c-assistant-1', 'assistant', 'APPROVE: add and sub are correct and exported.', 5000),
], envelope(CHILD, LEAD, CT, 5000), null);

// A session that stops on a permission: Vibe 3 keeps its status "running" and writes the wait in the journal (callback_registered, then callback_resolved once answered).
const ASK = 'a5000000-0000-4000-8000-000000000005', running = (sid) => { const e = envelope(sid, null, 'turn-a', 1000); e.session.status = { type: 'running', activeTurnId: 'turn-a' }; e.latestTurn = { id: 'turn-a', status: 'in_progress', startedAt: T0 }; return e; };
const ADIR = store(ASK, [msg(ASK, 'turn-a', 'a-user', 'user', 'Delete the old build folder.', 0), eff(ASK, 'turn-a', 'a-bash', 'file_system.bash', { command: 'rm -rf build' }, { status: 'running' }, 500, 500)], running(ASK), { session_id: ASK, parent_session_id: null, start_time: new Date(T0).toISOString(), environment: { working_directory: WORK }, child_sessions: [] });
const journal = (dir, rec) => fs.appendFileSync(path.join(dir, 'journal', '0000000000000010.jsonl'), JSON.stringify(rec) + '\n');
const fresh = (dir) => { const t = new Date(); fs.utimesSync(path.join(dir, 'CURRENT'), t, t); };   // a session written just now, as a waiting one is

test('a Vibe 3 session waiting on a permission needs you; once answered it works again', () => {
  fresh(ADIR);
  const state = () => vibe.boardRow(vibe.row(ASK), Date.now()).state;
  assert.equal(state(), 'working');
  journal(ADIR, { type: 'callback_registered', sequence: 10, payload: { callback_id: 'approval-1', kind: 'approval', routing: { title: 'Approve file_system.bash' } } });
  assert.equal(state(), 'blocked');
  journal(ADIR, { type: 'callback_resolved', sequence: 11, payload: { callback_id: 'approval-1', state: 'resolved', result: { choice: 'approve' } } });
  assert.equal(state(), 'working');
});

test('a Vibe 3 sub-agent folder is not listed as a session; its lead counts it', () => {
  const ids = vibe.sessions().map((r) => r.id).filter((id) => id !== ASK);
  assert.deepEqual(ids, [LEAD]);
  assert.equal(vibe.subCount(LEAD), 1);
  assert.equal(vibe.boardRow(vibe.row(LEAD), Date.now()).subTotal, 1);
});

test('the lead orders, waits and hears back; the sub-agent works in its own name, from its own folder', () => {
  const main = vibe.state(LEAD).raw, call = main.find((e) => e.kind === 'agentcall'), subs = vibe.subFiles(LEAD);
  assert.equal(call && call.text, TASK); assert.equal(call.title, 'calc-reviewer');
  assert.ok(!main.some((e) => e.kind === 'tool' && /agents\.|self\.wait|search_tool/.test(String(e.tool && e.tool.name))), 'no stray tool for spawning or waiting');
  assert.ok(main.some((e) => e.kind === 'agentdone' && e.toolId === 'effect-spawn'), 'it handed back');
  assert.equal(subs.length, 1); assert.equal(subs[0].aid, CHILD); assert.equal(subs[0].meta.toolUseId, 'effect-spawn');
  const kid = subs[0].st.raw;
  assert.deepEqual(kid.map((e) => e.kind), ['tool', 'results', 'say'], 'its own read, its result and its verdict; not the task again');
  assert.ok(kid.every((e) => e.agent === CHILD && e.k.startsWith(CHILD + ':')));
  assert.equal(kid[2].text, 'APPROVE: add and sub are correct and exported.');
  assert.ok(subs.journals.some((j) => j.file === path.join(CDIR, 'CURRENT')), 'its folder is watched, so the call moves while only the sub-agent writes');
});

test('what the sub-agent writes next reaches the call while its lead sits still', () => {
  const before = vibe.subFiles(LEAD)[0].st.raw.length;
  fs.appendFileSync(path.join(CDIR, 'journal', '0000000000000010.jsonl'), JSON.stringify({ type: 'projection_delta', sequence: 10, payload: { delta: [{ op: 'append_entry', entry: msg(CHILD, CT, 'c-assistant-2', 'assistant', 'One more note: sub could guard against strings.', 5500) }] } }) + '\n');
  const after = vibe.subFiles(LEAD)[0].st.raw;
  assert.equal(after.length, before + 1); assert.equal(after[after.length - 1].text, 'One more note: sub could guard against strings.');
});
