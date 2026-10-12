// test/server.test.js: the settings file, session stickiness, the cross-site guard and the pictures of a session, against a real server on a free port
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-test-'));
process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_KOKORO_DIR = path.join(tmp, 'kokoro'); process.env.AGENT_STANDUP_PROJECTS = path.join(tmp, 'projects');
const get = (port, p, headers = {}, method = 'GET', body) => new Promise((res, rej) => { const r = http.request({ port, path: p, method, headers }, (x) => { let b = '', n = 0; x.on('data', (d) => { b += d; n += d.length; }); x.on('end', () => res({ status: x.statusCode, body: b, type: x.headers['content-type'], bytes: n })); }); r.on('error', rej); if (body) r.write(body); r.end(); });
test('settings are kept in a file; cross-site writes are refused', async () => {
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  try {
    assert.match((await get(port, '/api/prefs.js')).body, /SAVED_PREFS = null/);
    assert.equal((await get(port, '/api/prefs', { 'content-type': 'application/json' }, 'PUT', '{"lang":"fr","_t":5}')).status, 200);
    assert.match((await get(port, '/api/prefs.js')).body, /"lang":"fr"/);
    assert.equal((await get(port, '/api/prefs', { 'sec-fetch-site': 'cross-site' }, 'PUT', '{}')).status, 403);
    assert.equal((await get(port, '/api/prefs', {}, 'PUT', '[1]')).status, 400);
    assert.equal(JSON.parse((await get(port, '/api/kokoro')).body).installed, false);
    assert.equal((await get(port, '/api/kokoro/install', { 'sec-fetch-site': 'cross-site' }, 'POST')).status, 403);
  } finally { srv.close(); require('../server.js').shutdown(); }
});
test('pictures returned by tools are counted in the timeline and served from the transcript only', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', pic = (type, data) => ({ type: 'image', source: { type: 'base64', media_type: type, data } });
  const rec = (id, content) => [{ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: '/x/shot.png' } }] } }, { type: 'user', timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } }].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const dir = path.join(tmp, 'projects', '-p'); fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), rec('toolu_pic', [pic('image/png', png), pic('image/svg+xml', 'PHN2Zy8+')])); fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-a1.jsonl'), rec('toolu_sub', [pic('image/png', png)]));
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port, media = (q) => get(port, '/api/media?proj=-p&id=s1&' + q);
  try {
    const items = JSON.parse((await get(port, '/api/session?proj=-p&id=s1')).body).events.filter((e) => e.kind === 'results').flatMap((e) => e.items);
    assert.deepEqual(items.map((it) => [it.id, it.img]).sort(), [['toolu_pic', 1], ['toolu_sub', 1]]);   // the SVG is not a picture we show
    const ok = await media('agent=main&tool=toolu_pic&n=0'); assert.equal(ok.status, 200); assert.equal(ok.type, 'image/png'); assert.equal(ok.bytes, Buffer.from(png, 'base64').length);
    assert.equal((await media('agent=a1&tool=toolu_sub&n=0')).status, 200);
    assert.equal((await media('agent=main&tool=toolu_pic&n=1')).status, 404);
    assert.equal((await media('agent=main&tool=toolu_sub&n=0')).status, 404);
    assert.equal((await media('agent=..&tool=toolu_pic&n=0')).status, 400);
    assert.equal((await get(port, '/api/media?proj=..&id=s1&agent=main&tool=toolu_pic&n=0')).status, 400);
    assert.equal((await get(port, '/api/media?proj=-p&id=s1&agent=main&tool=toolu_pic&n=0', { 'sec-fetch-site': 'cross-site' })).status, 403);
  } finally { srv.close(); require('../server.js').shutdown(); }
});
test('an order typed while the lead is working is part of the call', async () => {
  const at = (s) => `2026-01-01T00:00:0${s}Z`, queued = (s, prompt, origin) => ({ type: 'attachment', timestamp: at(s), attachment: { type: 'queued_command', prompt, origin, commandMode: origin.kind === 'human' ? 'prompt' : 'task-notification' } });
  const recs = [{ type: 'user', timestamp: at(0), message: { role: 'user', content: 'first order' } }, { type: 'assistant', timestamp: at(1), message: { content: [{ type: 'tool_use', id: 'toolu_q', name: 'Bash', input: { command: 'ls' } }] } },
    queued(2, [{ type: 'text', text: 'order sent meanwhile' }], { kind: 'human' }), queued(3, '<task-notification>\n<task-id>x</task-id>', { kind: 'task-notification' }), { type: 'assistant', timestamp: at(4), message: { content: [{ type: 'text', text: 'On it.' }] } }];
  const dir = path.join(tmp, 'projects', '-q'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 's2.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  try {
    const said = JSON.parse((await get(port, '/api/session?proj=-q&id=s2')).body).events.filter((e) => e.kind === 'user' || e.kind === 'say').map((e) => [e.agent, e.text]);
    assert.deepEqual(said, [['user', 'first order'], ['user', 'order sent meanwhile'], ['main', 'On it.']]);
  } finally { srv.close(); require('../server.js').shutdown(); }
});
// ---- 1.25.7: a live feed that loses nothing, the end of the lead's turn, transcripts of other shapes, requests that used to stop the server
const wait = (ms) => new Promise((r) => setTimeout(r, ms)), at = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + s * 1000).toISOString(), line = (r) => JSON.stringify(r) + '\n';
const said = (s, text, o = {}) => ({ type: 'assistant', timestamp: at(s), message: { id: o.id || 'm' + s, stop_reason: o.stop === undefined ? null : o.stop, content: [{ type: o.thinking ? 'thinking' : 'text', [o.thinking ? 'thinking' : 'text']: text }] } });
const used = (s, id, name, input, o = {}) => ({ type: 'assistant', timestamp: at(s), message: { id: o.id || 'm' + s, stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
const typed = (s, content, o = {}) => ({ type: 'user', timestamp: at(s), ...o, message: { role: 'user', content } }), result = (s, id, content, o = {}) => typed(s, [{ type: 'tool_result', tool_use_id: id, content }], o);
const serve = async () => { const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); return { srv, port: srv.address().port, stop: () => { srv.close(); require('../server.js').shutdown(); } }; };
const load = async (port, q) => JSON.parse((await get(port, '/api/session?' + q)).body);
test('a live call followed record by record ends with exactly what a fresh load shows', async () => {
  const dir = path.join(tmp, 'projects', '-f'), main = path.join(dir, 's.jsonl'), sub = path.join(dir, 's', 'subagents', 'agent-a1.jsonl'); fs.mkdirSync(path.dirname(sub), { recursive: true });
  const steps = [   // [file, record]: written one at a time, the way Claude Code writes them
    [main, typed(0, 'first order')], [main, said(1, 'I will look.')],
    [main, used(2, 'toolu_r', 'Read', { file_path: '/x/a.js' }, { id: 'mA' })], [main, used(2, 'toolu_g', 'Grep', { pattern: 'slow' }, { id: 'mA' })], [main, used(3, 'toolu_ag', 'Agent', { prompt: 'Find the slow query.', description: 'Profiler' }, { id: 'mA' })],   // one message, one record per tool call
    [sub, typed(4, 'Find the slow query.')], [sub, used(5, 'toolu_b', 'Bash', { command: 'ls' })], [sub, said(6, 'Found it: the cart query.')],
    [main, { type: 'attachment', timestamp: at(2.5), attachment: { type: 'queued_command', prompt: [{ type: 'text', text: 'ORDER TYPED MEANWHILE' }], origin: { kind: 'human' }, commandMode: 'prompt' } }],   // typed at 2.5 s, delivered after lines stamped later
    [main, result(7, 'toolu_ag', 'The cart query is slow.')],   // the sub-agent's completion record comes after its last text
    [main, used(8, 'toolu_e', 'Edit', { file_path: '/x/a.js', old_string: 'a', new_string: 'b' })], [main, typed(9, [{ type: 'text', text: '[Request interrupted by user for tool use]' }])],
    [main, typed(10, 'second order')], [main, said(11, 'Done.', { stop: 'end_turn' })]];
  fs.writeFileSync(path.join(dir, 's', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Profiler', toolUseId: 'toolu_ag' }));
  fs.writeFileSync(main, line(steps[0][1]));
  const { port, stop } = await serve(), q = 'proj=-f&id=s';
  try {
    const first = await load(port, q), have = new Map(first.events.map((e) => [e.k, e])), seen = []; let seq = first.seq, late = 0; const ep = first.ep;
    assert.equal(typeof ep, 'string'); assert.ok(Number.isInteger(seq)); assert.equal(have.size, first.events.length);
    for (const [file, rec] of steps.slice(1)) {
      fs.appendFileSync(file, line(rec)); await wait(280);   // the server does not build a timeline twice within 250 ms
      const d = await load(port, q + '&after=' + seq + '&ep=' + ep); assert.equal(d.ep, ep); assert.ok(d.seq >= seq); assert.deepEqual(Object.keys(d).sort(), ['agents', 'ep', 'events', 'id', 'seq']);
      for (const e of d.events) { seen.push([have.has(e.k) ? 'changed' : 'new', e.kind, e.agent, e.end || 0]); if (!have.has(e.k) && [...have.values()].some((x) => x.ts > e.ts)) late++; have.set(e.k, e); }   // what the page does: a known key is replaced in place, an unknown one is added
      seq = d.seq; assert.deepEqual((await load(port, q + '&after=' + seq + '&ep=' + ep)).events, []);   // asked again with the new number: nothing
    }
    const fresh = await load(port, q); assert.equal(fresh.ep, ep); assert.equal(fresh.seq, seq);
    assert.equal(new Set(fresh.events.map((e) => e.k)).size, fresh.events.length);   // keys are unique
    assert.deepEqual([...have.keys()].sort(), fresh.events.map((e) => e.k).sort()); for (const e of fresh.events) assert.deepEqual(have.get(e.k), e);
    fs.mkdirSync(path.join(tmp, 'projects', '-f2'), { recursive: true }); fs.cpSync(dir, path.join(tmp, 'projects', '-f2'), { recursive: true });   // the same files read for the first time by a server that never saw them grow: same keys, same events
    const cold = await load(port, 'proj=-f2&id=s'); assert.notEqual(cold.ep, ep); assert.deepEqual(cold.events, fresh.events);
    // the three losses of the feed by position, each seen coming through
    assert.ok(late >= 1); assert.ok(seen.some((s) => s[0] === 'new' && s[1] === 'user')); assert.equal([...have.values()].filter((e) => e.kind === 'user').map((e) => e.text).join('|'), 'first order|ORDER TYPED MEANWHILE|second order');
    assert.ok(seen.some((s) => s[0] === 'changed' && s[1] === 'report' && s[2] === 'a1')); assert.deepEqual([...have.values()].filter((e) => e.agent === 'a1').map((e) => e.kind).sort(), ['finish', 'report', 'tools']);
    assert.ok(seen.some((s) => s[0] === 'changed' && s[1] === 'tools' && s[2] === 'main')); assert.deepEqual(fresh.events.filter((e) => e.kind === 'tools' && e.agent === 'main').map((e) => e.tools.map((t) => t.id).join('+') + (e.end ? ' end' : '')), ['toolu_r+toolu_g', 'toolu_e end']);
    assert.ok(seen.some((s) => s[0] === 'changed' && s[1] === 'tools' && s[3] === 1));   // the interruption marks a beat the page already had: it comes back under the same key
    // a page that follows another feed is told to load again; a page from before the upgrade is still answered by position
    assert.deepEqual(await load(port, q + '&after=0&ep=nope'), { resync: true }); assert.deepEqual(await load(port, q + '&after=' + (seq + 1) + '&ep=' + ep), { resync: true });
    const old = await load(port, q + '&after=2'); assert.equal(old.total, fresh.events.length); assert.deepEqual(old.events, fresh.events.slice(2));
    assert.equal((await load(port, q + '&after=0&ep=' + ep)).events.length, fresh.events.length);
  } finally { stop(); }
});
test('the lead\'s turn ends on end_turn or on an interruption, and only the lead\'s', async () => {
  const dir = path.join(tmp, 'projects', '-e'); fs.mkdirSync(path.join(dir, 's', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 's.jsonl'), [typed(0, 'one'), said(1, 'Looking.', { stop: 'tool_use', id: 'm1' }), used(1, 'toolu_1', 'Bash', { command: 'ls' }, { id: 'm1' }), result(2, 'toolu_1', 'a.js'),
    said(3, 'hm', { thinking: 1, stop: 'end_turn', id: 'm2' }), said(3, 'All good.', { stop: 'end_turn', id: 'm2' }),   // one message, one record per block, each with the stop reason: the mark is on the line, once
    typed(4, 'two'), said(5, 'Starting.'), used(6, 'toolu_2', 'Bash', { command: 'sleep 9' }), used(6, 'toolu_3', 'Read', { file_path: '/x' }), result(7, 'toolu_2', 'no', { toolUseResult: 'interrupted' }), typed(7, [{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
    typed(8, 'three'), said(9, 'Let me think about'), typed(10, [{ type: 'text', text: '[Request interrupted by user]' }]), typed(11, 'four'), used(12, 'toolu_4', 'Glob', { pattern: '*' })].map(line).join(''));
  fs.writeFileSync(path.join(dir, 's', 'subagents', 'agent-a1.jsonl'), [typed(1, 'sub order'), said(2, 'Sub done.', { stop: 'end_turn' })].map(line).join(''));
  const { port, stop } = await serve();
  try {
    const ev = (await load(port, 'proj=-e&id=s')).events.filter((e) => e.kind === 'say' || e.kind === 'tools' || e.kind === 'user' || e.kind === 'report');
    assert.deepEqual(ev.map((e) => e.agent + ' ' + (e.text || e.tools.map((t) => t.id).join('+')) + (e.end ? ' END' : '')), ['user one', 'main Looking.', 'main toolu_1', 'a1 Sub done.', 'main All good. END', 'user two', 'main Starting.', 'main toolu_2+toolu_3 END', 'user three', 'main Let me think about END', 'user four', 'main toolu_4']);
    assert.ok(ev.every((e) => e.end === undefined || e.end === 1));
  } finally { stop(); }
});
test('compaction summaries, workflow agents, titles and a transcript rewritten in place', async () => {
  const dir = path.join(tmp, 'projects', '-w'), main = path.join(dir, 's.jsonl'), run = path.join(dir, 's', 'subagents', 'workflows', 'wf_run1'); fs.mkdirSync(run, { recursive: true });
  const wfAgent = (id, phase, recs) => { fs.writeFileSync(path.join(run, `agent-${id}.jsonl`), recs.map(line).join('')); fs.writeFileSync(path.join(run, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'workflow-subagent', description: 'check ' + id, workflowPhase: phase })); };
  fs.writeFileSync(main, [typed(0, 'x'.repeat(70000)), said(1, 'NOT THE TITLE'), typed(2, 'This session is being continued. '.repeat(400), { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
    used(3, 'toolu_wf', 'Workflow', { script: 'run()' }), result(4, 'toolu_wf', 'launched', { toolUseResult: { status: 'async_launched', runId: 'wf_run1' } }), said(5, 'Launched.', { stop: 'end_turn' })].map(line).join(''));
  wfAgent('w1', 'Review', [typed(6, 'Review the cart.'), used(7, 'toolu_w1', 'Bash', { command: 'ls' }), said(8, 'Cart is fine.')]); wfAgent('w2', 'Verify', [typed(6, 'Verify the login.'), said(9, 'Still looking.')]);
  fs.writeFileSync(path.join(run, 'journal.jsonl'), [{ type: 'launched' }, { type: 'started', agentId: 'w1', key: 'a', label: 'check w1', phase: 'Review' }, { type: 'started', agentId: 'w2', key: 'b', label: 'check w2', phase: 'Verify' }, { type: 'result', agentId: 'w1', key: 'a', result: { ok: true } }].map(line).join(''));
  const { port, stop } = await serve(), q = 'proj=-w&id=s', row = async (p) => JSON.parse((await get(port, p)).body).find((r) => r.proj === '-w');
  try {
    const tl = await load(port, q), by = (k) => tl.events.filter((e) => e.kind === k);
    assert.deepEqual(by('user').map((e) => e.text.length), [70000]);   // the summary is not something the human said
    assert.deepEqual(tl.agents.map((a) => [a.id, a.role, a.type, a.wf, a.phase]), [['main', 'Lead', 'main', undefined, undefined], ['w1', 'check w1', 'workflow-subagent', 'wf_run1', 'Review'], ['w2', 'check w2', 'workflow-subagent', 'wf_run1', 'Verify']]);   // journal.jsonl is not an agent
    assert.deepEqual(by('order').map((e) => [e.agent, e.to, e.bg, e.wf, e.toolId, e.text, e.title, e.k]), [['main', 'w1', true, 'wf_run1', 'toolu_wf', 'Review the cart.', 'check w1', 'o/w1'], ['main', 'w2', true, 'wf_run1', 'toolu_wf', 'Verify the login.', 'check w2', 'o/w2']]);
    assert.deepEqual(by('report').map((e) => [e.agent, e.to, e.text]), [['w1', 'main', 'Cart is fine.']]); assert.deepEqual(by('finish').map((e) => [e.agent, e.to, e.k]), [['w1', 'main', 'f/w1']]);   // the journal says w1 handed its result back; w2 is still at work
    assert.deepEqual(by('say').map((e) => [e.agent, e.text]), [['main', 'NOT THE TITLE'], ['main', 'Launched.'], ['w2', 'Still looking.']]);
    assert.equal((await get(port, '/api/media?proj=-w&id=s&agent=w1&tool=toolu_w1&n=0')).status, 404); assert.equal((await get(port, '/api/media?proj=-w&id=s&agent=nobody&tool=toolu_w1&n=0')).status, 404); assert.equal((await get(port, '/api/media?proj=-w&id=s&agent=main&tool=e&n=0')).status, 400);
    const b = await row('/api/board'); assert.equal(b.title, 'x'.repeat(90)); assert.equal(b.subTotal, 2); assert.equal((await row('/api/sessions')).agents, 2);   // the first prompt, cut off by the 64 KB read, and not the assistant's first line
    fs.appendFileSync(main, line({ type: 'ai-title', aiTitle: 'Named later' })); await wait(1300); assert.equal((await row('/api/board')).title, 'Named later');
    fs.appendFileSync(main, line({ type: 'custom-title', customTitle: 'Renamed by hand' }) + line({ type: 'ai-title', aiTitle: 'Named again' })); await wait(1300); assert.equal((await row('/api/board')).title, 'Renamed by hand');
    fs.appendFileSync(path.join(run, 'journal.jsonl'), line({ type: 'result', agentId: 'w2', key: 'b', result: 'done' })); await wait(280);   // only the journal changed: w2's last line becomes its report
    const d = await load(port, q + '&after=' + tl.seq + '&ep=' + tl.ep); assert.deepEqual(d.events.map((e) => [e.k, e.kind, e.agent]).sort(), [['f/w2', 'finish', 'w2'], [tl.events.find((e) => e.text === 'Still looking.').k, 'report', 'w2']]);
    const size = fs.statSync(main).size; fs.writeFileSync(main, [typed(0, 'a different conversation'), said(1, 'With other lines.'), said(2, 'x'.repeat(size + 5000), { stop: 'end_turn' })].map(line).join('')); await wait(280); assert.ok(fs.statSync(main).size > size);   // rewritten in place and longer than before: the bytes after the old length must not be read as a continuation
    assert.deepEqual(await load(port, q + '&after=' + d.seq + '&ep=' + d.ep), { resync: true });
    const again = await load(port, q); assert.notEqual(again.ep, tl.ep); assert.deepEqual(again.events.filter((e) => e.agent === 'main' || e.agent === 'user').filter((e) => e.kind !== 'order').map((e) => e.kind + (e.end ? ' end' : '')), ['user', 'say', 'say end']);
  } finally { stop(); }
});
test('no request stops the server; another site cannot read the settings', async () => {
  const dir = path.join(tmp, 'projects', '-l'); fs.mkdirSync(path.join(dir, 's', 'subagents'), { recursive: true }); fs.writeFileSync(path.join(dir, 's.jsonl'), line(typed(0, 'hello')));
  let links = true; try { fs.symlinkSync(path.join(dir, 'gone.jsonl'), path.join(dir, 'dead.jsonl')); fs.symlinkSync(path.join(dir, 'gone.jsonl'), path.join(dir, 's', 'subagents', 'agent-dead.jsonl')); } catch { links = false; }   // links that point nowhere (not allowed on every Windows account)
  const { port, stop } = await serve(), raw = (text) => new Promise((res, rej) => { const s = require('net').connect(port, '127.0.0.1', () => s.write(text)); let b = ''; s.on('data', (d) => { b += d; }); s.on('error', rej); s.on('close', () => res(b)); setTimeout(() => s.destroy(), 1500); });
  try {
    assert.match(await raw(`GET // HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 400 /);   // used to be an exception outside any try: the process died
    for (const p of ['/%', '/..%2f..%2fetc/passwd', '/api/session?proj=%00&id=%ff', '/api/media', '/api/tts?text=hi&voice=' + 'x'.repeat(300), '/characters/%', '/packs/cats/..%2f..%2fserver.js']) assert.ok((await get(port, p)).status >= 400, p);
    for (const p of ['/api/sessions', '/api/projects', '/api/current', '/api/current?proj=-l', '/api/current?proj=..&id=..&sproj=..&sid=..', '/api/board', '/api/session?proj=-l&id=s']) assert.equal((await get(port, p)).status, 200, p + (links ? ' with a dangling link next to the transcripts' : ''));
    assert.deepEqual(JSON.parse((await get(port, '/api/sessions')).body).filter((r) => r.proj === '-l').map((r) => r.id), ['s']); assert.equal(JSON.parse((await get(port, '/api/current?proj=-l')).body).id, 's');
    assert.equal((await get(port, '/api/prefs.js', { 'sec-fetch-site': 'cross-site' })).status, 403); assert.equal((await get(port, '/api/prefs.js', { 'sec-fetch-site': 'same-site' })).status, 403);   // a <script src> on another site's page
    assert.equal((await get(port, '/api/prefs.js', { 'sec-fetch-site': 'same-origin' })).status, 200); assert.equal((await get(port, '/api/prefs.js')).status, 200);
    assert.equal((await get(port, '/')).status, 200);   // still there
  } finally { stop(); }
});
test('the reasoning before a line or a call rides on it when the transcript keeps its text', async () => {
  const at = (n) => `2026-01-01T00:00:0${n}Z`, asst = (n, id, content) => ({ type: 'assistant', timestamp: at(n), message: { id, content } });
  const recs = [{ type: 'user', timestamp: at(0), message: { role: 'user', content: 'why is it slow' } }, asst(1, 'm1', [{ type: 'thinking', thinking: 'The query scans the whole table.\nI should check the index.', signature: 's' }]), asst(2, 'm1', [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: 'ls' } }]),
    asst(3, 'm2', [{ type: 'thinking', thinking: '', signature: 's' }]), asst(4, 'm2', [{ type: 'text', text: 'Found it.' }])];   // most of the time only the signature is kept: nothing to show
  const dir = path.join(tmp, 'projects', '-th'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 's3.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  try {
    const ev = JSON.parse((await get(port, '/api/session?proj=-th&id=s3')).body).events.filter((e) => e.kind === 'tools' || e.kind === 'say');
    assert.deepEqual(ev.map((e) => [e.kind, e.th || null]), [['tools', 'The query scans the whole table.\nI should check the index.'], ['say', null]]);
  } finally { srv.close(); require('../server.js').shutdown(); }
});
test('the demo is served as the page reads it, its French with it, and its live feed is one sequence', async () => {
  const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
  const session = async (query) => JSON.parse((await get(port, '/api/session?proj=_demo&id=demo' + query)).body);
  try {
    const written = require('../demo.js')(), all = await session('');
    assert.equal(all.ep, 'demo'); assert.equal(all.seq, 1);
    assert.equal(all.events.length, written.events.length);
    assert.deepEqual(all.events.map((e) => e.kind), written.events.map((e) => e.kind));
    assert.deepEqual(all.events.map((e) => e.k).slice(0, 3), ['d:0', 'd:1', 'd:2']);
    assert.deepEqual(all.events.filter((e) => e.fr).map((e) => e.fr), written.events.filter((e) => e.fr).map((e) => e.fr), 'the French of every line');
    assert.equal((await session('&after=0&ep=demo')).events.length, written.events.length, 'a page that has nothing gets everything');
    assert.deepEqual((await session('&after=1&ep=demo')).events, [], 'a page that is up to date gets nothing');
  } finally { srv.close(); require('../server.js').shutdown(); }
});
// ---- a sub-agent the person named keeps its name; the stock types get a first name from the page; the list of voices does not hold the server up
test('own agent names: the name given at launch, or the person\'s own agent type; never a stock type', async () => {
  const dir = path.join(tmp, 'projects', '-n'), subs = path.join(dir, 's', 'subagents'); fs.mkdirSync(subs, { recursive: true });
  const kids = [['a1', 'code-reviewer', {}, 3], ['a2', 'general-purpose', {}, 4], ['a3', 'general-purpose', { name: 'Athena' }, 5], ['a4', 'code-reviewer', {}, 6], ['a5', 'my-plugin:db_migrator', {}, 7], ['a6', 'Explore', {}, 8]];
  fs.writeFileSync(path.join(dir, 's.jsonl'), [typed(0, 'review it'), ...kids.map(([id, type, extra, s]) => used(s, 'toolu_' + id, 'Agent', { prompt: 'Do ' + id, description: 'Task ' + id, subagent_type: type, ...extra }, { id: 'mN' }))].map(line).join(''));
  for (const [id, type, , s] of kids) {
    fs.writeFileSync(path.join(subs, `agent-${id}.jsonl`), [typed(s + 10, 'Do ' + id), said(s + 11, 'On it.')].map(line).join(''));
    fs.writeFileSync(path.join(subs, `agent-${id}.meta.json`), JSON.stringify({ agentType: type, description: 'Task ' + id, toolUseId: 'toolu_' + id }));
  }
  const { port, stop } = await serve();
  try {
    const tl = await load(port, 'proj=-n&id=s'), own = Object.fromEntries(tl.agents.map((a) => [a.id, a.own || null]));
    assert.deepEqual(own, { main: null, a1: 'Code Reviewer', a2: null, a3: 'Athena', a4: 'Code Reviewer 2', a5: 'Db Migrator', a6: null });
    assert.ok(!tl.events.some((e) => 'nm' in e), 'the launch name stays on the server side');
    const t0 = Date.now(), [v, h] = await Promise.all([get(port, '/api/voices'), get(port, '/api/health')]);
    assert.equal(v.status, 200); assert.equal(h.status, 200); assert.ok(Array.isArray(JSON.parse(v.body).voices)); assert.ok(Date.now() - t0 < 20000);
  } finally { stop(); }
});
