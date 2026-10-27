// Synthetic Codex thread-spawn rollouts: children share their root's call, never the session picker.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), zlib = require('zlib');
const reports = path.join(__dirname, '..', 'reports'); fs.mkdirSync(reports, { recursive: true });
const tmp = fs.mkdtempSync(path.join(reports, 'codex-subagents-')), CX = path.join(tmp, 'codex'), WORK = path.join(os.homedir(), 'work', 'synthetic-subagents');
process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_PROJECTS = path.join(tmp, 'projects'); process.env.AGENT_STANDUP_CODEX = CX;
process.env.AGENT_STANDUP_KOKORO_DIR = path.join(tmp, 'kokoro'); process.env.AGENT_STANDUP_CHARACTERS = path.join(tmp, 'characters'); process.env.AGENT_STANDUP_PACKS = path.join(tmp, 'packs');
process.env.AGENT_STANDUP_CC_SESSIONS = path.join(tmp, 'cc-sessions'); process.env.AGENT_STANDUP_COWORK = 'off'; process.env.AGENT_STANDUP_VIBE = 'off';
const T = Date.now() - 30000, id = (n) => '01a10000-0000-7000-8000-' + String(n).padStart(12, '0');
const ROOT = id(1), SCOUT = id(2), BUILDER = id(3), NESTED = id(4), GUARDIAN = id(5), LIVE = id(6), LIVE_CHILD = id(7), LATE = id(8), FORK = id(9), FORK_CHILD = id(10), COMPRESSED = id(11), ZCHILD = id(12);
const line = (ms, type, payload) => JSON.stringify({ timestamp: new Date(T + ms).toISOString(), type, payload });
const ev = (ms, payload) => line(ms, 'event_msg', payload);
const meta = (thread, ms, parent, task, nickname, topLevel = true) => line(ms, 'session_meta', {
  id: thread, session_id: thread, timestamp: new Date(T + ms).toISOString(), cwd: WORK, originator: 'Codex Desktop',
  source: parent ? { subagent: { thread_spawn: { parent_thread_id: parent, depth: parent === ROOT ? 1 : 2, agent_path: '/root/' + task, agent_nickname: nickname, agent_role: 'worker' } } } : 'vscode',
  ...(parent && topLevel ? { parent_thread_id: parent } : {}), ...(parent ? { agent_path: '/root/' + task, agent_nickname: nickname, agent_role: 'worker' } : {}),
});
const user = (ms, text) => ev(ms, { type: 'item_completed', item: { type: 'UserMessage', id: 'user-' + ms, content: [{ type: 'text', text }] } });
const say = (ms, text) => ev(ms, { type: 'item_completed', item: { type: 'AgentMessage', id: 'say-' + ms, content: [{ type: 'text', text }], phase: 'commentary' } });
const command = (ms, toolId, text, output) => ev(ms, { type: 'item_completed', started_at_ms: T + ms - 100, item: { type: 'CommandExecution', id: toolId, command: ['/bin/zsh', '-lc', text], status: 'completed', aggregated_output: output, exit_code: 0 } });
const usage = (ms, input, cached, output) => ev(ms, { type: 'token_count', info: { total_token_usage: { total_tokens: input + output }, last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } });
const fileOf = (thread) => path.join(CX, 'sessions', '2026', '10', '25', `rollout-2026-10-25T10-00-00-${thread}.jsonl`);
const write = (thread, lines) => { const f = fileOf(thread); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, lines.join('\n') + '\n'); return f; };
const append = (thread, lines) => fs.appendFileSync(fileOf(thread), lines.join('\n') + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (port, route) => new Promise((resolve, reject) => http.get({ port, path: route }, (r) => { let text = ''; r.on('data', (b) => { text += b; }); r.on('end', () => { try { assert.equal(r.statusCode, 200, route); resolve(JSON.parse(text)); } catch (e) { reject(e); } }); }).on('error', reject));
const route = (thread) => '/api/session?proj=_codex&id=' + thread;
const serve = async () => { const server = require('../server.js'), s = server.start(0); await new Promise((r) => s.once('listening', r)); return { port: s.address().port, stop: () => { s.close(); server.shutdown(); } }; };

write(ROOT, [meta(ROOT, 0), user(100, 'Inspect and repair the synthetic cart.'), say(200, 'I will split the work.')]);
write(SCOUT, [meta(SCOUT, 1000, ROOT, 'scout', 'Scout'), user(1100, 'Find the cart calculation.'), command(1400, 'scout-read', 'cat cart.js', 'const total = 0;'), usage(1500, 100, 20, 5), say(1800, 'The calculation is in cart.js.'), ev(1900, { type: 'task_complete' })]);
// The nested source carries the parent even when top-level parent_thread_id is absent.
write(BUILDER, [meta(BUILDER, 2000, ROOT, 'builder', 'Builder', false), line(2100, 'response_item', { type: 'reasoning', encrypted_content: 'synthetic-unreadable-prompt' }), command(2300, 'builder-test', 'npm test', 'all tests pass'), usage(2400, 200, 50, 10), say(2600, 'The repair is ready.')]);
write(NESTED, [meta(NESTED, 3000, BUILDER, 'builder/check', 'Checker'), user(3100, 'Check the repaired calculation.'), command(3300, 'check-read', 'cat test/cart.test.js', 'synthetic assertion'), usage(3400, 40, 0, 3), say(3600, 'The repaired calculation passes.'), ev(3700, { type: 'turn_complete' })]);
write(GUARDIAN, [line(4000, 'session_meta', { id: GUARDIAN, timestamp: new Date(T + 4000).toISOString(), cwd: WORK, parent_thread_id: ROOT, source: { subagent: { other: 'guardian' } } }), user(4100, 'GUARDIAN MUST STAY HIDDEN'), say(4200, 'GUARDIAN MUST STAY HIDDEN'), usage(4300, 9999, 0, 999)]);
write(LIVE, [meta(LIVE, 5000), user(5100, 'Follow the synthetic worker.')]);
write(LIVE_CHILD, [meta(LIVE_CHILD, 6000, LIVE, 'live_worker', 'Live worker'), user(6100, 'Inspect the live fixture.'), say(6200, 'Still inspecting.')]);
write(FORK, [meta(FORK, 7000), user(7100, 'Check the fork boundary.')]);
write(FORK_CHILD, [meta(FORK_CHILD, 10000, FORK, 'fork_check', 'Fork checker'), user(7100, 'INHERITED USER MUST STAY HIDDEN'), command(7200, 'inherited-command', 'echo inherited', 'INHERITED RESULT MUST STAY HIDDEN'), usage(7300, 9000, 0, 900), say(7400, 'INHERITED ANSWER MUST STAY HIDDEN'), ev(7500, { type: 'task_complete' }), user(10100, 'Check only the new branch.'), command(10300, 'fresh-command', 'echo fresh', 'fresh result'), usage(10400, 30, 10, 2), say(10500, 'New branch checked.'), ev(10600, { type: 'task_complete' })]);
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('two Codex workers and a nested worker share the root call with their own tools, usage, reports and lifecycle', async () => {
  const s = await serve();
  try {
    const tl = await get(s.port, route(ROOT)), agents = new Map(tl.agents.map((a) => [a.id, a]));
    assert.deepEqual([...agents.keys()].sort(), ['main', SCOUT, BUILDER, NESTED].sort());
    for (const [thread, own, role] of [[SCOUT, 'Scout', 'scout'], [BUILDER, 'Builder', 'builder'], [NESTED, 'Checker', 'check']]) assert.deepEqual([agents.get(thread).own, agents.get(thread).role], [own, role]);
    const orders = tl.events.filter((e) => e.kind === 'order');
    assert.deepEqual(orders.map((e) => [e.agent, e.to, e.ts]), [['main', SCOUT, T + 1000], ['main', BUILDER, T + 2000], [BUILDER, NESTED, T + 3000]]);
    assert.equal(orders[0].text, 'Find the cart calculation.'); assert.match(orders[1].text, /builder/i); assert.equal(orders[2].text, 'Check the repaired calculation.');
    for (const [thread, toolId, out] of [[SCOUT, 'scout-read', 'const total = 0;'], [BUILDER, 'builder-test', 'all tests pass'], [NESTED, 'check-read', 'synthetic assertion']]) {
      assert.ok(tl.events.some((e) => e.agent === thread && e.kind === 'tools' && e.tools.some((t) => t.id === toolId)));
      assert.ok(tl.events.some((e) => e.agent === thread && e.kind === 'results' && e.items.some((i) => i.id === toolId && i.out === out)));
    }
    assert.deepEqual(tl.events.filter((e) => e.kind === 'report').map((e) => [e.agent, e.to, e.text]), [[SCOUT, 'main', 'The calculation is in cart.js.'], [NESTED, BUILDER, 'The repaired calculation passes.']]);
    assert.deepEqual(tl.events.filter((e) => e.kind === 'finish').map((e) => [e.agent, e.to]), [[SCOUT, 'main'], [NESTED, BUILDER]]);
    assert.ok(tl.events.some((e) => e.agent === BUILDER && e.kind === 'say' && e.text === 'The repair is ready.'), 'a worker still running keeps its commentary and has no premature finish');
    assert.deepEqual(tl.events.filter((e) => e.kind === 'usage').map((e) => [e.agent, e.u.i, e.u.r, e.u.o]), [[SCOUT, 80, 20, 5], [BUILDER, 150, 50, 10], [NESTED, 40, 0, 3]]);
    assert.ok(!JSON.stringify(tl).includes('GUARDIAN MUST STAY HIDDEN')); assert.ok(!tl.events.some((e) => e.kind === 'user' && /calculation|branch/.test(e.text || '')), 'worker task prompts are orders, not new human messages');
  } finally { s.stop(); }
});

test('the picker and board list only root Codex sessions and count finished and live descendants', async () => {
  const s = await serve();
  try {
    const rows = (await get(s.port, '/api/sessions')).filter((r) => r.proj === '_codex'), board = (await get(s.port, '/api/board')).filter((r) => r.proj === '_codex');
    assert.deepEqual(rows.map((r) => r.id).sort(), [ROOT, LIVE, FORK].sort()); assert.deepEqual(board.map((r) => r.id).sort(), [ROOT, LIVE, FORK].sort());
    const root = board.find((r) => r.id === ROOT), live = board.find((r) => r.id === LIVE);
    assert.deepEqual([root.subTotal, root.subActive], [3, 1]); assert.deepEqual([live.subTotal, live.subActive], [1, 1]);
    const codex = require('../codex.js'), all = codex.sessions(80).map((r) => r.id); assert.deepEqual(codex.sessions(2).map((r) => r.id), all.slice(0, 2), 'a limit stops the list without changing its order'); assert.equal(codex.subCount(ROOT), 3);
  } finally { s.stop(); }
});

test('child-only appends and a newly discovered child reach the existing live feed once', async () => {
  const s = await serve();
  try {
    const first = await get(s.port, route(LIVE)), before = new Map(first.events.map((e) => [e.k, e.ts]));
    append(LIVE_CHILD, [command(12000, 'live-command', 'echo live', 'live result'), say(12100, 'The live inspection is complete.'), ev(12200, { type: 'task_complete' })]);
    await wait(2100);
    const more = await get(s.port, `${route(LIVE)}&after=${first.seq}&ep=${first.ep}`);
    assert.equal(more.ep, first.ep); assert.ok(more.events.some((e) => e.agent === LIVE_CHILD && e.kind === 'report' && e.text === 'The live inspection is complete.')); assert.ok(more.events.some((e) => e.agent === LIVE_CHILD && e.kind === 'finish'));
    assert.ok(more.events.every((e) => !before.has(e.k)), 'only fresh events are delivered');
    write(LATE, [meta(LATE, 13000, LIVE, 'late_worker', 'Late worker'), user(13100, 'Check a late discovery.'), command(13300, 'late-command', 'echo late', 'late result')]);
    await wait(2100);
    const late = await get(s.port, `${route(LIVE)}&after=${more.seq}&ep=${more.ep}`);
    assert.equal(late.ep, first.ep); assert.ok(late.agents.some((a) => a.id === LATE)); assert.ok(late.events.some((e) => e.kind === 'order' && e.agent === 'main' && e.to === LATE)); assert.ok(late.events.some((e) => e.agent === LATE && e.kind === 'results'));
    const again = await get(s.port, `${route(LIVE)}&after=${late.seq}&ep=${late.ep}`); assert.deepEqual(again.events, []);
    const all = await get(s.port, route(LIVE)); for (const e of all.events) if (before.has(e.k)) assert.equal(e.ts, before.get(e.k));
    const row = (await get(s.port, '/api/board')).find((r) => r.id === LIVE); assert.deepEqual([row.subTotal, row.subActive], [2, 1]);
  } finally { s.stop(); }
});

test('a forked worker excludes inherited history and usage timestamped before its own birth', async () => {
  const s = await serve();
  try {
    const tl = await get(s.port, route(FORK));
    assert.ok(tl.agents.some((a) => a.id === FORK_CHILD)); assert.ok(!JSON.stringify(tl.events).includes('INHERITED')); assert.ok(!JSON.stringify(tl.events).includes('inherited-command'));
    const order = tl.events.find((e) => e.kind === 'order' && e.to === FORK_CHILD); assert.ok(order, 'the new branch has its own task order'); assert.equal(order.text, 'Check only the new branch.'); assert.equal(order.ts, T + 10000);
    assert.ok(tl.events.some((e) => e.agent === FORK_CHILD && e.kind === 'results' && e.items[0].out === 'fresh result'));
    assert.deepEqual(tl.events.filter((e) => e.kind === 'usage').map((e) => [e.agent, e.u]), [[FORK_CHILD, { i: 20, o: 2, r: 10, w: 0 }]]);
    assert.equal(tl.events.filter((e) => e.agent === FORK_CHILD && e.kind === 'finish').length, 1);
  } finally { s.stop(); }
});

test('a compressed Codex worker is attributed to its parent like a plain rollout', { skip: typeof zlib.zstdCompressSync !== 'function' && 'this Node has no zstd' }, async () => {
  write(COMPRESSED, [meta(COMPRESSED, 14000), user(14100, 'Read the compressed worker.')]);
  const plain = write(ZCHILD, [meta(ZCHILD, 15000, COMPRESSED, 'archive_check', 'Archive checker'), user(15100, 'Inspect the archived fixture.'), command(15300, 'archive-command', 'echo archived', 'archived result'), usage(15400, 50, 15, 4), say(15500, 'Archived fixture checked.'), ev(15600, { type: 'task_complete' })]);
  fs.writeFileSync(plain + '.zst', zlib.zstdCompressSync(fs.readFileSync(plain))); fs.unlinkSync(plain);
  await wait(2100);
  const s = await serve();
  try {
    // Compressed metadata is scanned in the background, as for the existing Codex zstd tests.
    const codex = require('../codex.js'); let tl;
    for (let n = 0; n < 100; n++) { codex.sessions(500); tl = await get(s.port, route(COMPRESSED)); if (tl.agents.some((a) => a.id === ZCHILD)) break; await wait(20); }
    assert.ok(tl.agents.some((a) => a.id === ZCHILD && a.own === 'Archive checker'));
    const listed = codex.subFiles(COMPRESSED).find((x) => x.aid === ZCHILD); assert.ok(listed && listed.zst && !('st' in listed), 'listing a compressed child does not decompress it');
    assert.ok(tl.events.some((e) => e.agent === ZCHILD && e.kind === 'results' && e.items[0].out === 'archived result'));
    assert.ok(tl.events.some((e) => e.agent === ZCHILD && e.kind === 'report' && e.to === 'main' && e.text === 'Archived fixture checked.'));
    assert.deepEqual(tl.events.filter((e) => e.kind === 'usage').map((e) => [e.agent, e.u]), [[ZCHILD, { i: 35, o: 4, r: 15, w: 0 }]]);
    const rows = (await get(s.port, '/api/sessions')).filter((r) => r.proj === '_codex'); assert.ok(rows.some((r) => r.id === COMPRESSED)); assert.ok(!rows.some((r) => r.id === ZCHILD));
  } finally { s.stop(); }
});

test('a child screenshot is served in its root call and cannot be fetched through an unrelated root', async () => {
  const parent = id(13), child = id(14), unrelated = id(15), png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  write(parent, [meta(parent, 16000), user(16100, 'Inspect the synthetic screenshot.')]);
  write(unrelated, [meta(unrelated, 16000), user(16100, 'An unrelated synthetic task.')]);
  write(child, [meta(child, 17000, parent, 'screenshot', 'Screenshot checker'), user(17100, 'Read the fixture image.'),
    ev(17200, { type: 'item_completed', item: { type: 'ImageView', id: 'screenshot-call', path: path.join(WORK, 'fixture.png') } }),
    line(17300, 'response_item', { type: 'function_call_output', call_id: 'screenshot-call', output: [{ type: 'input_image', image_url: 'data:image/png;base64,' + png }] }),
  ]);
  await wait(2100);
  const s = await serve(), media = (root, agent) => new Promise((resolve, reject) => http.get({ port: s.port, path: `/api/media?proj=_codex&id=${root}&agent=${agent}&tool=screenshot-call&n=0` }, (r) => { const chunks = []; r.on('data', (b) => chunks.push(b)); r.on('end', () => resolve({ status: r.statusCode, type: r.headers['content-type'], body: Buffer.concat(chunks) })); }).on('error', reject));
  try {
    const tl = await get(s.port, route(parent)); assert.ok(tl.events.some((e) => e.agent === child && e.kind === 'results' && e.items.some((i) => i.img === 1)));
    const image = await media(parent, child); assert.equal(image.status, 200); assert.equal(image.type, 'image/png'); assert.deepEqual(image.body, Buffer.from(png, 'base64'));
    assert.equal((await media(parent, 'main')).status, 404); assert.equal((await media(unrelated, child)).status, 404);
  } finally { s.stop(); }
});

test('a quiet root stays recent and working while its child continues writing', async () => {
  const parent = id(16), child = id(17), old = new Date(Date.now() - 48 * 3600e3), recent = new Date();
  const parentFile = write(parent, [meta(parent, -48 * 3600e3), user(-48 * 3600e3 + 100, 'Run the synthetic long task.')]); fs.utimesSync(parentFile, old, old);
  const childFile = write(child, [meta(child, 18000, parent, 'long_task', 'Long worker'), user(18100, 'Continue the long task.'), command(18200, 'long-task-call', 'echo working', 'still working')]); fs.utimesSync(childFile, recent, recent);
  await wait(2100);
  const s = await serve();
  try {
    const rows = (await get(s.port, '/api/sessions')).filter((r) => r.proj === '_codex'), row = rows.find((r) => r.id === parent);
    assert.ok(row, 'the root remains available even though its own rollout is two days old'); assert.ok(Math.abs(row.mtime - recent.getTime()) < 5, 'the picker dates the root by its child activity'); assert.equal(rows[0].id, parent);
    const board = (await get(s.port, '/api/board')).find((r) => r.id === parent); assert.ok(board); assert.deepEqual([board.state, board.subActive, board.subTotal], ['working', 1, 1]); assert.ok(board.ageMs < 60000);
  } finally { s.stop(); }
});

test('a late plaintext worker prompt updates its fallback order in the same live feed and a resumed worker becomes active', async () => {
  const parent = id(18), child = id(19);
  write(parent, [meta(parent, 19000), user(19100, 'Wait for the synthetic task prompt.')]);
  write(child, [meta(child, 20000, parent, 'prompt_check', 'Prompt checker'), line(20100, 'response_item', { type: 'reasoning', encrypted_content: 'synthetic-encrypted-task' })]);
  await wait(2100);
  const s = await serve();
  try {
    const first = await get(s.port, route(parent)), fallback = first.events.find((e) => e.kind === 'order' && e.to === child); assert.ok(fallback); assert.match(fallback.text, /prompt_check/);
    append(child, [user(20200, 'Inspect the plaintext task after discovery.')]); await wait(2100);
    const more = await get(s.port, `${route(parent)}&after=${first.seq}&ep=${first.ep}`), order = more.events.find((e) => e.k === fallback.k);
    assert.equal(more.ep, first.ep); assert.ok(order, 'the changed order is sent again under its stable key'); assert.equal(order.text, 'Inspect the plaintext task after discovery.'); assert.equal(order.ts, fallback.ts);
    assert.ok(!more.events.some((e) => e.kind === 'user'), 'the worker prompt does not become a human message');
    const again = await get(s.port, `${route(parent)}&after=${more.seq}&ep=${more.ep}`); assert.deepEqual(again.events, []);
    append(child, [say(20300, 'First pass complete.'), ev(20400, { type: 'task_complete' })]); await wait(2100);
    assert.equal((await get(s.port, '/api/board')).find((r) => r.id === parent).subActive, 0);
    append(child, [ev(20500, { type: 'task_started' }), say(20600, 'Continuing the next pass.')]); await wait(2100);
    const board = (await get(s.port, '/api/board')).find((r) => r.id === parent); assert.deepEqual([board.state, board.subActive], ['working', 1]);
  } finally { s.stop(); }
});
