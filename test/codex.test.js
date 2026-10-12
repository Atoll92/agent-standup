// test/codex.test.js: Codex sessions (codex.js) read as a call, next to a Claude Code session that must stay exactly as it was. Made-up rollout files in the two formats, a real server on a free port.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-codex-')), CX = path.join(tmp, 'codex'), PROJECTS = path.join(tmp, 'projects');
process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_KOKORO_DIR = path.join(tmp, 'kokoro'); process.env.AGENT_STANDUP_PROJECTS = PROJECTS; process.env.AGENT_STANDUP_CODEX = CX;
const get = (port, p) => new Promise((res, rej) => http.get({ port, path: p }, (x) => { let b = ''; x.on('data', (d) => { b += d; }); x.on('end', () => res({ status: x.statusCode, json: () => JSON.parse(b) })); }).on('error', rej));
const serve = async () => { const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); return { port: srv.address().port, stop: () => { srv.close(); require('../server.js').shutdown(); } }; };

// ---- the files. Times are a few minutes ago, so the sessions count as recent.
const T0 = Date.now() - 5 * 60e3; let clock = T0, ord = 0;
const at = (ms) => { clock = T0 + ms; }, rec = (type, payload) => JSON.stringify({ timestamp: new Date(clock).toISOString(), ordinal: ++ord, type, payload });
const ev = (payload) => rec('event_msg', payload), ri = (payload) => rec('response_item', payload);
const item = (it, started) => ev({ type: 'item_completed', thread_id: 't', turn_id: 'turn', item: it, ...(started != null ? { started_at_ms: T0 + started } : {}), completed_at_ms: clock });
const NEW = '01a00000-0000-7000-8000-00000000000a', CHILD = '01a00000-0000-7000-8000-00000000000b', OLD = '01a00000-0000-7000-8000-00000000000c', WORK = path.join(os.homedir(), 'work', 'shop');
const fileOf = (id, day = '12') => path.join(CX, 'sessions', '2026', '10', day, `rollout-2026-10-${day}T10-00-00-${id}.jsonl`);
const write = (id, lines, day) => { const f = fileOf(id, day); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, lines.join('\n') + '\n'); return f; };

at(0); const newLines = [
  rec('session_meta', { session_id: NEW, id: NEW, timestamp: new Date(T0).toISOString(), cwd: WORK, originator: 'Codex Desktop', cli_version: '0.158.0', source: 'vscode', thread_source: 'user', base_instructions: { text: 'x'.repeat(90000) }, history_mode: 'paginated' }),   // a first line longer than one read
  ri({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>never shown</permissions instructions>' }] }),
  ri({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>never shown</environment_context>' }] }),
  rec('turn_context', { turn_id: 'turn', cwd: WORK, model: 'gpt-test' }),
  ev({ type: 'task_started', turn_id: 'turn' }),
  (at(1000), item({ type: 'UserMessage', id: 'item-1', content: [{ type: 'text', text: 'Why is the cart total wrong?', text_elements: [] }] })),
  ri({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Why is the cart total wrong?' }] }),   // the same line, raw: must not be said twice
  (at(2000), ri({ type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: '**Looking at the cart**\n\nThe total is computed in two places.' }], encrypted_content: 'zzz' })),
  item({ type: 'Reasoning', id: 'rs_1', summary_text: ['Looking at the cart'], raw_content: [] }),
  (at(3000), item({ type: 'AgentMessage', id: 'msg_1', content: [{ type: 'text', text: 'I will read the cart code first.' }], phase: 'commentary' })),
  ri({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I will read the cart code first.' }], phase: 'commentary' }),
  ri({ type: 'custom_tool_call', id: 'ctc_1', status: 'completed', call_id: 'call_exec_1', name: 'exec', input: 'text(await tools.exec_command({cmd:"cat src/cart.js"}));\n' }),   // the script the model wrote around its command: not shown, the item below is
  (at(6000), item({ type: 'CommandExecution', id: 'call_aaaa01', command: ['/bin/zsh', '-lc', 'cat src/cart.js'], cwd: WORK, parsed_cmd: [{ type: 'read' }], source: 'unified_exec_startup', status: 'completed', aggregated_output: 'export const total = (c) => c.items.length;', exit_code: 0 }, 4000)),
  ri({ type: 'custom_tool_call_output', call_id: 'call_exec_1', output: [{ type: 'input_text', text: 'export const total…' }] }),
  (at(7000), item({ type: 'CommandExecution', id: 'call_aaaa02', command: ['/bin/zsh', '-lc', 'npm test'], status: 'failed', aggregated_output: '1 failing', exit_code: 1 }, 6500)),
  (at(8000), item({ type: 'FileChange', id: 'call_aaaa03', changes: { [path.join(WORK, 'src/cart.js')]: { type: 'update', unified_diff: '@@ -1 +1 @@\n-export const total = (c) => c.items.length;\n+export const total = (c) => c.items.reduce((s, i) => s + i.price, 0);\n', move_path: null }, [path.join(WORK, 'test/cart.test.js')]: { type: 'add', content: 'test("total", () => {});\n' } }, status: 'completed' }, 7500)),
  (at(9000), item({ type: 'Extension', id: 'ext_000001', kind: 'web.search', query: 'reduce sum javascript', action: { type: 'search', query: null, queries: ['reduce sum javascript'] }, results: [{ type: 'result', title: 'Array.prototype.reduce', url: 'https://example.org/reduce' }] }, 8500)),
  ri({ type: 'function_call', id: 'fc_m1', name: 'lookup', namespace: 'mcp__docs', arguments: JSON.stringify({ topic: 'reduce' }), call_id: 'mcp_000001' }),
  (at(9500), item({ type: 'McpToolCall', id: 'mcp_000001', server: 'docs', tool: 'lookup', arguments: { topic: 'reduce' }, status: 'completed', result: { content: [{ type: 'text', text: 'reduce(fn, initial)' }], isError: false } }, 9200)),
  ri({ type: 'function_call_output', call_id: 'mcp_000001', output: [{ type: 'input_text', text: 'the same answer, raw' }] }),   // real files carry the raw call and its raw output under the item's id
  (at(9600), item({ type: 'McpToolCall', id: 'mcp_000002', server: 'docs', tool: 'lookup', arguments: { topic: 'nope' }, status: 'failed', result: { content: [{ type: 'text', text: 'no such topic' }], isError: true } }, 9550)),
  ri({ type: 'function_call_output', call_id: 'mcp_000002', output: [{ type: 'input_text', text: 'no such topic' }] }),
  (at(9800), item({ type: 'ImageView', id: 'img_000001', path: path.join(WORK, 'shot.png') })),
  ri({ type: 'function_call', id: 'fc_1', name: 'request_user_input_async', arguments: JSON.stringify({ questions: [{ title: 'Ship it now?' }] }), call_id: 'call_ask_01' }),
  ev({ type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 50, total_tokens: 1050 }, last_token_usage: { input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 0, output_tokens: 50, total_tokens: 1050 }, model_context_window: 258400 }, rate_limits: {} }),
  ev({ type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 50, total_tokens: 1050 }, last_token_usage: { input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 0, output_tokens: 50, total_tokens: 1050 } }, rate_limits: { changed: true } }),   // only the limits moved: not counted again
  (at(11000), item({ type: 'AgentMessage', id: 'msg_2', content: [{ type: 'text', text: 'Fixed: the total now adds the prices.' }], phase: 'final_answer' })),
  ev({ type: 'task_complete', turn_id: 'turn', last_agent_message: 'Fixed: the total now adds the prices.' }),
];
write(NEW, newLines);
at(5000); write(CHILD, [   // Codex's own review of a command, started by the session above: not a session
  rec('session_meta', { session_id: NEW, id: CHILD, timestamp: new Date(T0).toISOString(), cwd: WORK, originator: 'Codex Desktop', source: { subagent: { other: 'guardian' } }, thread_source: 'guardian_review', parent_thread_id: NEW }),
  item({ type: 'UserMessage', id: 'item-1', content: [{ type: 'text', text: 'Review this command' }] }),
  item({ type: 'AgentMessage', id: 'msg_1', content: [{ type: 'text', text: '{"outcome":"allow"}' }], phase: 'final_answer' }),
]);
ord = 0; const bare = (type, payload) => JSON.stringify({ timestamp: new Date(clock).toISOString(), type, payload });   // the earlier format: no item lines
at(-60000); write(OLD, [
  bare('session_meta', { id: OLD, timestamp: new Date(clock).toISOString(), cwd: path.join(os.homedir(), 'other'), originator: 'codex_cli_rs', cli_version: '0.45.0' }),
  bare('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>never shown</environment_context>' }] }),
  bare('event_msg', { type: 'user_message', message: 'Rename the helper' }),
  bare('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Rename the helper' }] }),
  bare('event_msg', { type: 'agent_message', message: 'On it.' }),
  bare('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'On it.' }] }),
  bare('response_item', { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'grep -rn helper src'] }), call_id: 'call_old_01' }),
  bare('response_item', { type: 'function_call_output', call_id: 'call_old_01', output: JSON.stringify({ output: 'src/a.js:1:helper', metadata: { exit_code: 0 } }) }),
  bare('response_item', { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'false'] }), call_id: 'call_old_02' }),
  bare('response_item', { type: 'function_call_output', call_id: 'call_old_02', output: JSON.stringify({ output: '', metadata: { exit_code: 1 } }) }),
  bare('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call_old_03', input: '*** Begin Patch\n*** Update File: src/a.js\n@@\n-helper()\n+assist()\n*** Add File: src/b.js\n+export {};\n*** End Patch' }),
  bare('response_item', { type: 'custom_tool_call_output', call_id: 'call_old_03', output: 'Success' }),
  bare('response_item', { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'Rename', status: 'completed' }, { step: 'Run tests', status: 'in_progress' }] }), call_id: 'call_old_04' }),
  bare('response_item', { type: 'function_call_output', call_id: 'call_old_04', output: 'Plan updated' }),
  bare('event_msg', { type: 'agent_message', message: 'Renamed to assist.' }),
  bare('event_msg', { type: 'task_complete', last_agent_message: 'Renamed to assist.' }),
], '11');
fs.writeFileSync(path.join(CX, 'session_index.jsonl'), JSON.stringify({ id: NEW, thread_name: 'First name', updated_at: 'x' }) + '\n' + JSON.stringify({ id: NEW, thread_name: 'Fix the cart total', updated_at: 'y' }) + '\n');
// one Claude Code session beside them, older than the Codex ones
const CL = path.join(PROJECTS, '-p'); fs.mkdirSync(CL, { recursive: true });
const cl = (o) => JSON.stringify({ timestamp: new Date(T0 - 3600e3).toISOString(), ...o });
fs.writeFileSync(path.join(CL, 'c1.jsonl'), [cl({ type: 'user', message: { role: 'user', content: 'hello claude' } }), cl({ type: 'assistant', message: { id: 'm1', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'hello' }] } })].join('\n') + '\n');
const MANY = path.join(PROJECTS, '-q'), old2d = new Date(T0 - 48 * 3600e3); fs.mkdirSync(MANY, { recursive: true });   // 64 more Claude Code sessions, two days old
for (let i = 0; i < 64; i++) { const f = path.join(MANY, 'm' + i + '.jsonl'); fs.writeFileSync(f, cl({ type: 'user', message: { role: 'user', content: 'old ' + i } }) + '\n'); fs.utimesSync(f, old2d, old2d); }
const old1h = new Date(T0 - 3600e3); fs.utimesSync(path.join(CL, 'c1.jsonl'), old1h, old1h); fs.utimesSync(fileOf(OLD, '11'), new Date(T0), new Date(T0));

const flat = (tl) => tl.events.filter((e) => e.kind === 'tools').flatMap((e) => e.tools), results = (tl) => Object.fromEntries(tl.events.filter((e) => e.kind === 'results').flatMap((e) => e.items).map((i) => [i.id, i]));

test('Codex sessions are listed with their names; a thread started by another thread is not a session; the Claude Code session is still there', async () => {
  const s = await serve();
  try {
    const rows = (await get(s.port, '/api/sessions')).json(), cx = rows.filter((r) => r.proj === '_codex');
    assert.deepEqual(cx.map((r) => r.id), [NEW, OLD]);
    assert.equal(cx[0].title, 'Fix the cart total'); assert.equal(cx[1].title, 'Rename the helper');   // the name Codex gave it (the last one); else the first thing typed
    assert.equal(cx[0].project, 'Codex · work/shop'); assert.equal(cx[0].agents, 0);
    assert.equal(rows.filter((r) => r.proj !== '_codex').length, 60); assert.equal(rows.length, 62);   // the 60 Claude Code sessions the list always held, and the Codex ones beside them
    const c = rows.find((r) => r.proj === '-p'); assert.equal(c.id, 'c1'); assert.equal(c.title, 'hello claude'); assert.equal(c.source, undefined);
    const tl = (await get(s.port, '/api/session?proj=-p&id=c1')).json();
    assert.deepEqual(tl.agents, [{ id: 'main', role: 'Lead', type: 'main' }]); assert.deepEqual(tl.events.map((e) => e.kind + ':' + e.text), ['user:hello claude', 'say:hello']);
    assert.equal((await get(s.port, '/api/session?proj=_codex&id=' + CHILD)).status, 200);   // readable when asked for by id, never offered
    assert.equal((await get(s.port, '/api/session?proj=_codex&id=01a00000-0000-7000-8000-0000000000ff')).status, 404);
  } finally { s.stop(); }
});

test('a Codex session becomes the same events as a Claude Code one: lines, commands with their output, file changes, searches, a question, the end of the turn', async () => {
  const s = await serve();
  try {
    const tl = (await get(s.port, '/api/session?proj=_codex&id=' + NEW)).json();
    assert.deepEqual(tl.agents, [{ id: 'main', role: 'Lead', type: 'main', name: 'Codex' }]);
    const talk = tl.events.filter((e) => e.kind === 'user' || e.kind === 'say').map((e) => e.agent + ':' + e.text);
    assert.deepEqual(talk, ['user:Why is the cart total wrong?', 'main:I will read the cart code first.', 'main:Fixed: the total now adds the prices.']);   // each line once, nothing of what the harness wraps around them
    const first = tl.events.find((e) => e.kind === 'say'), last = tl.events.filter((e) => e.kind === 'say').pop();
    assert.equal(first.th, 'Looking at the cart\nThe total is computed in two places.'); assert.equal(first.end, undefined); assert.equal(last.end, 1);
    const tools = flat(tl), res = results(tl);
    assert.deepEqual(tools.map((t) => t.name), ['Bash', 'Bash', 'Edit', 'Write', 'WebSearch', 'mcp__docs__lookup', 'mcp__docs__lookup', 'Read', 'AskUserQuestion']);
    const answers = tl.events.filter((e) => e.kind === 'results').flatMap((e) => e.items).map((i) => i.id);
    assert.deepEqual(answers, ['call_aaaa01', 'call_aaaa02', 'call_aaaa03', 'call_aaaa03:1', 'ext_000001', 'mcp_000001', 'mcp_000002', 'img_000001']);   // every call that is over is answered, once: a file change left unanswered reads as "waiting for your approval" in the live call. Only the question is still open
    assert.equal(res.mcp_000002.err, true); assert.equal(res.mcp_000002.out, 'no such topic');   // and the raw output under the same id does not answer it again, without its failure
    assert.deepEqual(tools[0].d, { kind: 'cmd', text: 'cat src/cart.js', note: '' }); assert.equal(res.call_aaaa01.out, 'export const total = (c) => c.items.length;'); assert.equal(res.call_aaaa01.err, false);
    assert.equal(res.call_aaaa02.err, true); assert.equal(res.call_aaaa02.out, '1 failing');
    assert.equal(tools[2].d.kind, 'edit'); assert.match(tools[2].d.file, /src\/cart\.js$/); assert.equal(tools[2].d.old, 'export const total = (c) => c.items.length;'); assert.match(tools[2].d.new, /reduce/);
    assert.equal(tools[3].d.kind, 'write'); assert.match(tools[3].d.file, /cart\.test\.js$/); assert.match(tools[3].d.text, /^test\("total"/);
    assert.deepEqual(tools[4].d, { kind: 'web', query: 'reduce sum javascript' }); assert.match(res.ext_000001.out, /Array\.prototype\.reduce · https:\/\/example\.org\/reduce/);
    assert.equal(tools[5].d.what, 'mcp'); assert.equal(res.mcp_000001.out, 'reduce(fn, initial)');
    assert.equal(tools[7].d.kind, 'read'); assert.match(tools[8].d.text, /Ship it now\?/);
    assert.equal(new Set(tools.map((t) => t.id)).size, tools.length);
    const cmd = tl.events.find((e) => e.kind === 'tools' && e.tools[0].id === 'call_aaaa01'); assert.equal(Math.round(cmd.t / 1000), 3);   // placed when it started (4 s), 3 s after the first line
    const use = tl.events.filter((e) => e.kind === 'usage'); assert.equal(use.length, 1); assert.deepEqual(use[0].u, { i: 400, o: 50, r: 600, w: 0 }); assert.equal(use[0].model, 'gpt-test'); assert.equal(use[0].cw, 258400);
    for (let i = 1; i < tl.events.length; i++) assert.ok(tl.events[i].t >= tl.events[i - 1].t);
  } finally { s.stop(); }
});

test('the earlier Codex format is read too: messages, shell calls with their exit code, a patch, a plan', async () => {
  const s = await serve();
  try {
    const tl = (await get(s.port, '/api/session?proj=_codex&id=' + OLD)).json(), tools = flat(tl), res = results(tl);
    assert.deepEqual(tl.events.filter((e) => e.kind === 'user' || e.kind === 'say').map((e) => e.agent + ':' + e.text), ['user:Rename the helper', 'main:On it.', 'main:Renamed to assist.']);
    assert.deepEqual(tools.map((t) => t.name), ['Bash', 'Bash', 'Edit', 'Write', 'TodoWrite']); assert.equal(res['call_old_03:1'].out, '');   // the second file of a patch is answered with the first
    assert.equal(tools[0].d.text, 'grep -rn helper src'); assert.equal(res.call_old_01.out, 'src/a.js:1:helper'); assert.equal(res.call_old_01.err, false); assert.equal(res.call_old_02.err, true);
    assert.deepEqual([tools[2].d.file, tools[2].d.old, tools[2].d.new], ['src/a.js', 'helper()', 'assist()']); assert.deepEqual([tools[3].d.file, tools[3].d.text], ['src/b.js', 'export {};']);
    assert.deepEqual(tools[4].d.items, [{ c: 'Rename', s: 'completed' }, { c: 'Run tests', s: 'in_progress' }]); assert.equal(res.call_old_04, undefined);
    assert.equal(tl.events.filter((e) => e.kind === 'say').pop().end, 1);   // no "final answer" mark in this format: the end of the task closes the turn
  } finally { s.stop(); }
});

test('the live call follows a Codex session: the newest session wins, a project folder finds its Codex sessions, and new lines arrive alone', async () => {
  const s = await serve();
  try {
    const cur = (await get(s.port, '/api/current')).json(); assert.deepEqual([cur.proj, cur.id], ['_codex', NEW]);
    const key = WORK.replace(/[^a-zA-Z0-9]/g, '-'), q = encodeURIComponent;
    assert.equal((await get(s.port, '/api/current?proj=' + q(key))).json().id, NEW);                                   // asked for by the folder it was started in, as the editor does
    assert.equal((await get(s.port, '/api/current?proj=' + q(key.replace(/-shop$/, '')))).json().id, NEW);             // or by a folder above it
    assert.equal((await get(s.port, '/api/current?proj=-p')).json().id, 'c1');                                         // a Claude Code project still gets its own session
    assert.equal((await get(s.port, '/api/current?proj=_codex&id=' + OLD)).json().id, OLD);                            // pinned
    const board = (await get(s.port, '/api/board')).json(), row = board.find((r) => r.id === NEW);
    assert.deepEqual([row.proj, row.state, row.title, row.dir], ['_codex', 'turn', 'Fix the cart total', key]); assert.ok(!board.some((r) => r.id === CHILD));
    const full = (await get(s.port, '/api/session?proj=_codex&id=' + NEW)).json(), keys = full.events.map((e) => e.k);
    at(20000); fs.appendFileSync(fileOf(NEW), [ev({ type: 'task_started', turn_id: 'turn2' }), item({ type: 'UserMessage', id: 'item-9', content: [{ type: 'text', text: '# Files mentioned by the user:\n\n## shot.png: /tmp/shot.png\n\n## My request:\n<send_user_message_question_reply>Yes, ship it</send_user_message_question_reply>' }] }), (at(21000), item({ type: 'AgentMessage', id: 'msg_9', content: [{ type: 'text', text: 'Shipping.' }], phase: 'commentary' }))].join('\n') + '\n');
    await new Promise((r) => setTimeout(r, 1300));   // past the pauses in which a scan and a board are reused
    const more = (await get(s.port, `/api/session?proj=_codex&id=${NEW}&after=${full.seq}&ep=${full.ep}`)).json();
    assert.deepEqual(more.events.map((e) => e.kind + ':' + e.text), ['user:Yes, ship it', 'say:Shipping.']); assert.ok(more.events.every((e) => !keys.includes(e.k)));
    await new Promise((r) => setTimeout(r, 1300));
    assert.equal((await get(s.port, '/api/board')).json().find((r) => r.id === NEW).state, 'working');   // a turn is open again
  } finally { s.stop(); }
});

test('Codex can be turned off, and is not looked for when the app is pointed at one folder of Claude Code sessions', () => {
  const { createCodex } = require('../codex.js'), { codexHomeFromEnv } = require('../core/config');
  const look = () => createCodex({ home: CX, scanTtlMs: 0 });   // 0: the files are looked at again on every call, as a poll two seconds later would
  const on = look();
  assert.equal(on.sessions().length, 2);
  const HALF = '01a00000-0000-7000-8000-00000000000d', meta = JSON.stringify({ timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: HALF, cwd: WORK, parent_thread_id: NEW } });
  fs.writeFileSync(fileOf(HALF), meta.slice(0, 90)); const t = new Date(Date.now() + 5000); fs.utimesSync(fileOf(HALF), t, t);   // a file caught while its first line is being written
  assert.equal(on.sessions().length, 2);
  fs.writeFileSync(fileOf(HALF), meta + '\n');
  assert.equal(on.sessions().length, 2); assert.equal(on.inProject(HALF, WORK.replace(/[^a-zA-Z0-9]/g, '-')), true);   // read again once whole (the half line was not kept): still not a session (another thread started it), and its folder is known
  fs.unlinkSync(fileOf(HALF));

  const off = createCodex({ home: null });
  assert.equal(off.home, null); assert.deepEqual(off.sessions(), []); assert.equal(off.fileOf(NEW), null);

  // Which of the two the app makes is the environment's to say.
  for (const v of ['off', 'OFF', '0', 'no', 'false', '', '  ']) assert.equal(codexHomeFromEnv({ AGENT_STANDUP_CODEX: v }), null, JSON.stringify(v));
  assert.equal(codexHomeFromEnv({ AGENT_STANDUP_CODEX: CX }), CX);
  assert.equal(codexHomeFromEnv({ AGENT_STANDUP_PROJECTS: '/x' }), null, 'pointed at one folder of Claude Code sessions: the real ~/.codex is left alone');
  assert.equal(codexHomeFromEnv({ AGENT_STANDUP_PROJECTS: '/x', AGENT_STANDUP_CODEX: CX }), CX, '...unless Codex is asked for too');
  assert.equal(codexHomeFromEnv({ CODEX_HOME: '/h' }), '/h');
  assert.equal(codexHomeFromEnv({}), path.join(os.homedir(), '.codex'));
});
