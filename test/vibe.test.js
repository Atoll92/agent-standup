// test/vibe.test.js: Mistral Vibe sessions (vibe.js) read as a call, next to a Claude Code session that must stay exactly as it was. Made-up session folders in the two shapes
// Vibe 2.26 writes them, each copied from a real session: the earlier one (messages.jsonl + meta.json, sub-agents in agents/) and the current one (unified/<id>/: snapshot, pages, journal). A real server on a free port.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-vibe-')), VB = path.join(tmp, 'vibe'), ROOT = path.join(VB, 'logs', 'session'), PROJECTS = path.join(tmp, 'projects');
process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_KOKORO_DIR = path.join(tmp, 'kokoro'); process.env.AGENT_STANDUP_PROJECTS = PROJECTS; process.env.AGENT_STANDUP_VIBE = VB;
const get = (port, p) => new Promise((res, rej) => http.get({ port, path: p }, (x) => { let b = ''; x.on('data', (d) => { b += d; }); x.on('end', () => res({ status: x.statusCode, json: () => JSON.parse(b) })); }).on('error', rej));
const serve = async () => { const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); return { port: srv.address().port, stop: () => { srv.close(); require('../server.js').shutdown(); } }; };

// ---- the files. The session started ten minutes ago and was last written five minutes ago; its sub-agent ran in between.
const NOW = Date.now(), START = NOW - 10 * 60e3, END = NOW - 5 * 60e3, SUB_START = NOW - 8 * 60e3, SUB_END = NOW - 7 * 60e3, WORK = path.join(os.homedir(), 'work', 'shop');
const S1 = 'session_20261012_100000_aaaa1111', S2 = 'session_20261011_090000_bbbb2222', KID = 'explore_20261012_100200_cccc3333';
const user = (content, o = {}) => ({ role: 'user', content, message_id: 'u' + content.length, ...o }), tool = (id, name, content, output, o = {}) => ({ role: 'tool', content, name, tool_call_id: id, ...(output ? { tool_result: { output, cancelled: false, ...o } } : {}) });
const asst = (content, calls = [], o = {}) => ({ role: 'assistant', content, message_id: 'a' + content.length + calls.length, ...(calls.length ? { tool_calls: calls.map(([id, name, args], index) => ({ id, index, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } : {}), ...o });
const put = (dir, lines, meta, mtime) => {
  fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'messages.jsonl'); fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n'); fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  fs.utimesSync(f, mtime / 1000, mtime / 1000); return f;
};
const metaOf = (o) => ({ session_id: 'id-' + Math.abs(o.start), parent_session_id: null, start_time: new Date(o.start).toISOString(), end_time: null, git_commit: null, git_branch: null, environment: { working_directory: WORK }, origin_directory: WORK, username: 'me', child_sessions: [], loops: [], title: null, title_source: 'auto', tools_available: [{ type: 'function', function: { name: 'x'.repeat(50000) } }], system_prompt: { role: 'system', content: 'never shown' }, ...o.more });

const lines1 = [
  user('<file>expanded</file> Why is the cart total wrong?', { input_text: 'Why is the cart total wrong?' }),
  user('<vibe_warning>a hook said something</vibe_warning>', { injected: true }),
  asst('I will look at the cart code.', [['c1', 'bash', { command: 'npm test' }]], { reasoning_content: 'The total is computed in cart.js.\nI should run the tests first.' }),
  tool('c1', 'bash', 'command: npm test\nexit_code: 1\nstdout: 1 failing\nstderr: boom', { command: 'npm test', exit_code: 1, stdout: '1 failing', stderr: 'boom' }, { duration: 20 }),
  asst('', [['c2', 'read_file', { file_path: '/w/cart.js' }], ['c3', 'grep', { pattern: 'total', path: '/w' }], ['c4', 'todo', { action: 'write', todos: [{ id: '1', content: 'Fix the total', status: 'in_progress', priority: 'high' }] }], ['c5', 'todo', { action: 'read' }], ['c6', 'task', { task: 'Find every place the cart total is computed.\nReport the files.', agent: 'explore' }]]),
  tool('c2', 'read_file', 'path: /w/cart.js\ncontent: const total = 0;', { path: '/w/cart.js', content: 'const total = 0;', lines_read: 1 }),
  tool('c3', 'grep', '<tool_error>grep: bad pattern</tool_error>'),
  tool('c4', 'todo', 'verb: wrote', { verb: 'wrote', todos: [], total_count: 1 }),
  tool('c5', 'todo', 'verb: read', { verb: 'read', todos: [], total_count: 1 }),
  tool('c6', 'task', 'response: Two places: cart.js and checkout.js.', { response: 'Two places: cart.js and checkout.js.', turns_used: 2, completed: true }),
  asst('', [['c7', 'edit', { file_path: '/w/cart.js', old_string: 'const total = 0;', new_string: 'const total = sum(items);' }], ['c8', 'write_file', { file_path: '/w/notes.md', content: '# Notes' }], ['c9', 'web_search', { query: 'rounding money js' }], ['c10', 'my_mcp_tool', { q: 1 }]]),
  tool('c7', 'edit', 'file: /w/cart.js\nmessage: replaced 1 occurrence', { file: '/w/cart.js', message: 'replaced 1 occurrence' }),
  tool('c8', 'write_file', 'file_path: /w/notes.md\nbytes_written: 7', { file_path: '/w/notes.md', bytes_written: 7, content: '# Notes' }),
  tool('c9', 'web_search', 'query: rounding money js\nanswer: Use integers.', { query: 'rounding money js', answer: 'Use integers.', sources: [] }),
  tool('c10', 'my_mcp_tool', 'ok: yes'),
  asst('The total is fixed: it now sums the items.'),
];
const kidLines = [user('Find every place the cart total is computed.\nReport the files.'), asst('', [['k1', 'grep', { pattern: 'total', path: '/w' }]]), tool('k1', 'grep', 'matches: cart.js:1', { matches: 'cart.js:1\ncheckout.js:9', match_count: 2 }), asst('Two places: cart.js and checkout.js.')];
const main1 = put(path.join(ROOT, S1), lines1, metaOf({ start: START, more: { title: 'Fix the cart total', child_sessions: [{ session_id: 'kid', tool_call_id: 'c6', agent: 'explore', relative_path: 'agents/' + KID }], stats: { steps: 4, session_prompt_tokens: 9000, session_completion_tokens: 700, session_cached_tokens: 4000, context_tokens: 3000 }, config: { active_model: 'devstral', models: [{ name: 'devstral-latest', alias: 'devstral', max_context_length: 200000 }] } } }), END);
put(path.join(ROOT, S1, 'agents', KID), kidLines, metaOf({ start: SUB_START, more: { parent_session_id: 'id-' + START, stats: { steps: 1, session_prompt_tokens: 1000, session_completion_tokens: 50, session_cached_tokens: 0 } } }), SUB_END);
put(path.join(ROOT, S2), [user('An older question, with no title.'), asst('An older answer.')], metaOf({ start: NOW - 30 * 3600e3 }), NOW - 29 * 3600e3);
fs.mkdirSync(path.join(ROOT, '.last_session'), { recursive: true }); fs.mkdirSync(path.join(ROOT, 'session_empty'), { recursive: true }); fs.writeFileSync(path.join(ROOT, '.session_index.json'), '{}');   // what else Vibe keeps there
// ---- the current format: a snapshot taken while the lead waits for its sub-agent, then (later, in the test) the journal that follows it
const U1 = 'u1000000-0000-4000-8000-000000000001', UDIR = path.join(ROOT, 'unified', U1), UT = NOW - 25 * 60e3, GEN = '0000000000000010', TURN = 'turn-1';
const umsg = (id, role, text, at) => ({ id, type: 'message', role, content: [{ type: 'text', text }], createdAt: UT + at, updatedAt: UT + at, generationStatus: 'completed', sessionId: U1, turnId: TURN, source: role === 'user' ? 'turn_start' : 'harness' });
const ueff = (id, toolName, input, state, at, end, detail = {}) => ({ id, type: 'effect', title: toolName, detail: { toolName, kind: 'tool', input, display: { message: toolName }, ...detail }, state, createdAt: UT + at, updatedAt: UT + end, generationStatus: 'completed', sessionId: U1, turnId: TURN });
const done = (structured_content, o = {}) => ({ status: 'completed', outputText: '', output: { type: 'success', content: [], structured_content, ...o } });
const envelope = (status, turnStatus, tokens, at) => ({ format: 'harness.public-session-state/v1', activeCallbacks: [], history: { cursor: { after: null, before: null }, entries: [], range: 'latest' }, turnQueue: { items: [] },
  latestTurn: { id: TURN, status: turnStatus, startedAt: UT, ...(turnStatus === 'completed' ? { completedAt: UT + at } : {}) },
  session: { id: U1, rootSessionId: U1, parentSessionId: null, title: null, titleSource: 'auto', preview: 'Where is the tax computed?', status: status === 'running' ? { type: 'running', active_turn_id: TURN } : { type: status }, createdAt: UT, updatedAt: UT + at, tokenUsage: tokens, contextUsage: { inputTokens: 2000, cachedInputTokens: 1500, outputTokens: 50, totalTokens: 2050 } } });
const WAIT = ueff('effect-wait', 'subagent.wait', { agentName: 'scout-1', timeoutMs: 120000 }, { status: 'running' }, 9000, 9000);
const snapshot = [
  umsg('user-1', 'user', 'Where is the tax computed?', 0),
  { id: 'reasoning-1', type: 'reasoning', text: 'I should run the tests,\nthen ask a scout.', summary: [], createdAt: UT + 1000, updatedAt: UT + 1000, sessionId: U1, turnId: TURN },
  umsg('assistant-1', 'assistant', 'I will run the tests and send a scout.', 1000),
  ueff('effect-search', 'search_tool_functions', { mode: 'best_match' }, done({}), 1000, 1000),
  ueff('effect-bash', 'file_system.bash', { command: 'npm test' }, done({ command: 'npm test', returncode: 1, stdout: '1 failing', stderr: 'boom', was_truncated: false }), 1200, 4200),
  ueff('effect-nospawn', 'subagent.spawn', { agent: 'explore', task: 'Find the tax.' }, done({ type: 'error', error: 'subagent_type_not_found: Unknown subagent type' }), 5000, 5020, { kind: 'subagent', agentName: 'scout-1', childSessionId: null }),
  ueff('effect-spawn', 'subagent.spawn', { agent: 'generic', task: 'Find where the tax is computed. Report the file.' }, done({ type: 'success' }, { _meta: { 'mistral.vibe.subagent': { agentName: 'scout-1', agentType: null, childSessionId: 'child-abc123', generation: 1 } } }), 6000, 6050, { kind: 'subagent', agentName: 'scout-1', childSessionId: 'child-abc123' }),
  ueff('effect-denied', 'file_system.write_file', { path: '/w/tax.md', content: 'x' }, { status: 'failed', outputText: '', error: { code: 'tool_denied', message: 'Tool execution denied by approval policy' }, output: { type: 'failure', content: [] } }, 7000, 7010),
  ueff('effect-edit', 'file_system.search_replace', { file_path: '/w/tax.js', content: [{ old_str: 'rate = 0', new_str: 'rate = 0.2', replace_all: false }] }, done({ file: '/w/tax.js', lines_changed: 1, warnings: [] }), 8000, 8030),
  WAIT,
];
const tokens0 = { inputTokens: 6000, cachedInputTokens: 4000, outputTokens: 300, totalTokens: 6300 }, tokens1 = { inputTokens: 9000, cachedInputTokens: 6500, outputTokens: 420, totalTokens: 9420 };
{
  const sha = require('crypto').createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), g = path.join(UDIR, 'generations', GEN);
  for (const d of [g, path.join(UDIR, 'chunks'), path.join(UDIR, 'journal'), path.join(UDIR, 'generations', '0000000000000004')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(UDIR, 'chunks', sha + '.json'), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(g, 'manifest.json'), JSON.stringify({ manifest_version: 1, generation: GEN, snapshot_sequence: 10, session_id: U1, execution_state: 'running', projection_state: { path: 'projection-state.json', chunks: [sha] }, recovery_journal_segment: { first_sequence: 11, path: 'journal/0000000000000011.jsonl' } }));
  fs.writeFileSync(path.join(g, 'projection-state.json'), JSON.stringify({ projection_state_version: 1, session_id: U1, snapshot_sequence: 10, watermark: 5, snapshot: envelope('running', 'in_progress', tokens0, 9000) }));
  fs.writeFileSync(path.join(g, 'runtime-state.json'), JSON.stringify({ session_metadata: { active_model: 'devstral', cwd: WORK }, children: [] }));
  fs.writeFileSync(path.join(UDIR, 'journal', '0000000000000005.jsonl'), JSON.stringify({ type: 'projection_delta', sequence: 9, payload: { watermark: 4, delta: [{ op: 'append_entry', entry: umsg('assistant-old', 'assistant', 'NEVER SHOWN: before the snapshot', 500) }] } }) + '\n');
  fs.writeFileSync(path.join(UDIR, 'journal', '0000000000000011.jsonl'), '');
  fs.writeFileSync(path.join(UDIR, 'meta.json'), JSON.stringify(metaOf({ start: UT, more: { session_id: U1 } })));
  fs.writeFileSync(path.join(UDIR, 'CURRENT'), JSON.stringify({ generation: GEN, snapshot_sequence: 10, session_id: U1, store_format: 'mistral.vibe.unified-session-store/v1', store_format_minor: 8 }));
  for (const f of ['CURRENT', 'journal/0000000000000011.jsonl', 'journal/0000000000000005.jsonl']) fs.utimesSync(path.join(UDIR, f), (UT + 9000) / 1000, (UT + 9000) / 1000);
}
const claudeDir = path.join(PROJECTS, '-c'); fs.mkdirSync(claudeDir, { recursive: true });
fs.writeFileSync(path.join(claudeDir, 'cc.jsonl'), [{ type: 'user', timestamp: new Date(NOW - 3600e3).toISOString(), message: { role: 'user', content: 'a Claude Code order' } }, { type: 'assistant', timestamp: new Date(NOW - 3599e3).toISOString(), message: { id: 'm1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'A Claude Code answer.' }] } }].map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.utimesSync(path.join(claudeDir, 'cc.jsonl'), (NOW - 3599e3) / 1000, (NOW - 3599e3) / 1000);

test('Vibe sessions are listed with their titles and sub-agents; the Claude Code session is still there', async () => {
  const { port, stop } = await serve();
  try {
    const rows = (await get(port, '/api/sessions')).json(), v = rows.filter((r) => r.proj === '_vibe');
    assert.deepEqual(v.map((r) => [r.id, r.title, r.source, r.agents]), [[S1, 'Fix the cart total', 'vibe', 1], [U1, 'Where is the tax computed?', 'vibe', 1], [S2, 'An older question, with no title.', 'vibe', 0]]);
    assert.equal(v[0].project, 'Mistral Vibe · work/shop');
    assert.deepEqual(rows.filter((r) => r.proj === '-c').map((r) => [r.id, r.title, r.source]), [['cc', 'a Claude Code order', undefined]]);
    const board = (await get(port, '/api/board')).json(), b = board.find((r) => r.id === S1);
    assert.deepEqual([b.proj, b.state, b.subTotal, b.source, b.title], ['_vibe', 'turn', 1, 'vibe', 'Fix the cart total']);   // a plain answer was the last thing written: it is the person's turn
    assert.ok(!board.some((r) => r.id === S2), 'a session of yesterday is not on the board');
    assert.deepEqual((({ state, subActive, subTotal, source, dir }) => [state, subActive, subTotal, source, dir])(board.find((r) => r.id === U1)), ['waiting', 1, 1, 'vibe', WORK.replace(/[^a-zA-Z0-9]/g, '-')]);   // running, and waiting for its sub-agent
  } finally { stop(); }
});

test('a Vibe session becomes the same events as a Claude Code one: lines, tools with their results, a sub-agent with its order and its report, usage', async () => {
  const { port, stop } = await serve();
  try {
    const tl = (await get(port, `/api/session?proj=_vibe&id=${S1}`)).json(), ev = tl.events, real = ev.filter((e) => e.kind !== 'usage');
    assert.deepEqual(tl.agents.map((a) => [a.id, a.name || null, a.type, a.role]), [['main', null, 'main', 'Lead'], [KID, null, 'explore', 'Find every place the cart total is computed']]);
    assert.equal(tl.agents[1].own, undefined, 'explore is a type Vibe ships, not a name');
    assert.deepEqual(real.map((e) => e.agent + ' ' + e.kind), ['user user', 'main say', 'main tools', 'main results', 'main tools', 'main order', 'main results', 'main results', KID + ' tools', KID + ' results', KID + ' report', KID + ' finish', 'main tools', 'main results', 'main results', 'main results', 'main results', 'main say']);
    assert.equal(real[0].text, 'Why is the cart total wrong?');
    assert.equal(real[1].th, 'The total is computed in cart.js.\nI should run the tests first.');
    assert.deepEqual(real[2].tools.map((t) => [t.name, t.arg]), [['Bash', 'npm test']]);
    assert.deepEqual(real[3].items, [{ id: 'c1', err: true, out: '1 failing\nboom' }]);
    assert.deepEqual(real[4].tools.map((t) => t.name), ['Read', 'Grep', 'TodoWrite']);   // reading the todo list is not shown, and the task call is the order
    assert.deepEqual([real[5].to, real[5].toolId, real[5].text, real[5].title], [KID, 'c6', 'Find every place the cart total is computed.\nReport the files.', 'explore']);
    assert.deepEqual([real[10].text, real[10].to], ['Two places: cart.js and checkout.js.', 'main']);
    assert.deepEqual(real[6].items, [{ id: 'c2', err: false, out: 'const total = 0;' }]);
    assert.deepEqual(real[7].items, [{ id: 'c3', err: true, out: 'grep: bad pattern' }]);
    assert.deepEqual(real[12].tools.map((t) => t.name), ['Edit', 'Write', 'WebSearch', 'my_mcp_tool']);
    assert.deepEqual(real.slice(13, 17).map((e) => e.items[0].out), ['replaced 1 occurrence', '7 bytes', 'Use integers.', 'ok: yes']);
    assert.deepEqual([real[17].text, real[17].end], ['The total is fixed: it now sums the items.', 1]);
    // the times: none is written in the file. Everything is between the start of the session and its last write, in order; the sub-agent is at its own times; the command started 20 s before its result
    assert.ok(ev.every((e, i) => e.ts >= START - 1 && e.ts <= END + 5 && (!i || e.ts >= ev[i - 1].ts)), 'in order, inside the session');
    assert.ok(Math.abs(real[5].ts - SUB_START) < 1000, 'the order is given when the sub-agent starts'); assert.ok(Math.abs(real[11].ts - SUB_END) < 1000, 'and it finishes when its file was last written');
    assert.ok(real[8].ts >= SUB_START && real[10].ts <= SUB_END + 5 && real[10].ts < real[11].ts);
    assert.equal(real[3].ts - real[2].tools[0].ts, 20000); assert.equal(real[2].ts, real[2].tools[0].ts);
    assert.equal(real[17].ts, Math.round(END));
    const u = ev.filter((e) => e.kind === 'usage' && e.agent === 'main'), sum = (k) => u.reduce((n, e) => n + e.u[k], 0), last = u[u.length - 1];
    assert.deepEqual([sum('i'), sum('o'), sum('r'), last.u.i + last.u.r, last.model, last.cw], [5000, 700, 4000, 3000, 'devstral', 200000]);   // the totals of the session, and a last line the size of the context now
    const ku = ev.filter((e) => e.kind === 'usage' && e.agent !== 'main'); assert.deepEqual([ku.reduce((n, e) => n + e.u.i + e.u.r, 0), ku.reduce((n, e) => n + e.u.o, 0)], [1000, 50], 'the sub-agent\'s own tokens: Vibe numbers the lines of each agent from 1, the same name in the lead is another message (1.40.0 candidate counted only one of them)');
  } finally { stop(); }
});

test('the live call follows a Vibe session: the newest session wins, a project folder finds it, a new step arrives alone and leaves the earlier times alone', async () => {
  const { port, stop } = await serve(), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const add = (lines) => { fs.appendFileSync(main1, lines.map((l) => JSON.stringify(l)).join('\n') + '\n'); };
    const first = (await get(port, `/api/session?proj=_vibe&id=${S1}`)).json(), before = new Map(first.events.map((e) => [e.k, e.ts]));
    add([user('And the tax?'), asst('Checking the tax.', [['d1', 'bash', { command: 'grep tax -r .' }]]), tool('d1', 'bash', 'stdout: tax.js', { command: 'grep tax -r .', exit_code: 0, stdout: 'tax.js', stderr: '' }, { duration: 0.5 })]);
    await wait(2100);   // the lists are remembered for two seconds
    assert.deepEqual((await get(port, '/api/current')).json().id, S1); assert.equal((await get(port, '/api/current?proj=' + WORK.replace(/[^a-zA-Z0-9]/g, '-'))).json().proj, '_vibe');
    const typedAt = (await get(port, '/api/board')).json().find((r) => r.id === S1).asked; assert.ok(Date.now() - typedAt < 60000, 'a message of this format carries no time: something typed since the last look is dated by the file');
    assert.equal((await get(port, '/api/board')).json().find((r) => r.id === S1).state, 'working');   // a tool result is the last thing written: the agent goes on
    const more = (await get(port, `/api/session?proj=_vibe&id=${S1}&after=${first.seq}&ep=${first.ep}`)).json(), fresh = more.events.filter((e) => !before.has(e.k) && e.kind !== 'usage');
    assert.deepEqual(fresh.map((e) => e.agent + ' ' + e.kind + ' ' + (e.text || (e.tools ? e.tools[0].name : e.items[0].out))), ['user user And the tax?', 'main say Checking the tax.', 'main tools Bash', 'main results tax.js']);
    assert.ok(fresh.every((e) => e.ts > END && e.ts <= Date.now() + 1000), 'the new step is dated between the last write and now');
    const again = (await get(port, `/api/session?proj=_vibe&id=${S1}`)).json(); for (const e of again.events) if (before.has(e.k) && e.kind !== 'usage') assert.equal(e.ts, before.get(e.k), 'an event already shown keeps its time: ' + e.k);
    assert.equal(again.events.find((e) => e.text === 'The total is fixed: it now sums the items.').end, 1);   // the answer that closed the earlier turn still closes it
  } finally { stop(); }
});

test('the current Vibe format: a snapshot, then the journal that follows it. Real times, a tool that failed, a sub-agent known by what the lead did with it', async () => {
  const { port, stop } = await serve(), wait = (ms) => new Promise((r) => setTimeout(r, ms)), line = (e) => e.agent + ' ' + e.kind + (e.to ? '>' + e.to : '');
  try {
    const first = (await get(port, `/api/session?proj=_vibe&id=${U1}`)).json(), ev = first.events.filter((e) => e.kind !== 'usage'), KID = 'child-abc123';
    assert.deepEqual(first.agents.map((a) => [a.id, a.name || null, a.own || null, a.type, a.role]), [['main', null, null, 'main', 'Lead'], [KID, null, 'Scout 1', 'generic', 'Find where the tax is computed']]);   // the name the lead gave it is its own name
    assert.deepEqual(ev.map(line), ['user user', 'main say', 'main tools', 'main results', 'main tools', 'main results', 'main order>' + KID, 'main tools', 'main results', 'main tools', 'main results']);
    assert.deepEqual([ev[0].text, ev[0].ts, ev[1].th, ev[1].end], ['Where is the tax computed?', UT, 'I should run the tests,\nthen ask a scout.', undefined]);   // the times are the ones Vibe wrote
    assert.deepEqual([ev[2].tools, ev[4].tools].map((l) => l.map((t) => [t.name, t.arg, t.ts])), [[['Bash', 'npm test', UT + 1200]], [['subagent.spawn', '', UT + 5000]]]);   // looking up its own tools is not shown; a spawn that failed is a tool call that failed
    assert.deepEqual([ev[3].items, ev[3].ts], [[{ id: 'effect-bash', err: true, out: '1 failing\nboom' }], UT + 4200]);
    assert.deepEqual(ev[5].items, [{ id: 'effect-nospawn', err: true, out: 'subagent_type_not_found: Unknown subagent type' }]);
    assert.deepEqual([ev[6].text, ev[6].title, ev[6].ts], ['Find where the tax is computed. Report the file.', 'scout-1', UT + 6000]);
    assert.deepEqual([ev[7].tools[0].name, ev[9].tools[0].name], ['Write', 'Edit']); assert.deepEqual([ev[8].items[0], ev[10].items[0]], [{ id: 'effect-denied', err: true, out: 'Tool execution denied by approval policy' }, { id: 'effect-edit', err: false, out: '1 lines changed' }]);
    const u0 = first.events.filter((e) => e.kind === 'usage'); assert.deepEqual([u0.reduce((n, e) => n + e.u.i, 0), u0.reduce((n, e) => n + e.u.r, 0), u0.reduce((n, e) => n + e.u.o, 0), u0[u0.length - 1].model], [2000, 4000, 300, 'devstral']);
    // the journal: the wait ends with the sub-agent's answer, the lead says one more thing and stops the sub-agent, and the session goes idle. Around it, what must be ignored
    const J = (sequence, delta) => JSON.stringify({ type: 'projection_delta', sequence, payload: { watermark: sequence, delta } }) + '\n', said = 'The tax is computed in tax.js.';
    fs.appendFileSync(path.join(UDIR, 'journal', '0000000000000011.jsonl'), JSON.stringify({ type: 'action_intent', sequence: 11, payload: { kind: 'tool' } }) + '\n'
      + J(10, [{ op: 'append_entry', entry: umsg('assistant-stale', 'assistant', 'NEVER SHOWN: already in the snapshot', 100) }])
      + J(12, [{ op: 'replace_entry', id: 'effect-wait', entry: { ...WAIT, state: done({ type: 'success', value: said }), updatedAt: UT + 20000 } }, { op: 'append_entry', entry: ueff('effect-msg', 'subagent.send_message', { agentName: 'scout-1', message: 'Thanks. Anything else?' }, done({ type: 'success' }), 21000, 21010) }, { op: 'append_entry', entry: umsg('assistant-tmp', 'assistant', 'NEVER SHOWN: removed below', 21500) }])
      + J(13, [{ op: 'remove_entry', id: 'assistant-tmp' }, { op: 'append_entry', entry: ueff('effect-stop', 'subagent.stop', { agentName: 'scout-1' }, done({ type: 'success' }), 22000, 22040) }, { op: 'append_entry', entry: umsg('assistant-2', 'assistant', 'It is in tax.js; I set the rate.', 23000) }, { op: 'set_envelope', state: envelope('idle', 'completed', tokens1, 23000) }])
      + '{"type":"projection_delta","sequence":14,"payload":{"delta":[{"op":"append_entry","entry":{"id":"half');   // a line still being written
    await wait(2100);
    const more = (await get(port, `/api/session?proj=_vibe&id=${U1}&after=${first.seq}&ep=${first.ep}`)).json(), had = new Set(first.events.map((e) => e.k)), fresh = more.events.filter((e) => !had.has(e.k) && e.kind !== 'usage');
    assert.equal(more.ep, first.ep, 'the same live feed: nothing is loaded again');
    assert.deepEqual(fresh.map((e) => [line(e), e.text || '', e.ts, e.end || 0]), [[KID + ' report>main', said, UT + 20000, 0], ['main order>' + KID, 'Thanks. Anything else?', UT + 21000, 0], [KID + ' finish>main', '', UT + 22040, 0], ['main say', 'It is in tax.js; I set the rate.', UT + 23000, 1]]);
    const all = (await get(port, `/api/session?proj=_vibe&id=${U1}`)).json(), u1 = all.events.filter((e) => e.kind === 'usage');
    assert.ok(!JSON.stringify(all.events).includes('NEVER SHOWN')); assert.deepEqual([u1.reduce((n, e) => n + e.u.i, 0), u1.reduce((n, e) => n + e.u.r, 0), u1.reduce((n, e) => n + e.u.o, 0)], [2500, 6500, 420]);   // the totals Vibe keeps: 9000 in, of which 6500 from the cache
    assert.deepEqual(u0.map((e) => [e.k, e.u]), u1.slice(0, u0.length).map((e) => [e.k, e.u]), 'a line of usage already given out does not change');
    const b = (await get(port, '/api/board')).json().find((r) => r.id === U1); assert.deepEqual([b.state, b.subActive, b.subTotal, b.asked], ['turn', 0, 1, UT]); assert.equal((await get(port, '/api/current?pproj=_vibe&pid=' + U1)).json().id, U1);   // asked: when the person last typed there, which this format dates. The call itself is in the session typed in last, the one of the earlier format above
  } finally { stop(); }
});

test('Vibe can be turned off, and is not looked for when the app is pointed at one folder of Claude Code sessions', () => {
  const vibe = require('../vibe.js'), keep = process.env.AGENT_STANDUP_VIBE, wait = () => { const t = Date.now(); while (Date.now() - t < 2050) {} };
  try {
    assert.equal(vibe.sessions().length, 3);
    process.env.AGENT_STANDUP_VIBE = 'off'; wait(); assert.equal(vibe.home(), null); assert.equal(vibe.sessions().length, 0); assert.equal(vibe.fileOf(S1), null);
    delete process.env.AGENT_STANDUP_VIBE; assert.equal(vibe.home(), null, 'AGENT_STANDUP_PROJECTS is set: only what is asked for is read');
    const projects = process.env.AGENT_STANDUP_PROJECTS; delete process.env.AGENT_STANDUP_PROJECTS; process.env.VIBE_HOME = '/somewhere/vibe'; assert.equal(vibe.home(), '/somewhere/vibe'); delete process.env.VIBE_HOME; assert.equal(vibe.home(), path.join(os.homedir(), '.vibe')); process.env.AGENT_STANDUP_PROJECTS = projects;
  } finally { process.env.AGENT_STANDUP_VIBE = keep; }
});

test('a Vibe session the reader does not expect costs that session at most: the other sessions, of every tool, are still listed', async () => {
  const bad = (id, files) => { const d = path.join(ROOT, 'unified', id); for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), typeof body === 'string' ? body : JSON.stringify(body)); } return d; };
  const cur = (generation) => ({ generation, snapshot_sequence: 1, session_id: 'x' }), man = (chunks, seg = 'journal/1.jsonl') => ({ projection_state: { chunks }, recovery_journal_segment: { path: seg } }), env = { snapshot: { session: { status: { type: 'running' }, title: 'Odd session' } } };
  const odd = [   // entries in shapes Vibe does not write today: each one alone must not stop the others
    { id: 'e1', type: 'effect', detail: { toolName: 'TodoWrite', input: { todos: 'not a list' } }, state: { status: 'completed' }, createdAt: NOW, turnId: 't' },
    { id: 'e2', type: 'effect', detail: { toolName: 'AskUserQuestion', input: { questions: [{ question: 'q', options: null }] } }, state: { status: 'completed' }, createdAt: NOW, turnId: 't' },
    { id: 'e3', type: 'effect', detail: { toolName: 'subagent.spawn', input: null, childSessionId: {} }, state: null, createdAt: 'yesterday', turnId: 't' },
    { id: 'e4', type: 'message', role: 'assistant', content: { not: 'a list' }, createdAt: NOW }, { id: 5, type: 'message' }, null, 'text', { id: 'e6', type: 'effect', detail: 7 },
    { id: 'ok', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Still here.' }], createdAt: NOW, turnId: 't' },
  ];
  const sha = 'a'.repeat(64), dirs = [
    bad('odd-entries', { CURRENT: cur('g1'), 'generations/g1/manifest.json': man([sha]), 'generations/g1/projection-state.json': env, ['chunks/' + sha + '.json']: odd, 'journal/1.jsonl': '{"type":"projection_delta","sequence":2,"payload":{"delta":[null,{"op":"replace_entry"},{"op":"append_entry","entry":7},{"op":"set_history_entries","entries":"x"}]}}\nnot json\n', 'meta.json': 'not json' }),
    bad('no-generation', { CURRENT: cur('missing') }), bad('not-json', { CURRENT: 'not json at all' }), bad('null-current', { CURRENT: 'null' }),
    bad('escapes', { CURRENT: cur('../../../../etc'), 'meta.json': { child_sessions: [{ tool_call_id: 't', agent: 'a', relative_path: '../../../../etc' }], environment: { working_directory: 7 }, title: { not: 'text' } } }),
    bad('bad-pages', { CURRENT: cur('g1'), 'generations/g1/manifest.json': man(['../../x', 'zz', sha], '../../../etc/passwd'), 'generations/g1/projection-state.json': { snapshot: 'text' }, ['chunks/' + sha + '.json']: { not: 'a list' } }),
  ];
  const { port, stop } = await serve(), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await wait(2100);   // the lists are remembered for two seconds
    const list = await get(port, '/api/sessions'), board = await get(port, '/api/board'), cur0 = await get(port, '/api/current');
    assert.deepEqual([list.status, board.status, cur0.status], [200, 200, 200]);
    const rows = list.json(); assert.ok(rows.some((r) => r.proj === '-c' && r.id === 'cc'), 'the Claude Code session'); assert.ok(rows.some((r) => r.id === S1) && rows.some((r) => r.id === U1), 'the sound Vibe sessions');
    for (const id of ['odd-entries', 'no-generation', 'not-json', 'null-current', 'escapes', 'bad-pages']) { const r = await get(port, `/api/session?proj=_vibe&id=${id}`); assert.equal(r.status, 200, id); assert.ok(Array.isArray(r.json().events), id); }
    const tl = (await get(port, '/api/session?proj=_vibe&id=odd-entries')).json(); assert.ok(tl.events.some((e) => e.text === 'Still here.'), 'what can be read of a session with odd entries is shown');
    assert.ok(!JSON.stringify([rows, board.json()]).includes('root:'), 'nothing from outside the Vibe folder');
    assert.equal((await get(port, '/api/session?proj=-c&id=cc')).json().events.length, 2);
  } finally { stop(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
});

test('a Vibe session that says it waits on you needs you as long as the Vibe process that has it open runs; its process gone, it is idle (no “your turn” knock for a Vibe you closed); nothing to tell by (no lease): half an hour, as before', async () => {
  const vibe = require('../vibe.js'), sha = 'b'.repeat(64), ACTIVE = path.join(ROOT, 'active'), mk = (id, type) => { const d = path.join(ROOT, 'unified', id), g = path.join(d, 'generations', 'g1'); for (const x of [g, path.join(d, 'chunks'), path.join(d, 'journal')]) fs.mkdirSync(x, { recursive: true });
    fs.writeFileSync(path.join(d, 'chunks', sha + '.json'), JSON.stringify([umsg('user-1', 'user', 'Delete the old logs?', 0)])); fs.writeFileSync(path.join(d, 'journal', '1.jsonl'), '');
    fs.writeFileSync(path.join(g, 'manifest.json'), JSON.stringify({ projection_state: { chunks: [sha] }, recovery_journal_segment: { path: 'journal/1.jsonl' } })); fs.writeFileSync(path.join(g, 'projection-state.json'), JSON.stringify({ snapshot: { session: { id, status: { type }, title: 'Clean the logs' } } }));
    fs.writeFileSync(path.join(d, 'CURRENT'), JSON.stringify({ generation: 'g1', snapshot_sequence: 1, session_id: id })); return d; };
  const lease = (id, pid) => { fs.mkdirSync(ACTIVE, { recursive: true }); fs.writeFileSync(path.join(ACTIVE, id + '.lock'), ''); fs.writeFileSync(path.join(ACTIVE, id + '.lock.json'), JSON.stringify({ acquired_at: new Date().toISOString(), lease_version: 1, process_id: pid, session_id: id }) + '\n'); };   // as Vibe 2.26 writes it while the session is open
  const gone = require('child_process').spawnSync(process.execPath, ['-e', '']).pid;   // a process that has ended
  const dirs = [mk('blocked-open', 'blocked'), mk('blocked-crashed', 'blocked'), mk('blocked-closed', 'blocked'), mk('running-long', 'running')];
  try {
    await new Promise((r) => setTimeout(r, 2100));   // the lists are remembered for two seconds
    const at = (id, later) => { const r = vibe.row(id), b = vibe.boardRow(r, r.mtime + later); return b.state + (b.sure ? '!' : ''); };
    assert.deepEqual([at('blocked-open', 60e3), at('blocked-open', 45 * 60e3)], ['blocked!', 'idle'], 'no lease folder (a Vibe that keeps none): Vibe\'s word for half an hour, then idle, as before');
    lease('blocked-open', process.pid); lease('blocked-crashed', gone);
    assert.deepEqual([at('blocked-open', 60e3), at('blocked-open', 45 * 60e3), at('blocked-open', 3 * 3600e3), at('blocked-open', 5 * 3600e3)], ['blocked!', 'blocked!', 'blocked!', 'idle'], 'its process runs: an approval or a question left open over lunch is still open, for four hours (a crashed Vibe leaves its lock, and its process number can be reused)');
    assert.deepEqual([at('blocked-crashed', 60e3), at('blocked-crashed', 45 * 60e3)], ['idle', 'idle'], 'its process ended without closing it: no one is there to answer');
    assert.deepEqual([at('blocked-closed', 60e3), at('blocked-closed', 45 * 60e3)], ['idle', 'idle'], 'closed: Vibe took its lease away');
    fs.writeFileSync(path.join(ACTIVE, 'blocked-crashed.lock.json'), '{"lease_ver');   // read while Vibe writes it: not known
    assert.deepEqual([at('blocked-crashed', 60e3), at('blocked-crashed', 45 * 60e3)], ['blocked!', 'idle']);
    assert.deepEqual([at('running-long', 60e3), at('running-long', 45 * 60e3)], ['working', 'idle'], 'quiet for half an hour while at work: idle, as before');
  } finally { for (const d of [...dirs, ACTIVE]) fs.rmSync(d, { recursive: true, force: true }); }
});
