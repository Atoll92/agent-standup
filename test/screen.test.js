// test/screen.test.js: what the shared screen is told about each call, beyond its text: task lists, plans, Claude Preview, Cowork's tools, diffs, test runs, searches, background commands,
// pasted pictures, Codex's pictures (plain and compressed rollouts), and /api/taskout. Made-up transcripts in the shapes real ones have (Claude Code 2.1.2xx, Codex Desktop 2026), a real server on a free port.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), zlib = require('zlib');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-screen-')), CX = path.join(tmp, 'codex'), PROJECTS = path.join(tmp, 'projects'), CTMP = path.join(tmp, 'ctmp');
process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_KOKORO_DIR = path.join(tmp, 'kokoro'); process.env.AGENT_STANDUP_PROJECTS = PROJECTS; process.env.AGENT_STANDUP_CODEX = CX;
process.env.AGENT_STANDUP_CLAUDE = path.join(tmp, 'no-claude'); process.env.CLAUDE_CODE_TMPDIR = CTMP;
const get = (port, p, headers = {}, method = 'GET', body) => new Promise((res, rej) => { const r = http.request({ port, path: p, method, headers }, (x) => { const c = []; x.on('data', (d) => c.push(d)); x.on('end', () => { const b = Buffer.concat(c); res({ status: x.statusCode, type: x.headers['content-type'], buf: b, json: () => JSON.parse(b.toString('utf8')) }); }); }); r.on('error', rej); if (body) r.write(body); r.end(); });
const serve = async () => { const srv = require('../server.js').start(0); await new Promise((r) => srv.once('listening', r)); return { port: srv.address().port, stop: () => { srv.close(); require('../server.js').shutdown(); } }; };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==', GIF = 'R0lGODlhAQABAAAAACw=';
const pic = (type, data) => ({ type: 'image', source: { type: 'base64', media_type: type, data } });

// ---- a Claude Code session
let clock = Date.parse('2026-10-20T10:00:00Z'); const T = () => new Date((clock += 1000)).toISOString();
const call = (id, name, input, content, extra = {}) => [
  { type: 'assistant', uuid: 'a-' + id, timestamp: T(), message: { id: 'msg_' + id, content: [{ type: 'tool_use', id, name, input }] } },
  { type: 'user', uuid: 'u-' + id, timestamp: T(), message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(extra.err ? { is_error: true } : {}) }] }, ...('tur' in extra ? { toolUseResult: extra.tur } : {}) }];
const reminder = (content) => ({ type: 'attachment', uuid: 'r' + clock, timestamp: T(), attachment: { type: 'task_reminder', content, itemCount: content.length } });
const OUTS = {
  nodeSpec: '▶ cart\n  ✔ adds (1.2ms)\n  ✖ totals (3.1ms)\n    AssertionError [ERR_ASSERTION]: 3 == 4\n✖ cart (5ms)\n\x1b[34mℹ tests 3\x1b[39m\nℹ suites 1\nℹ pass 2\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 50.1\n\n✖ failing tests:\n\ntest at test/cart.test.js:3:1\n✖ totals (3.1ms)\n',
  nodeTap: 'TAP version 13\n# Subtest: adds\nok 1 - adds\n# Subtest: totals\nnot ok 2 - totals\n  ---\n  ...\n# Subtest: later\nok 3 - later # SKIP\n1..3\n# tests 3\n# suites 0\n# pass 1\n# fail 1\n# cancelled 0\n# skipped 1\n# todo 0\n',
  vitest: ' ❯ test/cart.test.ts (3 tests | 1 failed) 5ms\n   × cart > totals 2ms\n\n FAIL  test/cart.test.ts > cart > totals\nAssertionError: expected 3 to be 4\n\n Test Files  1 failed (1)\n      Tests  \x1b[1m\x1b[31m1 failed\x1b[39m\x1b[22m | 2 passed | 1 skipped (4)\n   Start at  10:00:00\n   Duration  300ms\n',
  jest: 'FAIL src/cart.test.js (5.2 s)\n  cart\n    ✓ adds (2 ms)\n    ✕ totals (3 ms)\n\n  ● Console\n\n  ● cart › totals\n\n    expect(received).toBe(expected)\n\nTest Suites: 1 failed, 1 total\nTests:       1 failed, 2 passed, 3 total\nSnapshots:   0 total\nTime:        0.5 s\n',
  pytest: '============ test session starts ============\ncollected 43 items\n\ntests/test_cart.py ..F..s.s\n\n========= FAILURES =========\nFAILED tests/test_cart.py::test_total - assert 3 == 4\n========= 1 failed, 40 passed, 2 skipped in 1.20s =========\n',
  mocha: '  cart\n    ✓ adds\n    1) totals\n\n  40 passing (2s)\n  2 pending\n  1 failing\n\n  1) cart\n       totals:\n     AssertionError: expected 3 to equal 4\n',
  go: '=== RUN   TestAdd\n--- PASS: TestAdd (0.00s)\n=== RUN   TestTotal\n--- FAIL: TestTotal (0.00s)\n    cart_test.go:12: got 3 want 4\nFAIL\nFAIL\texample.com/cart\t0.012s\nok  \texample.com/util\t(cached)\n',
  goQuiet: 'ok  \texample.com/cart\t0.012s\nok  \texample.com/util\t(cached)\n?   \texample.com/cmd\t[no test files]\n',
  cargo: 'running 3 tests\ntest tests::adds ... ok\ntest tests::totals ... FAILED\ntest tests::slow ... ignored\n\nfailures:\n\nfailures:\n    tests::totals\n\ntest result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s\n',
  plain: 'src/a.js:3: // 3 passed, 1 failed\nBuild ok\nok  everything fine\nTests run by CI only\n  Tests: none here\n## Tests: 3 suites\n42 files passing lint? no\n=== notes ===\n',
};
const PLANF = path.join(tmp, '.claude', 'plans', 'tour.md'); fs.mkdirSync(path.dirname(PLANF), { recursive: true }); fs.writeFileSync(PLANF, '# From its file\n\nStep one.\n');
const hunk = (o, lines) => ({ oldStart: o, oldLines: 1, newStart: o, newLines: 1, lines });
const claudeLines = [
  reminder([]),   // an empty list before any task: nothing to say
  ...call('toolu_tc1', 'TaskCreate', { subject: 'Write the tests', description: 'All of them', activeForm: 'Writing the tests' }, 'Task #1 created successfully: Write the tests', { tur: { task: { id: '1', subject: 'Write the tests' } } }),
  ...call('toolu_tu1', 'TaskUpdate', { taskId: '1', status: 'in_progress' }, 'Updated task #1 status', { tur: { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'in_progress' } } }),
  reminder([{ id: '1', subject: 'Write the tests', description: 'All of them', activeForm: 'Writing the tests', status: 'in_progress', blocks: [], blockedBy: [] }, { id: '2', subject: 'Ship', description: '', activeForm: 'Shipping', status: 'pending', blocks: [], blockedBy: ['1'] }]),
  ...call('toolu_ts1', 'TaskStop', { task_id: 'bqxyt1tyn' }, '{"message":"Successfully stopped task"}', { tur: { message: 'Successfully stopped task', task_id: 'bqxyt1tyn' } }),
  ...call('toolu_pw', 'Write', { file_path: PLANF, content: '# From its file' }, 'File created'),
  ...call('toolu_plan2', 'ExitPlanMode', {}, 'User approved', { tur: { plan: '# The one approved', isAgent: false, filePath: PLANF } }),   // Claude Code 2.1.30x: no plan in the call; its answer names it, the file may hold a later one
  ...call('toolu_plan3', 'ExitPlanMode', {}, 'User rejected'),   // rejected, no plan in the answer: the file
  { type: 'assistant', uuid: 'a-pw2', timestamp: T(), message: { id: 'msg_pw2', content: [{ type: 'tool_use', id: 'toolu_pw2', name: 'Write', input: { file_path: PLANF, content: '# Written with its call' } }, { type: 'tool_use', id: 'toolu_plan4', name: 'ExitPlanMode', input: { plan: '# The one before' } }] } },   // the plan written in the same message as its call, which carries the one before
  { type: 'user', uuid: 'u-pw2', timestamp: T(), message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_pw2', content: 'File created' }, { type: 'tool_result', tool_use_id: 'toolu_plan4', content: 'User rejected' }] } },
  ...call('toolu_plan', 'ExitPlanMode', { plan: '# Plan\n\n' + 'step\n'.repeat(1000), planFilePath: '/x/plan.md' }, 'User approved', { tur: { plan: '# Plan\n\n' + 'step\n'.repeat(1000), isAgent: false, filePath: '/x/plan.md' } }),
  ...call('toolu_pv1', 'mcp__Claude_Preview__preview_start', { name: 'web' }, [{ type: 'text', text: '{\n  "serverId": "s-1",\n  "port": 3211,\n  "name": "web",\n  "reused": false\n}\nServer started successfully on port 3211.' }]),
  ...call('toolu_pv2', 'mcp__Claude_Preview__preview_eval', { serverId: 's-1', expression: 'document.title' + ' '.repeat(200) + 'x' }, [{ type: 'text', text: '"Shop"' }]),
  ...call('toolu_pv3', 'mcp__Claude_Preview__preview_resize', { serverId: 's-1', width: 1440, height: 900 }, [{ type: 'text', text: 'Viewport set to 1440x900.' }]),
  ...call('toolu_pv4', 'mcp__Claude_Preview__preview_resize', { serverId: 's-1', preset: 'desktop' }, [{ type: 'text', text: 'Viewport reset to native size (desktop).' }]),
  ...call('toolu_pv5', 'mcp__Claude_Preview__preview_screenshot', { serverId: 's-1' }, [pic('image/jpeg', JPG)]),
  ...call('toolu_pv6', 'mcp__Claude_Preview__preview_console_logs', { serverId: 's-1', level: 'warn' }, [{ type: 'text', text: Array.from({ length: 15 }, (_, i) => '[warn] \x1b[33mline ' + i + '\x1b[39m').join('\n') }]),
  ...call('toolu_pv7', 'mcp__Claude_Preview__preview_logs', { serverId: 's-1' }, [{ type: 'text', text: 'No server errors found.' }]),
  ...call('toolu_pv8', 'mcp__Claude_Preview__preview_stop', { serverId: 's-1' }, [{ type: 'text', text: 'Server s-1 stopped' }]),
  ...call('toolu_pv9', 'mcp__Claude_Browser__preview_start', { name: 'web' }, [{ type: 'text', text: '{\n  "serverId": "s-2",\n  "port": 4000,\n  "name": "web",\n  "reused": true,\n  "tabId": "seed"\n}\nServer started successfully on port 4000. Opened tab seed.' }]),
  ...call('toolu_cw1', 'mcp__workspace__bash', { command: 'ls -la outputs' }, [{ type: 'text', text: 'total 0' }]),
  ...call('toolu_cw2', 'mcp__terminal__run_in_terminal', { command: 'npm test', title: 'Run the tests', cwd: '/x' }, [{ type: 'text', text: '{"tab_id":"t1","cwd":"/x"}\n' + OUTS.nodeTap }]),
  ...call('toolu_cw3', 'mcp__workspace__web_fetch', { url: 'https://example.com/a' }, [{ type: 'text', text: 'page' }]),
  ...call('toolu_cw4', 'mcp__cowork__present_files', { files: [{ file_path: path.join(tmp, 'out', 'report.pdf') }, 'relative.txt', path.join(tmp, 'out', 'b.png')] }, [{ type: 'text', text: 'ok' }]),
  ...call('toolu_ed1', 'Edit', { file_path: '/x/a.js', old_string: 'a', new_string: 'b' }, 'The file /x/a.js has been updated successfully.', { tur: { filePath: '/x/a.js', oldString: 'a', newString: 'b', originalFile: 'ORIGINAL-FILE-NEVER-KEPT\n'.repeat(50), structuredPatch: [hunk(3, [' ctx', '-a', '+b'])], userModified: false, replaceAll: false } }),
  ...call('toolu_wr1', 'Write', { file_path: '/x/new.js', content: 'hi' }, 'File created successfully at: /x/new.js', { tur: { type: 'create', filePath: '/x/new.js', content: 'hi', structuredPatch: [] } }),
  ...call('toolu_bd1', 'Bash', { command: 'node scripts/i18n.js' }, 'ok', { tur: { stdout: 'ok', stderr: '', interrupted: false, isImage: false, bashEditDiff: { files: ['a', 'b', 'c', 'd', 'e'].map((f) => ({ filePath: '/x/' + f + '.json', hunks: Array.from({ length: 6 }, (_, i) => hunk(i * 10 + 1, [' ' + 'L'.repeat(300), ...Array.from({ length: 50 }, (_, k) => '+' + k)])) })), moreFiles: 2, changedFiles: [] } } }),
  ...call('toolu_bg1', 'Bash', { command: 'node server.js', run_in_background: true }, 'Command running in background with ID: bqxyt1tyn. Output is being written to: /private/tmp/claude-501/x/s/tasks/bqxyt1tyn.output', { tur: { stdout: '', stderr: '', backgroundTaskId: 'bqxyt1tyn' } }),
  ...call('toolu_mo1', 'Monitor', { command: 'tail -f log', description: 'watch', timeout_ms: 300000 }, 'Monitor started', { tur: { taskId: 'bmon00001', timeoutMs: 300000, persistent: false } }),
  ...call('toolu_to1', 'TaskOutput', { task_id: 'bqxyt1tyn', block: false }, '<status>running</status>', { tur: { retrieval_status: 'not_ready', task: { task_id: 'bqxyt1tyn', task_type: 'local_bash', status: 'running', output: '', exitCode: null } } }),
  ...call('toolu_to2', 'TaskOutput', { task_id: 'a123' }, '<status>running</status>', { tur: { task: { task_id: 'a123', task_type: 'local_agent' } } }),
  ...call('toolu_ws1', 'WebSearch', { query: 'reduce' }, 'Web search results for query: "reduce"', { tur: { query: 'reduce', results: [{ tool_use_id: 'srv1', content: Array.from({ length: 10 }, (_, i) => ({ title: 'Result ' + i, url: 'https://example.com/' + i })) }, 'A summary the search wrote'], durationSeconds: 1.2 } }),
  ...call('toolu_wf1', 'WebFetch', { url: 'https://example.com/doc', prompt: 'what?' }, 'The page says hello', { tur: { url: 'https://example.com/doc', code: 200, codeText: 'OK', bytes: 12385, durationMs: 3552, result: 'The page says hello' } }),
  ...Object.entries(OUTS).flatMap(([k, out]) => call('toolu_t_' + k, 'Bash', { command: 'run ' + k }, out, { err: /fail|FAIL/.test(out) && k !== 'plain' })),
  ...call('toolu_an1', 'Bash', { command: 'ls --color' }, '\x1b[1;34mdir\x1b[0m  file\x1b]8;;http://x\x07link\x1b]8;;\x07'),
  ...call('toolu_tw1', 'Read', { file_path: '/x/a' }, 'a', { tur: { filePath: '/x/a' } }),
  { type: 'user', uuid: 'u-two', timestamp: T(), message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_tw1', content: 'again' }, { type: 'tool_result', tool_use_id: 'toolu_tc1', content: 'twice' }] }, toolUseResult: { task: { id: '9', subject: 'not this one' } } },   // a record that answers two calls: its toolUseResult belongs to neither
  { type: 'user', uuid: 'user-pasted-0001', timestamp: T(), message: { role: 'user', content: [{ type: 'text', text: 'Look at these' }, pic('image/png', PNG), pic('image/jpeg', JPG), pic('image/svg+xml', 'PHN2Zy8+')] } },
  { type: 'user', uuid: 'user-plain-0001', timestamp: T(), message: { role: 'user', content: 'No picture here' } },
  reminder([]),   // the list emptied, after tasks: news
];
const PROJ = '-scr', SID = 's1';
fs.mkdirSync(path.join(PROJECTS, PROJ), { recursive: true }); fs.writeFileSync(path.join(PROJECTS, PROJ, SID + '.jsonl'), claudeLines.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.mkdirSync(path.join(tmp, 'out'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'out', 'report.pdf'), '%PDF'); const old = new Date(Date.parse('2026-10-01T00:00:00Z')); fs.utimesSync(path.join(tmp, 'out', 'report.pdf'), old, old);   // written long before it was presented

test('Claude Code: task lists, plans, Claude Preview, Cowork tools, diffs, test runs, searches, pages read and background commands', async () => {
  const { port, stop } = await serve();
  try {
    const res0 = await get(port, `/api/session?proj=${PROJ}&id=${SID}`), body = res0.buf.toString('utf8'), ev = JSON.parse(body).events;
    const tools = Object.fromEntries(ev.filter((e) => e.kind === 'tools').flatMap((e) => e.tools).map((t) => [t.id, t])), items = ev.filter((e) => e.kind === 'results').flatMap((e) => e.items), res = Object.fromEntries(items.slice().reverse().map((it) => [it.id, it]));   // the first answer of each call
    assert.ok(!body.includes('ORIGINAL-FILE-NEVER-KEPT'), 'the original of an edited file is never sent');

    // the task list
    assert.deepEqual(tools.toolu_tc1.d, { kind: 'task', op: 'create', subject: 'Write the tests', active: 'Writing the tests' }); assert.equal(tools.toolu_tc1.arg, 'Write the tests');
    assert.deepEqual(res.toolu_tc1.task, { id: '1', subject: 'Write the tests' });
    assert.deepEqual(tools.toolu_tu1.d, { kind: 'task', op: 'update', taskId: '1', status: 'in_progress' });
    assert.equal(tools.toolu_ts1.d.kind, 'text', 'TaskStop is about a background command, not the list'); assert.equal(res.toolu_ts1.bg, undefined);
    const lists = ev.filter((e) => e.kind === 'tasks');
    assert.deepEqual(lists.map((e) => e.items.length), [2, 0], 'an empty reminder before any task says nothing; once there were tasks, an empty one empties the list');
    assert.deepEqual(lists[0].items, [{ id: '1', c: 'Write the tests', s: 'in_progress', a: 'Writing the tests' }, { id: '2', c: 'Ship', s: 'pending', a: 'Shipping' }]); assert.equal(lists[0].agent, 'main'); assert.ok(lists[0].k);
    const twice = items.filter((it) => it.id === 'toolu_tc1' || it.id === 'toolu_tw1').slice(-2); assert.deepEqual(twice.map((it) => [it.out, it.task]), [['again', undefined], ['twice', undefined]], 'a record that answers two calls lends its notes to neither');

    // the plan
    assert.equal(tools.toolu_plan2.d.text, '# The one approved', 'the plan its answer names, not the later one in the file'); assert.equal(tools.toolu_plan3.d.text, '# From its file', 'no plan in the answer: the plan as the session last wrote it, not the file as it is now'); assert.equal(tools.toolu_plan4.d.text, '# Written with its call', 'written in the same message: that plan, not the one before'); assert.equal(tools.toolu_plan.d.kind, 'plan'); assert.equal(tools.toolu_plan.d.text.length, 4000); assert.match(tools.toolu_plan.d.text, /^# Plan\n\nstep/);

    // Claude Preview: a browser, step by step, and what its answers say about the page
    assert.deepEqual(['toolu_pv1', 'toolu_pv2', 'toolu_pv3', 'toolu_pv4', 'toolu_pv5', 'toolu_pv6', 'toolu_pv7', 'toolu_pv8', 'toolu_pv9'].map((id) => tools[id].d), [
      { kind: 'browser', steps: [{ a: 'start' }] }, { kind: 'browser', steps: [{ a: 'eval', q: ('document.title' + ' '.repeat(200)).slice(0, 120) }] }, { kind: 'browser', steps: [{ a: 'resize', w: 1440, h: 900 }] }, { kind: 'browser', steps: [{ a: 'resize', preset: 'desktop' }] },
      { kind: 'browser', steps: [{ a: 'screenshot' }] }, { kind: 'browser', steps: [{ a: 'logs' }] }, { kind: 'browser', steps: [{ a: 'logs' }] }, { kind: 'browser', steps: [{ a: 'stop' }] }, { kind: 'browser', steps: [{ a: 'start' }] }]);
    assert.deepEqual(res.toolu_pv1.web, { u: 'http://localhost:3211' }); assert.equal(res.toolu_pv9.web.u, 'http://localhost:4000');
    assert.deepEqual(res.toolu_pv3.web, { f: [1440, 900] }); assert.equal(res.toolu_pv4.web, undefined); assert.equal(res.toolu_pv5.img, 1);
    assert.deepEqual(res.toolu_pv6.web.log, Array.from({ length: 12 }, (_, i) => '[warn] line ' + (i + 3)), 'the last 12 lines, without the colours'); assert.deepEqual(res.toolu_pv7.web, { log: [] });

    // Cowork's tools
    assert.deepEqual(tools.toolu_cw1.d, { kind: 'cmd', text: 'ls -la outputs', note: '' }); assert.deepEqual(tools.toolu_cw2.d, { kind: 'cmd', text: 'npm test', note: 'Run the tests' });
    assert.equal(res.toolu_cw2.tests.runner, 'node', 'a command in the person\'s terminal is a command too');
    assert.deepEqual(tools.toolu_cw3.d, { kind: 'web', url: 'https://example.com/a' });
    assert.equal(tools.toolu_cw4.d.kind, 'text'); assert.deepEqual(tools.toolu_cw4.d.outs, [path.join(tmp, 'out', 'report.pdf'), path.join(tmp, 'out', 'b.png')], 'absolute paths only');
    const reveal = (file) => get(port, '/api/reveal', { 'content-type': 'application/json' }, 'POST', JSON.stringify({ proj: PROJ, id: SID, file, check: true })).then((r) => r.json());
    assert.deepEqual(await reveal(path.join(tmp, 'out', 'report.pdf')), { ok: true, exists: true }, 'a file Cowork handed over, however old');
    assert.deepEqual(await reveal(path.join(tmp, 'out', 'b.png')), { exists: false, reason: 'gone' });

    // diffs
    assert.deepEqual(res.toolu_ed1.diff, { files: [{ file: '/x/a.js', hunks: [{ o: 3, n: 3, lines: [' ctx', '-a', '+b'] }] }] }); assert.equal(res.toolu_wr1.diff, undefined, 'a new file has no diff: the call shows what it wrote');
    const d = res.toolu_bd1.diff; assert.deepEqual(d.files.map((f) => f.file), ['/x/a.json', '/x/b.json', '/x/c.json']); assert.equal(d.more, 4, '2 Claude Code left out, 2 left out here');
    assert.equal(d.files[0].hunks.length, 4); assert.equal(d.files[0].hunks[1].o, 11); assert.equal(d.files[0].hunks[0].lines.length, 40); assert.equal(d.files[0].hunks[0].lines[0].length, 200);

    // background commands
    assert.equal(res.toolu_bg1.bg, 'bqxyt1tyn'); assert.equal(res.toolu_mo1.bg, 'bmon00001'); assert.equal(res.toolu_to1.bg, 'bqxyt1tyn'); assert.equal(res.toolu_to2.bg, undefined, 'a sub-agent\'s output is its transcript');

    // searches and pages
    assert.equal(res.toolu_ws1.search.length, 8); assert.deepEqual(res.toolu_ws1.search[0], { t: 'Result 0', u: 'https://example.com/0' });
    assert.deepEqual(res.toolu_wf1.fetch, { u: 'https://example.com/doc', code: 200, bytes: 12385, ms: 3552 }); assert.equal(res.toolu_wf1.out, 'The page says hello');

    // test runs
    const t = (k) => res['toolu_t_' + k].tests;
    assert.deepEqual(t('nodeSpec'), { runner: 'node', pass: 2, fail: 1, skip: 0, total: 3, failed: ['totals', 'cart'] });
    assert.deepEqual(t('nodeTap'), { runner: 'node', pass: 1, fail: 1, skip: 1, total: 3, failed: ['totals'] });
    assert.deepEqual(t('vitest'), { runner: 'vitest', pass: 2, fail: 1, skip: 1, total: 4, failed: ['test/cart.test.ts > cart > totals', 'cart > totals'] });
    assert.deepEqual(t('jest'), { runner: 'jest', pass: 2, fail: 1, skip: 0, total: 3, failed: ['cart › totals', 'totals'] });
    assert.deepEqual(t('pytest'), { runner: 'pytest', pass: 40, fail: 1, skip: 2, total: 43, failed: ['tests/test_cart.py::test_total'] });
    assert.deepEqual(t('mocha'), { runner: 'mocha', pass: 40, fail: 1, skip: 2, total: 43, failed: ['cart › totals'] });
    assert.deepEqual(t('go'), { runner: 'go', pass: 1, fail: 1, skip: 0, total: 2, failed: ['TestTotal'] });
    assert.deepEqual(t('goQuiet'), { runner: 'go', pass: 2, fail: 0, skip: 0, total: 2, failed: [] });
    assert.deepEqual(t('cargo'), { runner: 'cargo', pass: 1, fail: 1, skip: 1, total: 3, failed: ['tests::totals'] });
    assert.equal(t('plain'), undefined, 'numbers in any other output are not a test run');
    assert.ok(!res.toolu_t_vitest.out.includes('\x1b'), 'outputs come without the codes of a terminal'); assert.equal(res.toolu_an1.out, 'dir  filelink');
    assert.equal(res.toolu_t_nodeSpec.out.includes('ℹ tests 3'), true);

    // pictures pasted by the person
    const users = ev.filter((e) => e.kind === 'user');
    assert.deepEqual(users.map((e) => [e.text, e.img, e.iid]), [['Look at these', 2, 'user-pasted-0001'], ['No picture here', undefined, undefined]], 'the SVG is not a picture we show');
    const media = (q) => get(port, `/api/media?proj=${PROJ}&id=${SID}&` + q);
    let m = await media('agent=user&tool=user-pasted-0001&n=0'); assert.equal(m.status, 200); assert.equal(m.type, 'image/png'); assert.deepEqual(m.buf, Buffer.from(PNG, 'base64'));
    m = await media('agent=user&tool=user-pasted-0001&n=1'); assert.equal(m.type, 'image/jpeg');
    assert.equal((await media('agent=user&tool=user-pasted-0001&n=2')).status, 404);
    assert.equal((await media('agent=user&tool=u-toolu_pv5&n=0')).status, 404, 'a tool\'s picture is not the person\'s');
    assert.equal((await media('agent=main&tool=toolu_pv5&n=0')).status, 200);
    assert.equal((await media('agent=main&tool=user-pasted-0001&n=0')).status, 404, 'nor the other way round');
  } finally { stop(); }
});

// ---- Codex: pictures in their four places, a picture the person pasted, a search, a test run, a change, from a plain rollout and from a compressed one
const T0 = Date.now() - 5 * 60e3; let cclock = T0, ord = 0;
const rec = (type, payload) => JSON.stringify({ timestamp: new Date((cclock += 100)).toISOString(), ordinal: ++ord, type, payload });
const item = (it, turn = 'turn1') => rec('event_msg', { type: 'item_completed', thread_id: 't', turn_id: turn, item: it, started_at_ms: cclock, completed_at_ms: cclock });
const ri = (payload) => rec('response_item', payload);
const codexLines = (id) => [
  rec('session_meta', { session_id: id, id, timestamp: new Date(T0).toISOString(), cwd: path.join(os.homedir(), 'work', 'shop'), originator: 'Codex Desktop', cli_version: '0.158.0', source: 'vscode' }),
  rec('turn_context', { turn_id: 'turn1', model: 'gpt-test' }), rec('event_msg', { type: 'task_started', turn_id: 'turn1' }),
  ri({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Look' }, { type: 'input_image', image_url: 'data:image/png;base64,' + PNG, detail: 'high' }, { type: 'input_image', image_url: 'data:image/gif;base64,' + GIF }], internal_chat_message_metadata_passthrough: { turn_id: 'turn1' } }),
  item({ type: 'UserMessage', id: '01a00000-user-0001', content: [{ type: 'text', text: 'Look', text_elements: [] }, { type: 'local_image', path: '/x/a.png' }, { type: 'local_image', path: '/x/b.gif' }] }),
  ri({ type: 'function_call', id: 'fc_1', name: 'js', namespace: 'mcp__cua_repl', arguments: '{"code":"await gyro.getScreenshot();"}', call_id: 'call_cua_000001' }),
  item({ type: 'McpToolCall', id: 'call_cua_000001', server: 'cua_repl', tool: 'js', arguments: { code: 'await gyro.getScreenshot();' }, status: 'completed', result: { content: [{ type: 'text', text: 'shot' }, { type: 'image', data: JPG, mimeType: 'image/png' }], isError: false, _meta: { 'codex/toolSurface': { kind: 'browserUse', screenshot: { url: 'data:image/jpeg;base64,' + JPG } } } } }),
  ri({ type: 'function_call_output', call_id: 'call_cua_000001', output: [{ type: 'input_text', text: 'shot' }, { type: 'input_image', image_url: 'data:image/jpeg;base64,' + JPG }] }),   // the same pictures, raw: not counted again
  ri({ type: 'custom_tool_call', id: 'ctc_1', call_id: 'call_exec_0001', name: 'exec', input: 'image((await tools.view_image({path:"/x/a.png"})))' }),
  item({ type: 'ImageView', id: 'exec-view-0001', path: 'file:///x/my%20shot.png' }), item({ type: 'ImageView', id: 'exec-view-0002', path: '/x/b.gif' }),
  ri({ type: 'custom_tool_call_output', call_id: 'call_exec_0001', output: [{ type: 'input_text', text: 'Script completed' }, { type: 'input_image', image_url: 'data:image/png;base64,' + PNG }, { type: 'input_image', image_url: 'data:image/gif;base64,' + GIF }] }),
  item({ type: 'ImageView', id: 'exec-view-0003', path: '/x/c.png' }),
  ri({ type: 'custom_tool_call_output', call_id: 'call_exec_0002', output: [{ type: 'input_text', text: 'Script failed' }] }),   // looked at, nothing came back
  item({ type: 'Extension', kind: 'image_gen.generation', id: 'exec-gen-0001', status: 'completed', revisedPrompt: 'A cat', result: PNG + 'A'.repeat(64), failure: null, savedPath: '/x/gen.png' }),
  item({ type: 'Extension', id: 'ext_000001', kind: 'web.search', query: 'reduce', action: { type: 'search', queries: ['reduce'] }, results: Array.from({ length: 10 }, (_, i) => ({ title: 'R' + i, url: 'https://example.org/' + i, snippet: 's', domain: 'example.org' })) }),
  item({ type: 'CommandExecution', id: 'call_test_0001', command: ['/bin/zsh', '-lc', 'npm test'], status: 'failed', aggregated_output: OUTS.nodeSpec, exit_code: 1 }),
  item({ type: 'FileChange', id: 'call_fc_0001', changes: { '/x/cart.js': { type: 'update', unified_diff: '--- a/cart.js\n+++ b/cart.js\n@@ -1,2 +1,2 @@\n-a\n--- sql comment\n+b\n ctx\n' } }, status: 'completed' }),
  rec('event_msg', { type: 'task_complete', turn_id: 'turn1' }),
];
const PLAIN = '01a00000-0000-7000-8000-0000000000a1', ZST = '01a00000-0000-7000-8000-0000000000a2';
const cfile = (id, ext) => path.join(CX, 'sessions', '2026', '10', '20', `rollout-2026-10-20T10-00-00-${id}.jsonl${ext}`);
fs.mkdirSync(path.dirname(cfile(PLAIN, '')), { recursive: true }); fs.writeFileSync(cfile(PLAIN, ''), codexLines(PLAIN).join('\n') + '\n');
if (typeof zlib.zstdCompressSync === 'function') fs.writeFileSync(cfile(ZST, '.zst'), zlib.zstdCompressSync(Buffer.from(codexLines(ZST).join('\n') + '\n')));

for (const [label, id] of [['plain', PLAIN], ['compressed', ZST]]) test(`Codex (${label} rollout): pictures counted and served, the pasted ones too, searches, test runs and changes`, { skip: id === ZST && typeof zlib.zstdCompressSync !== 'function' && 'no zstd in this Node' }, async () => {
  const { port, stop } = await serve();
  try {
    const ev = (await get(port, `/api/session?proj=_codex&id=${id}`)).json().events, res = Object.fromEntries(ev.filter((e) => e.kind === 'results').flatMap((e) => e.items).map((it) => [it.id, it])), tools = Object.fromEntries(ev.filter((e) => e.kind === 'tools').flatMap((e) => e.tools).map((t) => [t.id, t]));
    assert.deepEqual(['call_cua_000001', 'exec-view-0001', 'exec-view-0002', 'exec-view-0003', 'exec-gen-0001'].map((k) => res[k] && res[k].img), [2, 1, 1, undefined, 1]);
    assert.equal(tools['exec-view-0001'].d.file, '/x/my shot.png', 'a file: address is a path');
    const u = ev.find((e) => e.kind === 'user'); assert.equal(u.img, 2); assert.equal(u.iid, '01a00000-user-0001');
    assert.deepEqual(res.ext_000001.search.length, 8); assert.deepEqual(res.ext_000001.search[1], { t: 'R1', u: 'https://example.org/1' });
    assert.equal(res.call_test_0001.tests.runner, 'node'); assert.equal(res.call_test_0001.tests.fail, 1);
    assert.deepEqual(res.call_fc_0001.diff, { files: [{ file: '/x/cart.js', hunks: [{ o: 1, n: 1, lines: ['-a', '--- sql comment', '+b', ' ctx'] }] }] });
    const media = (q) => get(port, `/api/media?proj=_codex&id=${id}&` + q);
    let m = await media('agent=main&tool=call_cua_000001&n=0'); assert.equal(m.status, 200); assert.equal(m.type, 'image/jpeg', 'written image/png, and a JPEG: the bytes say'); assert.deepEqual(m.buf, Buffer.from(JPG, 'base64'));
    assert.equal((await media('agent=main&tool=call_cua_000001&n=1')).status, 200, 'the browser\'s own picture of the page'); assert.equal((await media('agent=main&tool=call_cua_000001&n=2')).status, 404);
    m = await media('agent=main&tool=exec-view-0002&n=0'); assert.equal(m.type, 'image/gif'); m = await media('agent=main&tool=exec-view-0001&n=0'); assert.equal(m.type, 'image/png');
    assert.equal((await media('agent=main&tool=exec-view-0003&n=0')).status, 404);
    m = await media('agent=main&tool=exec-gen-0001&n=0'); assert.equal(m.status, 200); assert.equal(m.type, 'image/png');
    m = await media('agent=user&tool=01a00000-user-0001&n=1'); assert.equal(m.status, 200); assert.equal(m.type, 'image/gif');
    assert.equal((await media('agent=user&tool=01a00000-user-0001&n=2')).status, 404); assert.equal((await media('agent=main&tool=01a00000-user-0001&n=0')).status, 404);
    assert.equal((await media('agent=main&tool=..&n=0')).status, 400);
  } finally { stop(); }
});

// ---- /api/taskout
const uid = typeof process.getuid === 'function' ? process.getuid() : null;
test('the output of a background command: its last whole lines without terminal codes, whether it is over and how, read only where Claude Code writes it', { skip: uid == null && 'no uid on this system' }, async () => {
  const tasks = (key) => { const d = path.join(CTMP, 'claude-' + uid, key, SID, 'tasks'); fs.mkdirSync(d, { recursive: true }); return d; };
  fs.writeFileSync(path.join(tasks(PROJ), 'brun00001.output'), 'start\n\x1b[32mgreen\x1b[0m\n10%\r50%\r100%\n');
  fs.writeFileSync(path.join(tasks(PROJ), 'bdone0001.output'), 'built\n[exited with code 2]\n');
  const big = path.join(tasks(PROJ), 'bbig00001.output'); fs.writeFileSync(big, Array.from({ length: 3000 }, (_, i) => 'line ' + i).join('\n') + '\n');
  const quiet = path.join(tasks(PROJ), 'bquiet001.output'); fs.writeFileSync(quiet, 'waiting\n'); const t = new Date(Date.now() - 11 * 60e3); fs.utimesSync(quiet, t, t);
  fs.writeFileSync(path.join(tasks(PROJ + '--claude-worktrees-x'), 'bwork0001.output'), 'from the worktree\n');   // a session that moved to a worktree writes under that folder's name
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'secret\n'); fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(tasks(PROJ), 'blink0001.output'));
  const { port, stop } = await serve(), ask = (q) => get(port, '/api/taskout?' + q);
  try {
    let r = (await ask(`proj=${PROJ}&id=${SID}&task=brun00001`)).json(); assert.equal(r.text, 'start\ngreen\n100%\n'); assert.equal(r.done, false); assert.equal(r.code, null); assert.ok(r.size > 0 && r.mtime > 0);
    r = (await ask(`proj=${PROJ}&id=${SID}&task=bdone0001`)).json(); assert.equal(r.done, true); assert.equal(r.code, 2);
    r = (await ask(`proj=${PROJ}&id=${SID}&task=bbig00001`)).json(); assert.ok(Buffer.byteLength(r.text) <= 12 * 1024); assert.match(r.text, /^line \d+\n/); assert.match(r.text, /line 2999\n$/); assert.equal(r.size, fs.statSync(big).size);
    r = (await ask(`proj=${PROJ}&id=${SID}&task=bquiet001`)).json(); assert.equal(r.done, true, 'silent for 10 minutes'); assert.equal(r.code, null);
    r = (await ask(`proj=${PROJ}&id=${SID}&task=bwork0001`)).json(); assert.equal(r.text, 'from the worktree\n');
    assert.equal((await ask(`proj=${PROJ}&id=${SID}&task=blink0001`)).status, 404, 'a link is not followed');
    assert.equal((await ask(`proj=${PROJ}&id=${SID}&task=bnone0001`)).status, 404);
    assert.equal((await ask(`proj=${PROJ}&id=nosuchsession&task=brun00001`)).status, 404, 'only a session the call knows');
    assert.equal((await ask(`proj=_codex&id=${PLAIN}&task=brun00001`)).status, 404);
    for (const q of [`proj=${PROJ}&id=${SID}&task=..%2Fsecret`, `proj=${PROJ}&id=${SID}&task=`, `proj=${PROJ}&id=${SID}&task=${'b'.repeat(41)}`, `proj=${PROJ}&id=..&task=brun00001`, `proj=..&id=${SID}&task=brun00001`, `proj=${PROJ}&id=.&task=brun00001`, `proj=a%2Fb&id=${SID}&task=brun00001`]) assert.equal((await ask(q)).status, 400, q);
    assert.equal((await get(port, `/api/taskout?proj=${PROJ}&id=${SID}&task=brun00001`, { 'sec-fetch-site': 'cross-site' })).status, 403);
  } finally { stop(); }
});
