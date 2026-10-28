// test/recent-claude-code.test.js: what recent Claude Code versions changed in the files the app reads. Sub-agents launched in the background (all of them, in VS Code and the desktop app, 2.1.302),
// forks that start their file with a copy of the message that launched them (2.1.302), transcripts that also keep each request sent (lines of 100 KB and more, 2.1.300), idle compaction (2.1.299),
// and what the app now shows from them: the cost Claude Code counted (2.1.300), the effort and the advisor of each agent (2.1.275). A transcript without them shows none of it.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-bg-')), PROJECTS = path.join(tmp, 'projects');
Object.assign(process.env, { AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_KOKORO_DIR: path.join(tmp, 'kokoro'), AGENT_STANDUP_PROJECTS: PROJECTS, AGENT_STANDUP_CC_SESSIONS: path.join(tmp, 'sessions'), AGENT_STANDUP_CLAUDE: path.join(tmp, 'no-claude') });

const now = Date.now(), iso = (ago) => new Date(now - ago).toISOString(), id = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const DIR = path.join(PROJECTS, '-work-shop'), file = (n) => path.join(DIR, id(n) + '.jsonl'), sub = (n, aid) => path.join(DIR, id(n), 'subagents', 'agent-' + aid);
const lines = (recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n', at = (f, ago) => { const t = new Date(now - ago); fs.utimesSync(f, t, t); };
const put = (n, recs, ago) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file(n), lines(recs)); at(file(n), ago); };
const agent = (n, aid, meta, ago) => { fs.mkdirSync(path.dirname(sub(n, aid)), { recursive: true }); fs.writeFileSync(sub(n, aid) + '.jsonl', lines([{ type: 'user', isSidechain: true, agentId: aid, timestamp: iso(ago), message: { role: 'user', content: 'Count the words' } }])); fs.writeFileSync(sub(n, aid) + '.meta.json', JSON.stringify(meta)); at(sub(n, aid) + '.jsonl', ago); };
const user = (text, ago) => ({ type: 'user', timestamp: iso(ago), message: { role: 'user', content: text } }), say = (text, ago, mid) => ({ type: 'assistant', timestamp: iso(ago), message: { role: 'assistant', id: mid, stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const launch = (aid, ago) => [{ type: 'assistant', timestamp: iso(ago), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_' + aid, name: 'Agent', input: { description: 'count words', subagent_type: 'general-purpose', run_in_background: true, prompt: 'Count the words' } }] } },
  { type: 'user', timestamp: iso(ago - 50), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_' + aid, content: [{ type: 'text', text: `Async agent launched successfully. (This tool result is internal metadata.)\nagentId: ${aid} (internal ID - do not mention to user.)` }] }] } }];
const news = (aid, ago) => user(`<task-notification>\n<task-id>${aid}</task-id>\n<tool-use-id>toolu_${aid}</tool-use-id>\n<status>completed</status>\n<summary>Agent "count words" completed</summary>\n</task-notification>`, ago);
const WAIT = "Both agents are running in the background, and I'm waiting for their results.";

const RUNS = 1, DONE = 2, OLDER = 3, NEWS = 4, SILENT = 5;
put(RUNS, [user('Count it', 60e3), ...launch('a1', 55e3), say(WAIT, 50e3)], 50e3); agent(RUNS, 'a1', { agentType: 'general-purpose', requestShape: 'background' }, 5e3);   // still at work: no "finished" yet
put(DONE, [user('Count it', 60e3), ...launch('a2', 55e3), say(WAIT, 50e3)], 50e3); agent(DONE, 'a2', { agentType: 'general-purpose', requestShape: 'background', finished: true }, 5e3);   // its meta says it ended (2.1.302), before the news reached the lead
put(OLDER, [user('Count it', 600e3), ...launch('a3', 590e3), say(WAIT, 580e3), user('Meanwhile, what time is it?', 60e3), say('It is noon.', 50e3)], 50e3); agent(OLDER, 'a3', { agentType: 'general-purpose' }, 5e3);   // launched before your last order: the answer to it is yours to read
put(NEWS, [user('Count it', 60e3), ...launch('a4', 55e3), say(WAIT, 50e3), news('a4', 40e3), say('The file has 5 words.', 30e3)], 30e3); agent(NEWS, 'a4', { agentType: 'general-purpose' }, 40e3);
const note = (aid) => `<task-notification>\n<task-id>${aid}</task-id>\n<tool-use-id>toolu_${aid}</tool-use-id>\n<status>completed</status>\n</task-notification>`, QUEUED = 'c', ATTACHED = 'd';   // before 2.1.302 the news is often only queued, then handed over inside the next order
put(QUEUED, [user('Count it', 60e3), ...launch('a6', 55e3), say(WAIT, 50e3), { type: 'queue-operation', operation: 'enqueue', timestamp: iso(40e3), content: note('a6') }, say('The file has 5 words.', 30e3)], 30e3); agent(QUEUED, 'a6', { agentType: 'general-purpose' }, 5e3);
put(ATTACHED, [user('Count it', 60e3), ...launch('a7', 55e3), say(WAIT, 50e3), { type: 'attachment', isSidechain: false, timestamp: iso(40e3), attachment: { type: 'queued_command', prompt: note('a7'), origin: { kind: 'task-notification' } } }, say('The file has 5 words.', 30e3)], 30e3); agent(ATTACHED, 'a7', { agentType: 'general-purpose' }, 5e3);
put(SILENT, [user('Count it', 2100e3), ...launch('a5', 2000e3), say(WAIT, 1990e3)], 1500e3); agent(SILENT, 'a5', { agentType: 'general-purpose' }, 1990e3);   // no word from it for half an hour: its session was closed under it

test('a lead that waits on the sub-agents it launched in the background is not waiting on you, until they are done or the news comes', () => {
  const core = require('../server.js'), rows = core.boardRows(), row = (n) => rows.find((r) => r.id === id(n));
  assert.equal(row(RUNS).state, 'waiting');
  assert.equal(row(DONE).state, 'turn');
  assert.equal(row(OLDER).state, 'turn');
  assert.equal(row(NEWS).state, 'turn');
  assert.equal(row(SILENT).state, 'turn');
  assert.equal(row(QUEUED).state, 'turn', 'the news only queued (2.1.294): the agent ended all the same'); assert.equal(row(ATTACHED).state, 'turn');
  core.shutdown();
});

// What 2.1.300 adds after each order: a snapshot of the prompt, then the request itself, its shape and its blocks (each of them 30 to 130 KB)
const scan = async (core) => { await new Promise((r) => setTimeout(r, 1300)); return core.boardRows(); };   // a scan is shared for 1.2 s
const big = (n) => 'x'.repeat(n * 1024), bulk = (ago) => [{ parentUuid: 'p', isSidechain: false, attachment: { type: 'prompt_snapshot', systemPrompt: [big(60)] }, type: 'attachment', timestamp: iso(ago) },
  { type: 'api-request-shape', shapeHash: 'h', shape: { system: big(90) } }, { type: 'api-request-blob', hash: 'b1', message: { role: 'user', content: [{ type: 'text', text: big(40) }] } }, { type: 'api-request-blob', hash: 'b2', message: { role: 'user', content: [{ type: 'text', text: big(30) }] } }, { type: 'api-request', id: 'r', shapeHash: 'h' }];
test('a new order is seen when the requests Claude Code writes after it fill the end of the transcript', async () => {
  const N = 6; put(N, [user('First order', 600e3), say('Done.', 590e3)], 590e3);
  const core = require('../server.js'); assert.equal((await scan(core)).find((r) => r.id === id(N)).asked, now - 600e3);
  fs.appendFileSync(file(N), lines([user('Second order', 20e3), ...bulk(19e3)])); at(file(N), 19e3);   // 220 KB written after the order
  const r = (await scan(core)).find((x) => x.id === id(N)); assert.equal(r.asked, now - 20e3); assert.equal(r.state, 'working');
  const B = 8, resent = { type: 'api-request-blob', hash: 'b3', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_old1', name: 'Bash', input: { command: 'ls' } }, { type: 'tool_use', id: 'toolu_old2', name: 'Edit', input: { file_path: '/work/shop/a.js', old_string: 'a', new_string: 'b' } }] } };   // calls of earlier turns, sent again with the request
  put(B, [user('Tidy up', 90e3), resent, { type: 'api-request', id: 'r2', shapeHash: 'h' }, say('All tidy.', 80e3)], 80e3);
  const b = (await scan(core)).find((x) => x.id === id(B)); assert.equal(b.state, 'turn'); assert.equal(b.tool, '');
  core.shutdown();
});

test('a session Claude Code compacts while it sits idle stays idle, and stays put away', async () => {
  const C = 9, A = 0; put(C, [user('Write the notes', 3100e3), say('Here are the notes.', 3000e3)], 3000e3);
  fs.writeFileSync(path.join(tmp, 'done.json'), JSON.stringify({ ['-work-shop/' + id(C)]: now - 3000e3 }));   // marked as done back then
  fs.appendFileSync(file(C), lines([{ type: 'system', subtype: 'compact_boundary', timestamp: iso(60e3), compactMetadata: { trigger: 'idle', preTokens: 231000 } }, { ...user('This session is being continued from a previous conversation. Summary: notes.', 60e3), isCompactSummary: true, isVisibleInTranscriptOnly: true }])); at(file(C), 60e3);
  put(A, [user('Fix it', 900e3), say('Fixed.', 800e3), { type: 'system', subtype: 'compact_boundary', timestamp: iso(60e3), compactMetadata: { trigger: 'auto' } }, { ...user('Summary: fixed.', 60e3), isCompactSummary: true }], 60e3);   // compacted at the end of a turn: still that turn
  const core = require('../server.js'), rows = await scan(core), c = rows.find((r) => r.id === id(C)), a = rows.find((r) => r.id === id(A));
  assert.equal(c.state, 'idle'); assert.equal(c.mtime, now - 3000e3); assert.equal(c.done, 1);
  assert.equal(a.state, 'turn');
  core.shutdown();
});

test('a session whose tab is closed has not moved: what Claude Code writes then has no time, and the session keeps the time of its last record', async () => {
  const closing = [{ type: 'last-prompt', lastPrompt: 'Ship it', sessionId: 's' }, { type: 'ai-title', aiTitle: 'Ship it', sessionId: 's' }, { type: 'mode', mode: 'default', sessionId: 's' }, { type: 'atis-latch', sessionId: 's' }, { type: 'cost-state', sessionId: 's' }];   // 2.1.304, on closing the tab
  const T = 'e', O = 'f'; put(T, [user('Ship it', 1300e3), say('Shipped.', 1200e3), ...closing], 1e3); put(O, [user('Ship it', 7300e3), say('Shipped.', 7200e3), ...closing], 1e3);
  const core = require('../server.js'), rows = await scan(core), t = rows.find((r) => r.id === id(T)), o = rows.find((r) => r.id === id(O));
  assert.equal(t.state, 'turn'); assert.equal(t.mtime, now - 1200e3, 'not a turn that ended just now, which the call would announce');
  assert.equal(o.state, 'idle'); assert.equal(o.mtime, now - 7200e3);
  core.shutdown();
});

const get = (port, p) => new Promise((res, rej) => http.get({ port, path: p }, (x) => { let b = ''; x.on('data', (d) => (b += d)); x.on('end', () => res(JSON.parse(b))); }).on('error', rej));
test("a fork's copy of the message that launched it is not counted twice, nor taken for the fork ordering itself", async () => {
  const F = 7, call = { type: 'assistant', timestamp: iso(60e3), message: { role: 'assistant', id: 'msg_lead', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 313, cache_read_input_tokens: 12790, cache_creation_input_tokens: 15080 }, content: [{ type: 'tool_use', id: 'toolu_fork', name: 'Agent', input: { description: 'fork check', subagent_type: 'fork', prompt: 'Say which file' } }] } };
  put(F, [user('Check it', 70e3), call, { type: 'user', timestamp: iso(59e3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fork', content: 'Async agent launched successfully.\nagentId: af1' }] } }], 10e3);
  fs.mkdirSync(path.dirname(sub(F, 'af1')), { recursive: true }); fs.writeFileSync(sub(F, 'af1') + '.meta.json', JSON.stringify({ agentType: 'fork', isFork: true, description: 'fork check', toolUseId: 'toolu_fork' }));
  const copy = { ...call, isSidechain: true, agentId: 'af1', timestamp: iso(58e3), message: { ...call.message, usage: { ...call.message.usage, output_tokens: 5 } } };   // the lead's message, written again in the fork's file a moment later
  fs.writeFileSync(sub(F, 'af1') + '.jsonl', lines([{ type: 'fork-context-ref', agentId: 'af1' }, copy, { type: 'user', isSidechain: true, agentId: 'af1', timestamp: iso(58e3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fork', content: 'Fork started' }, { type: 'text', text: '<fork-boilerplate>You are a worker fork.</fork-boilerplate>' }] } },
    { ...say('The lead asked for note.txt.', 55e3, 'msg_fork'), isSidechain: true, agentId: 'af1', message: { ...say('The lead asked for note.txt.', 55e3, 'msg_fork').message, model: 'claude-sonnet-5-5', usage: { input_tokens: 4, output_tokens: 105, cache_read_input_tokens: 27870, cache_creation_input_tokens: 487 } } }]));
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r));
  try {
    const tl = await get(srv.address().port, `/api/session?proj=-work-shop&id=${id(F)}`), u = tl.events.filter((e) => e.kind === 'usage');
    assert.deepEqual(u.map((e) => [e.agent, e.u.w]).sort(), [['af1', 487], ['main', 15080]]);
    assert.deepEqual(tl.events.filter((e) => e.kind === 'order').map((e) => [e.agent, e.to]), [['main', 'af1']]);
  } finally { require('../server.js').shutdown(); srv.close(); }
});

const msg = (mid, ago, extra = {}, model = 'claude-sonnet-5-5') => ({ type: 'assistant', timestamp: iso(ago), ...extra, message: { role: 'assistant', id: mid, model, stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 }, content: [{ type: 'text', text: 'Done ' + mid + '.' }] } });
test('the cost Claude Code counted, and the effort and advisor of each message, go with the session; an older transcript has none', async () => {
  const NEW = 1, LATER = 2, OLD = 3, DIR2 = path.join(PROJECTS, '-work-cost'), f2 = (n) => path.join(DIR2, id(n) + '.jsonl'); fs.mkdirSync(DIR2, { recursive: true });
  const NOW = { effort: 'high', perTurnEffort: 'xhigh', advisorModel: 'claude-opus-5-5' };
  fs.writeFileSync(f2(NEW), lines([user('Go', 90e3), msg('m1', 80e3, NOW), { type: 'cost-state', sessionId: id(NEW), totalCostUSD: 0.123456, modelUsage: {} }]));
  fs.writeFileSync(f2(LATER), lines([user('Go', 90e3), msg('m2', 80e3, NOW), { type: 'cost-state', totalCostUSD: 1.5 }, user('Again', 60e3), msg('m3', 50e3, { ...NOW, advisorModel: 'claude-sonnet-5-5' })]));   // resumed after its process ended: what it spent since is not in that count yet; an advisor that is the model itself is no advisor
  fs.writeFileSync(f2(OLD), lines([user('Go', 90e3), msg('m4', 80e3), { type: 'cost-state', totalCostUSD: 'NaN' }]));   // Claude Code before 2.1.275 writes neither; a count that is no number is left out
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r));
  try {
    const tl = (n) => get(srv.address().port, `/api/session?proj=-work-cost&id=${id(n)}`), use = (t) => t.events.filter((e) => e.kind === 'usage').map((e) => [e.ef, e.adv]);
    const a = await tl(NEW), b = await tl(LATER), c = await tl(OLD);
    assert.deepEqual(a.cost, { usd: 0.1235, final: true }); assert.deepEqual(use(a), [['xhigh', 'claude-opus-5-5']]);
    assert.deepEqual(b.cost, { usd: 1.5, final: false }); assert.deepEqual(use(b), [['xhigh', 'claude-opus-5-5'], ['xhigh', undefined]]);
    assert.equal(c.cost, undefined); assert.deepEqual(use(c), [[undefined, undefined]]);
    const poll = await get(srv.address().port, `/api/session?proj=-work-cost&id=${id(NEW)}&after=${a.seq}&ep=${a.ep}`); assert.deepEqual(poll.cost, { usd: 0.1235, final: true });   // a live call gets it too
  } finally { require('../server.js').shutdown(); srv.close(); }
});
