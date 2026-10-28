// test/extension.test.js: the VS Code extension against a stand-in for the vscode module. What it registers, and the call going to the Claude Code tab you go to:
// VS Code tells a tab's label, not its session, so the label is looked up among the titles of the recent sessions.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), Module = require('module');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-ext-'));
process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs.json'); process.env.AGENT_STANDUP_KOKORO_DIR = path.join(tmp, 'kokoro'); process.env.AGENT_STANDUP_PROJECTS = path.join(tmp, 'projects'); process.env.AGENT_STANDUP_CODEX = 'off'; process.env.AGENT_STANDUP_VIBE = 'off'; process.env.AGENT_STANDUP_CC_SESSIONS = path.join(tmp, 'sessions'); process.env.AGENT_STANDUP_ANSWER = 'dry';   // not the status of the sessions open on the machine the tests run on

// ---- sessions with a title, the way Claude Code writes one ----
function titled(proj, id, title, minutesAgo) {
  const dir = path.join(tmp, 'projects', proj), file = path.join(dir, id + '.jsonl'), at = Date.now() - minutesAgo * 60000; fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, [{ type: 'user', message: { role: 'user', content: 'hello' } }, { type: 'assistant', message: { id: 'm1', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ready.' }] } }, { type: 'custom-title', customTitle: title }].map((r) => JSON.stringify({ timestamp: new Date(at).toISOString(), ...r })).join('\n') + '\n');
  fs.utimesSync(file, at / 1000, at / 1000);
}
titled('-work-app', 'long', 'Fix the login page and its tests', 5); titled('-work-app', 'short', 'Short title', 9); titled('-work-app', 'spaced', 'Two  spaces\tand a tab in the title', 12);
titled('-other', 'twin', 'Fix the login page and its tests', 1); titled('-other', 'away', 'Only in another folder', 3); titled('-work-app', 'lastweek', 'A conversation of last week', 6 * 24 * 60);   // twin: the same title in another folder, and more recent. All of them are there before the extension first looks: it keeps what it read for a moment
// ---- VS Code, as much of it as the extension touches ----
function standIn({ tabGroups = true } = {}) {
  const v = { cmds: {}, provider: null, sent: [], tabs: [], groups: [], panels: 0, errors: [], active: null, opened: [], relay: null };
  const webview = (where) => ({ options: {}, html: '', onDidReceiveMessage: (f) => { v.relay = f; return { dispose() {} }; }, postMessage: (m) => { v.sent.push({ where, ...m }); return Promise.resolve(true); } });
  const settings = { port: 0, statusBar: true, onlyThisWorkspace: true, autoOpen: false, claudePath: '', charactersPath: '', shareUsage: false, notifyNeedsYou: true };
  v.vscode = {
    workspace: { getConfiguration: () => ({ get: (k) => settings[k] }), workspaceFolders: [{ uri: { fsPath: '/work/app' } }], onDidChangeConfiguration: (f) => { v.conf = f; return { dispose() {} }; } },
    commands: { registerCommand: (n, f) => { v.cmds[n] = f; return { dispose() {} }; }, executeCommand: async () => {} },
    window: { state: { focused: true }, showErrorMessage: (m) => v.errors.push(m), showInformationMessage: () => {}, onDidChangeWindowState: () => ({ dispose() {} }),
      registerWebviewViewProvider: (id, p) => { v.provider = p; return { dispose() {} }; },
      createWebviewPanel: () => { v.panels++; return (v.panelObj = { webview: (v.panel = webview('panel')), reveal() {}, onDidDispose() {} }); },   // panelObj: a test can put it in view (visible)
      createStatusBarItem: () => ({ show() {}, dispose() {}, text: '', tooltip: '' }),
      ...(tabGroups ? { tabGroups: { get activeTabGroup() { return v.active; }, onDidChangeTabs: (f) => { v.tabs.push(f); return { dispose() {} }; }, onDidChangeTabGroups: (f) => { v.groups.push(f); return { dispose() {} }; } } } : {}) },
    env: { isTelemetryEnabled: false, asExternalUri: async (u) => u, openExternal: async (u) => { v.opened.push(u); return true; } },
    Uri: { parse: (s) => ({ toString: () => s }), file: (s) => ({ fsPath: s, toString: () => 'file://' + s }) },
    ViewColumn: { Beside: -2 }, StatusBarAlignment: { Right: 2 }, ThemeColor: class { constructor(id) { this.id = id; } },
  };
  v.settings = settings;
  v.go = async (tab, column = 1) => { v.active = tab === undefined ? null : { viewColumn: column, activeTab: tab }; const n = v.sent.length; await Promise.all(v.tabs.map((f) => f({}))); return v.sent.slice(n); };   // the sessions are asked of the server, which runs in a process of its own   // you go to this tab: what the call is sent
  return v;
}
const claude = (label) => ({ label, input: { viewType: 'mainThreadWebview-claudeVSCodePanel' } });
async function activated(v, first, more = {}) {   // a fresh copy of the extension for each stand-in: it keeps its panel and its last tab to itself. first: the session the status bar opens the call on
  const load = Module._load; Module._load = function (req, ...a) { return req === 'vscode' ? v.vscode : load.call(this, req, ...a); };
  const file = require.resolve('../extension.js'); delete require.cache[file]; const ext = require(file), ctx = { subscriptions: [], globalState: { get() {}, update: async () => {} }, ...more };   // more: e.g. the extension's own folder (globalStorageUri)
  const log = console.log; console.log = () => {};
  try { ext.activate(ctx); if (more.noOpen) return { ext, close: async () => { for (const s of ctx.subscriptions) try { s.dispose && s.dispose(); } catch {} await ext.deactivate(); } }; await v.cmds['agentStandup.open'](first); await v.provider.resolveWebviewView({ webview: (v.side = { options: {}, html: '', onDidReceiveMessage: () => ({ dispose() {} }), postMessage: (m) => { v.sent.push({ where: 'side', ...m }); return Promise.resolve(true); } }), onDidDispose() {} }); } finally { console.log = log; Module._load = load; }
  return { ext, close: async () => { for (const s of ctx.subscriptions) try { s.dispose && s.dispose(); } catch {} await ext.deactivate(); } };
}

test('the server runs in a process of its own, not in the extension host every extension shares; a setting changed in the editor reaches it, and it ends with the extension', async () => {
  const v = standIn(), x = await activated(v), srv = await x.ext._server();
  try {
    assert.ok(srv.kid && srv.kid.pid !== process.pid, 'a process of its own'); assert.equal(srv.server, undefined);
    const get = (p) => new Promise((res) => require('http').get({ host: '127.0.0.1', port: srv.port, path: p }, (m) => { let b = ''; m.on('data', (d) => (b += d)); m.on('end', () => res(JSON.parse(b))); }));
    const dir = path.join(tmp, 'my-characters'); v.settings.charactersPath = dir; v.conf({ affectsConfiguration: (k) => k === 'agentStandup.charactersPath' });
    let seen = ''; for (let i = 0; i < 50 && seen !== dir; i++) { seen = (await get('/api/characters')).dir; if (seen !== dir) await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(seen, dir, 'the new folder, in the server');
  } finally { await x.close(); }
  for (let i = 0; i < 50 && srv.kid.exitCode === null && srv.kid.signalCode === null; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(srv.kid.exitCode !== null || srv.kid.signalCode !== null, 'ended with the extension');
});

test('a window whose call is never opened starts no server: its status bar reads the ends of the transcripts itself, as before', async () => {
  const v = standIn(), x = await activated(v, undefined, { noOpen: true });
  try { await new Promise((r) => setTimeout(r, 300)); assert.equal(x.ext._server(), null); } finally { await x.close(); }
});

test('a server that ends while the call is open comes back, on the same port, also in a window that is not focused', async () => {
  const v = standIn(), x = await activated(v), first = await x.ext._server();
  try {
    v.vscode.window.state.focused = false; first.kid.kill('SIGKILL');
    let next = null; for (let i = 0; i < 80 && !(next && next.kid && next.kid.pid !== first.kid.pid); i++) { await new Promise((r) => setTimeout(r, 100)); const s = x.ext._server(); next = s ? await s : null; }
    assert.ok(next && next.kid && next.kid.pid !== first.kid.pid, 'started again'); assert.equal(next.port, first.port, 'where the open call looks for it');
  } finally { await x.close(); }
});

test('server.js run by a manager that gives it a channel (pm2) is the plain server on its own port: the editor\'s mode is asked for by name', async () => {
  const net = require('net'), port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const kid = require('child_process').fork(path.join(__dirname, '..', 'server.js'), [], { env: { ...process.env, PORT: String(port), AGENT_STANDUP_CHILD: '' }, stdio: ['ignore', 'pipe', 'ignore', 'ipc'] }), said = [];
  kid.on('message', (m) => said.push(m));
  try {
    let up = false; for (let i = 0; i < 50 && !up; i++) { await new Promise((r) => setTimeout(r, 100)); up = await new Promise((r) => require('http').get({ host: '127.0.0.1', port, path: '/api/health' }, (m) => { m.resume(); r(m.statusCode === 200); }).on('error', () => r(false))); }
    assert.ok(up, 'on the port it was given'); assert.deepEqual(said, [], 'and it says nothing on the channel');
  } finally { kid.kill(); }
});

test('the extension registers its commands, its panel and its sidebar view, also on a VS Code that has no tab groups', async () => {
  const v = standIn({ tabGroups: false }), x = await activated(v);
  try {
    assert.deepEqual(Object.keys(v.cmds).sort(), ['agentStandup.focus', 'agentStandup.open', 'agentStandup.openCharacters', 'agentStandup.openInBrowser', 'agentStandup.openStatus']);
    assert.equal(v.panels, 1); assert.match(v.side.html, /<iframe src="http:\/\/localhost:\d+\/\?live=1&proj=-work-app&embed=1"/); assert.deepEqual(v.errors, []);
  } finally { await x.close(); }
});

test('a rating is asked on the third day the call is opened, for the store the editor installs from; "Later", closing it or no answer asks again a week later, one last time', async () => {
  const v = standIn(), x = await activated(v), asked = [], tick = () => new Promise((r) => setImmediate(r));
  let answer; v.vscode.window.showInformationMessage = (m, ...b) => { asked.push([m, ...b]); return Promise.resolve(answer === undefined ? undefined : b[answer]); };
  const store = () => { const m = new Map(); return { get: (k) => m.get(k), update: async (k, val) => { m.set(k, val); } }; };
  const use = async (st, ...days) => { for (const d of days) { x.ext._noteUse(st, d); await tick(); } };
  try {
    v.vscode.env.uriScheme = 'vscode';
    const st = store(); await use(st, '2026-10-01', '2026-10-01', '2026-10-02'); assert.equal(asked.length, 0);   // two days, however many times the call was opened
    answer = 1; await use(st, '2026-10-05'); assert.equal(asked.length, 1); assert.deepEqual(asked[0], ['Enjoying Agent Standup? A rating helps other people find it.', 'Rate it', 'Later', 'No thanks']);
    await use(st, '2026-10-06', '2026-10-11'); assert.equal(asked.length, 1);   // "Later": not before a week
    answer = undefined; await use(st, '2026-10-12'); assert.equal(asked.length, 2);   // asked again, and closed this time: that was the last
    await use(st, '2026-10-30'); assert.equal(asked.length, 2); assert.deepEqual(v.opened, []);
    answer = 0; await use(store(), '2026-10-01', '2026-10-02', '2026-10-03'); assert.deepEqual(v.opened, [x.ext._ratePages.vscode]);   // the review page of the Marketplace, link as text
    v.vscode.env.uriScheme = 'cursor'; await use(store(), '2026-10-01', '2026-10-02', '2026-10-03'); assert.deepEqual(v.opened.slice(-1), [x.ext._ratePages.other]);   // Cursor, VSCodium… install from Open VSX
    answer = 2; await use(store(), '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-20'); assert.equal(asked.length, 5); assert.equal(v.opened.length, 2);   // "No thanks": never again
    v.vscode.window.showInformationMessage = (m, ...b) => { asked.push([m, ...b]); return new Promise(() => {}); };   // left alone: VS Code tucks it into the bell, and no answer ever comes
    const left = store(); await use(left, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-09'); assert.equal(asked.length, 6);
    await use(left, '2026-10-10', '2026-10-30'); assert.equal(asked.length, 7);   // a week later, one last time
    const old = store(); await old.update('rate.days', 3); await old.update('rate.last', '2026-10-03'); await old.update('rate.done', true);   // asked by an earlier version, which ended it as it showed
    await use(old, '2026-10-27', '2026-11-30'); assert.equal(asked.length, 8);   // once more, the last time
    assert.match(x.ext._ratePages.vscode, /^https:\/\/marketplace\.visualstudio\.com\/items\?itemName=DoubleGeste\.agent-standup&/); assert.match(x.ext._ratePages.other, /^https:\/\/open-vsx\.org\/extension\/DoubleGeste\/agent-standup\//);
  } finally { await x.close(); }
});

test('a day an agent works counts towards the rating, call opened or not; ⚙ › Rate in the page opens the store page and ends the asking', async () => {
  const m = new Map(), st = { get: (k) => m.get(k), update: async (k, val) => { m.set(k, val); } }, v = standIn(), r0 = process.env.AGENT_STANDUP_RATE;
  v.vscode.env.uriScheme = 'vscode'; const x = await activated(v, undefined, { globalState: st, noOpen: true });
  try {
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(m.get('rate.days'), 1); assert.equal(m.get('rate.last'), new Date().toISOString().slice(0, 10));   // the status bar saw the sessions of this folder at work
    assert.equal(process.env.AGENT_STANDUP_RATE, x.ext._ratePages.vscode);   // the page opened in a browser rates on the same store
    x.ext._rateNow(st); assert.deepEqual(v.opened, [x.ext._ratePages.vscode]); assert.equal(m.get('rate.over'), true);
  } finally { await x.close(); if (r0 == null) delete process.env.AGENT_STANDUP_RATE; else process.env.AGENT_STANDUP_RATE = r0; }
});

test('sharing usage is asked once, the first time the call is opened, never when VS Code telemetry is off; yes turns it on for every window, and a week is counted once', async () => {
  const v = standIn(), x = await activated(v), asked = [], sent = [], updates = [], conf = { shareUsage: false };
  v.vscode.workspace.getConfiguration = () => ({ get: (k) => conf[k], update: async (k, val, target) => { updates.push([k, val, target]); conf[k] = val; } });
  v.vscode.ConfigurationTarget = { Global: 1 }; x.ext._net.pixel = (name) => sent.push(name);
  let answer; v.vscode.window.showInformationMessage = (m, ...b) => { asked.push(b); return Promise.resolve(answer == null ? undefined : b[answer]); };
  const store = () => { const m = new Map(); return { get: (k) => m.get(k), update: async (k, val) => { m.set(k, val); } }; };
  try {
    await x.ext._askUsage(store()); assert.equal(asked.length, 0);   // the stand-in's telemetry is off: the person has already said no to that
    v.vscode.env.isTelemetryEnabled = true;
    const a = store(); answer = 2; await x.ext._askUsage(a);   // "Privacy policy": the page, then the question once more, without that button; closed
    assert.deepEqual(asked, [['Count me in', 'No thanks', 'Privacy policy'], ['Count me in', 'No thanks']]); assert.deepEqual(v.opened.map(String), ['https://agent-standup.com/privacy/']);
    await x.ext._askUsage(a); assert.equal(asked.length, 2); assert.equal(conf.shareUsage, false); assert.deepEqual(sent, []);   // never asked again, nothing sent
    answer = 0; await x.ext._askUsage(store()); assert.deepEqual(updates, [['shareUsage', true, 1]]); assert.deepEqual(sent, ['app-week.gif']);   // "Count me in": on for all windows, this week counted
    await x.ext._askUsage(store()); assert.equal(asked.length, 3);   // already on: not asked
    const w = store(); for (const t of ['2026-10-12T08:00:00Z', '2026-10-14T20:00:00Z', '2026-10-18T23:59:00Z', '2026-10-19T00:01:00Z']) x.ext._pingWeek(w, new Date(t));
    assert.deepEqual(sent, ['app-week.gif', 'app-week.gif', 'app-week.gif']);   // one for the week of Monday 12 October, one for the week of the 19th
    assert.equal(x.ext._mondayOf(new Date('2026-10-18T23:59:00Z')), '2026-10-12'); assert.equal(x.ext._mondayOf(new Date('2026-10-19T00:01:00Z')), '2026-10-19');
    conf.shareUsage = false; x.ext._pingWeek(store(), new Date('2026-10-26T10:00:00Z')); conf.shareUsage = true; v.vscode.env.isTelemetryEnabled = false; x.ext._pingWeek(store(), new Date('2026-10-26T10:00:00Z'));
    assert.equal(sent.length, 3);   // off, or VS Code telemetry off: nothing
    v.vscode.env.isTelemetryEnabled = true; conf.shareUsage = false; answer = null; const deaf = { get() {}, update: async () => {} };   // a store that has not written the answer yet: the panel and the side bar open together
    await Promise.all([x.ext._askUsage(deaf), x.ext._askUsage(deaf)]); assert.equal(asked.length, 4, 'asked once by this window');
    v.vscode.workspace.getConfiguration = () => ({ get: (k) => conf[k], inspect: () => ({ globalValue: undefined, workspaceValue: false }), update: async () => {} });   // this workspace sets it off: yes would change nothing
    await x.ext._askUsage(store()); assert.equal(asked.length, 4);
  } finally { await x.close(); }
});

test('the status bar opens the call on a session without changing the folder the window follows: a Vibe session is kept under its tool, which is not a folder', async () => {
  const v = standIn(), x = await activated(v, { id: 'abc-123', proj: '_vibe' });
  try {
    assert.match(v.panel.html, /<iframe src="http:\/\/localhost:\d+\/\?live=1&proj=-work-app&pin=abc-123&pproj=_vibe&embed=1"/);   // proj used to be _vibe here: the window then showed Vibe sessions only, also once the call was let go
    assert.match(v.side.html, /\?live=1&proj=-work-app&embed=1"/);
  } finally { await x.close(); }
});

test('the call is sent to the Claude Code tab you go to: found by its title, whole or cut, this workspace first; no other tab moves it, and the same tab only once', async () => {
  const v = standIn(), x = await activated(v), to = (id, proj) => ['panel', 'side'].map((where) => ({ where, agentStandup: 'pin', id, proj, tab: true }));
  try {
    assert.equal(v.tabs.length, 1); assert.equal(v.groups.length, 1);
    assert.deepEqual(await v.go({ label: 'server.js', input: { uri: {} } }), [], 'a file');
    assert.deepEqual(await v.go({ label: 'Agent Standup', input: { viewType: 'mainThreadWebview-agentStandup' } }), [], 'the call itself');
    assert.deepEqual(await v.go({ label: 'Welcome' }), [], 'a tab that says nothing of what it shows'); assert.deepEqual(await v.go(undefined), [], 'no tab at all');
    assert.deepEqual(await v.go(claude('Claude Code')), [], 'a conversation that has no title yet');
    assert.deepEqual(await v.go(claude('No session has this title')), [], 'a title no recent session has');
    assert.deepEqual(await v.go(claude('Short title')), to('short', '-work-app'), 'a whole title: the panel and the sidebar view are both told');
    assert.deepEqual(await v.go(claude('Short title')), [], 'the same tab again: the call may have been moved by hand since');
    assert.deepEqual(await v.go(claude('Short')), [], 'a whole label is a whole title, not the start of one');
    assert.deepEqual(await v.go(claude('Fix the login page and i…')), to('long', '-work-app'), 'a title cut after 24 characters: this workspace before a more recent session elsewhere');
    assert.deepEqual(await v.go(claude('Two spaces and a tab in …')), to('spaced', '-work-app'), 'spaces are told apart by neither side');
    assert.deepEqual(await v.go(claude('Only in another folder')), to('away', '-other'), 'a session of another folder, when this workspace has none by that title');
    assert.deepEqual(await v.go(claude('Short title'), 2), to('short', '-work-app'), 'the same title in another column is another tab');
    assert.equal(require('../server.js').boardRows().some((r) => r.id === 'lastweek'), false); assert.deepEqual(await v.go(claude('A conversation of last w…')), to('lastweek', '-work-app'), 'a conversation of another day is no longer among the sessions of the moment: it is found in the whole list');
    v.active = null; assert.doesNotThrow(() => v.groups[0]({}));
  } finally { await x.close(); }
});

test('an editor reopened with three windows counts its day and its week once, not once per window: the first window to mark it sends it', async () => {
  const dir = path.join(tmp, 'storage'), sent = [], store = () => { const m = new Map(); return { get: (k) => m.get(k), update: async (k, val) => { m.set(k, val); } }; }, xs = [];
  try {
    for (let i = 0; i < 3; i++) { const v = standIn(); xs.push(await activated(v, undefined, { globalStorageUri: { fsPath: dir } })); v.settings.shareUsage = true; v.vscode.env.isTelemetryEnabled = true; xs[i].ext._net.pixel = (name) => sent.push(name); }
    for (const x of xs) x.ext._pingActive({ globalState: store() });   // each window's store has not heard of the others yet
    for (const x of xs) x.ext._pingWeek(store());
    assert.deepEqual(sent, ['app-active.gif', 'app-week.gif']);
  } finally { for (const x of xs) await x.close(); }
});

test('a link the page asks for is opened on a known site only; the draft of a problem report is handed over as text, so that its query arrives whole', async () => {
  const v = standIn(), x = await activated(v), ask = (url) => v.relay({ agentStandup: 'openExternal', url });
  try {
    const draft = 'https://github.com/Atoll92/agent-standup/issues/new?title=a%20%26%20b&body=line%0A%23%20one', coffee = 'https://www.buymeacoffee.com/bored_dev_and_his_robots';
    ask(draft); ask(coffee); ask('https://example.com/?x=1'); ask('http://github.com/Atoll92/agent-standup/issues/new?title=a'); ask('not a link');
    assert.equal(v.opened.length, 2); assert.equal(v.opened[0], draft);   // as text: given as a Uri, VS Code decodes and re-encodes the query, and "&" or "#" cut the draft
    assert.equal(typeof v.opened[1], 'object'); assert.equal(v.opened[1].toString(), coffee);
    const pay = 'https://checkout.stripe.com/c/pay/cs_test_a1B2#fidkdWxOYHwnPyd1blpxYHZxWjA0'; ask(pay); ask('https://checkout.stripe.com.example.com/c/pay/cs_test_a1B2');   // the payment page of a pack: Stripe's own address only, and with its fragment whole
    assert.equal(v.opened.length, 3); assert.equal(v.opened[2], pay);
    const art = 'https://claude.ai/artifact/AbCdEf123456'; ask(art); ask('https://claude.ai/code/artifact/0f81abdd-8134-4fc0-889a-28c4fe7dbb8f'); ask('https://claude.ai/settings'); ask('https://claude.ai.example.com/artifact/AbCdEf123456'); ask('https://claude.ai/artifact/../settings');   // an artifact the call shows: that page of claude.ai, and no other
    assert.equal(v.opened.length, 5); assert.equal(v.opened[3].toString(), art);
  } finally { await x.close(); }
});

// ---- "needs you": a notification when a session starts to wait on you, naming it and what it asks ----
const waits = (over = {}) => ({ proj: '-work-app', id: 'wait-1', title: 'Fix the  login\tpage', state: 'blocked', since: 1e12, mtime: 1e12, tool: 'Bash', ask: 'Bash(npm test)', ...over });
const tick = () => new Promise((r) => setImmediate(r));

test('a session that starts to wait on you is told once, naming it and what it asks, never reminded, and told again only when it waits again', async () => {
  const v = standIn(), told = [], x = await activated(v, undefined, { noOpen: true }), T = 1e12;
  v.vscode.window.showInformationMessage = (m, ...b) => { told.push([m, ...b]); return Promise.resolve(undefined); };
  try {
    x.ext._needsYou([waits()], T); assert.deepEqual(told, [['✋ Fix the login page is waiting for you: Bash(npm test)', 'Go to session', 'Open call']]);
    x.ext._needsYou([waits()], T + 4000); x.ext._needsYou([waits()], T + 5 * 60e3 - 1); assert.equal(told.length, 1, 'not at every scan');
    x.ext._needsYou([waits()], T + 5 * 60e3); x.ext._needsYou([waits()], T + 60 * 60e3); assert.equal(told.length, 1, 'no reminder');
    x.ext._needsYou([waits({ state: 'working' })], T + 61 * 60e3); x.ext._needsYou([waits({ since: T + 62 * 60e3 })], T + 62 * 60e3); assert.equal(told.length, 2, 'answered, then waiting again: told again');
    x.ext._needsYou([waits({ id: 'q', title: 'Pick a name', tool: 'AskUserQuestion', ask: 'Which name do you want for the new command, the short one or the long one that says exactly what it does?' }), waits({ id: 'p', title: 'Plan it', tool: 'ExitPlanMode', ask: undefined }), waits({ id: 'm', title: 'A menu', tool: '', ask: undefined }), waits({ id: 'w', state: 'working' })], T);
    assert.deepEqual(told.slice(2).map((t) => t[0]), ['✋ Pick a name is waiting for you: Which name do you want for the new command, the short one or the long one that…', '✋ Plan it is waiting for you: a plan to approve', '✋ A menu is waiting for you'], 'one per session; the question cut to about 80 characters');
  } finally { await x.close(); }
});

test('no "needs you" notification when the setting is off, when the call is in view, or on that session\'s Claude Code tab; "Go to session" opens the call on it', async () => {
  const v = standIn(), told = [], x = await activated(v), T = 1e12; let answer;
  v.vscode.window.showInformationMessage = (m, ...b) => { told.push([m, ...b]); return Promise.resolve(answer == null ? undefined : b[answer]); };
  try {
    v.settings.notifyNeedsYou = false; x.ext._needsYou([waits()], T); x.ext._needsYou([waits()], T + 5 * 60e3); assert.equal(told.length, 0, 'setting off');
    v.settings.notifyNeedsYou = true; v.panelObj.visible = true; x.ext._needsYou([waits()], T); assert.equal(told.length, 0, 'the call is in view: the page alerts itself');
    v.relay({ agentStandup: 'notify', text: 'An agent may be waiting for you ✋' }); assert.equal(told.length, 1, 'the page\'s own alert, call in view');
    v.panelObj.visible = false; x.ext._needsYou([waits()], T + 60e3); assert.equal(told.length, 1, 'already seen in the call');
    v.relay({ agentStandup: 'notify', text: 'An agent may be waiting for you ✋' }); v.relay({ agentStandup: 'notify', text: 'Your agents are done 🎉' }); assert.deepEqual(told.slice(1).map((t) => t[0]), ['Agent Standup: An agent may be waiting for you ✋', 'Agent Standup: Your agents are done 🎉'], 'call out of view and nothing told by the extension: the page\'s ✋ is the only word of it (a stalled agent, a sub-agent, another folder)');
    x.ext._needsYou([waits()], T + 5 * 60e3); assert.equal(told.length, 3, 'seen in the call: no reminder once it is out of view'); x.ext._needsYou([], T + 6 * 60e3);
    answer = 0; const n = v.sent.length; x.ext._needsYou([waits({ since: T + 7 * 60e3 })], T + 7 * 60e3); assert.match(told[3][0], /^✋ Fix the login page/, 'answered, then a new wait, the call out of view');
    v.relay({ agentStandup: 'notify', text: 'An agent may be waiting for you ✋' }); assert.equal(told.length, 4, 'right after the notification that names the session, the page\'s generic ✋ is the same news: not shown');
    await tick(); await tick(); assert.deepEqual(v.sent.slice(n), [{ where: 'panel', agentStandup: 'pin', id: 'wait-1', proj: '-work-app' }], 'Go to session: what the status bar does for it');
    v.active = { viewColumn: 1, activeTab: claude('Fix the login page and i…') }; x.ext._needsYou([waits({ id: 'tab', title: 'Fix the login page and its tests' })], T); assert.equal(told.length, 4, 'you are on its tab');
    x.ext._needsYou([waits({ id: 'tab', title: 'Fix the login page and its tests' }), waits({ id: 'other', title: 'Another one' })], T); assert.equal(told.length, 5, 'another session is told');
  } finally { await x.close(); }
});

test('the status bar\'s scan tells the sessions of this workspace that wait on you, once', async () => {
  const dir = path.join(tmp, 'projects', '-work-app'), file = path.join(dir, 'asking.jsonl'), at = Date.now() - 20000, told = [];
  fs.writeFileSync(file, [{ type: 'user', message: { role: 'user', content: 'name it' } }, { type: 'custom-title', customTitle: 'Name the command' }, { type: 'assistant', message: { id: 'm2', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'AskUserQuestion', input: { questions: [{ question: 'Short or long name?', header: 'Name', options: [{ label: 'Short' }, { label: 'Long' }] }] } }] } }].map((r) => JSON.stringify({ timestamp: new Date(at).toISOString(), ...r })).join('\n') + '\n');
  fs.utimesSync(file, at / 1000, at / 1000); fs.mkdirSync(process.env.AGENT_STANDUP_CC_SESSIONS, { recursive: true }); const sf = path.join(process.env.AGENT_STANDUP_CC_SESSIONS, '4242.json'); fs.writeFileSync(sf, JSON.stringify({ pid: process.pid, sessionId: 'asking', status: 'waiting', waitingFor: 'input needed', statusUpdatedAt: at }));   // Claude Code says its question is open: a call left pending alone is only a guess, never told
  await new Promise((r) => setTimeout(r, 1300));   // past the scan the other tests shared
  const v = standIn(); v.vscode.window.showInformationMessage = (m, ...b) => { told.push(m); return Promise.resolve(undefined); };
  const x = await activated(v, undefined, { noOpen: true });
  try {
    await tick(); assert.deepEqual(told, ['✋ Name the command is waiting for you: Short or long name?']);
    await new Promise((r) => setTimeout(r, 4300)); assert.equal(told.length, 1, 'the next scan says nothing');
  } finally { await x.close(); fs.unlinkSync(file); fs.unlinkSync(sf); }
});

test('two windows on the same folder tell a wait once between them', async () => {
  const dir = path.join(tmp, 'storage-needs'), told = [], xs = [], T = 1e12;
  try {
    for (let i = 0; i < 2; i++) { const v = standIn(); xs.push(await activated(v, undefined, { globalStorageUri: { fsPath: dir }, noOpen: true })); v.vscode.window.showInformationMessage = (m) => { told.push([i, m]); return Promise.resolve(undefined); }; }
    for (const x of xs) x.ext._needsYou([waits()], T); assert.equal(told.length, 1);
    for (const x of xs) x.ext._needsYou([waits()], T + 5 * 60e3); assert.equal(told.length, 1, 'no reminder');
    for (const x of xs) { x.ext._needsYou([], T + 6 * 60e3); x.ext._needsYou([waits({ since: T + 7 * 60e3 })], T + 7 * 60e3); } assert.equal(told.length, 2, 'a new wait');
  } finally { for (const x of xs) await x.close(); }
});

// ---- which sessions are this workspace's: its folder, or a folder inside it (a worktree, a package), never the folder beside it with a longer name ----
function started(cwd, id, title, secondsAgo) {   // a session started in that folder, asking a question, that Claude Code says is open
  const proj = cwd.replace(/[^a-zA-Z0-9]/g, '-'), dir = path.join(tmp, 'projects', proj), file = path.join(dir, id + '.jsonl'), at = Date.now() - secondsAgo * 1000; fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, [{ type: 'user', cwd, sessionId: id, message: { role: 'user', content: 'go' } }, { type: 'custom-title', customTitle: title }, { type: 'assistant', cwd, sessionId: id, message: { id: 'm-' + id, role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu-' + id, name: 'AskUserQuestion', input: { questions: [{ question: 'Which one?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }] } }] } }].map((r) => JSON.stringify({ timestamp: new Date(at).toISOString(), ...r })).join('\n') + '\n');
  fs.utimesSync(file, at / 1000, at / 1000); fs.mkdirSync(process.env.AGENT_STANDUP_CC_SESSIONS, { recursive: true });
  const sf = path.join(process.env.AGENT_STANDUP_CC_SESSIONS, (started.n = (started.n || 5000) + 1) + '.json'); fs.writeFileSync(sf, JSON.stringify({ pid: process.pid, sessionId: id, status: 'waiting', waitingFor: 'input needed', statusUpdatedAt: at }));
  return { proj, files: [file, sf] };
}

test('the status bar and its notifications count the sessions of a folder inside the workspace (a worktree, a package), not those of a folder beside it', async () => {
  const made = [started('/work/app/.claude/worktrees/feat-x', 'wt', 'In a worktree', 30), started('/work/app/packages/api', 'pkg', 'In a package', 90), started('/work/app-old', 'old', 'Beside it', 20)], told = [];
  await new Promise((r) => setTimeout(r, 1300));   // past the scan the other tests shared
  const v = standIn(); let item = null; const make = v.vscode.window.createStatusBarItem; v.vscode.window.createStatusBarItem = () => (item = make());
  v.vscode.window.showInformationMessage = (m) => { told.push(m); return Promise.resolve(undefined); };
  const x = await activated(v, undefined, { noOpen: true });
  try {
    await tick(); assert.deepEqual(told.sort(), ['✋ In a package is waiting for you: Which one?', '✋ In a worktree is waiting for you: Which one?']);
    assert.match(item.text, /2 needs you/); assert.ok(!/Beside it/.test(item.tooltip), 'app-old is beside app, not in it');
    assert.match(item.tooltip, /✋ In a worktree · Which one\? · for less than a minute/); assert.match(item.tooltip, /✋ In a package · Which one\? · for 1 min/);
    const ws = '-work-app', is = (r) => x.ext._inWorkspace(r, ws);
    assert.deepEqual([is({ proj: ws }), is({ proj: made[0].proj, id: 'wt' }), is({ proj: made[1].proj, id: 'pkg' }), is({ proj: made[2].proj, id: 'old' }), is({ proj: '-work-application', id: 'x' }), is({ proj: '-other', id: 'x' })], [true, true, true, false, false, false]);
    assert.equal(is({ proj: '-work-app-new', id: 'not-written-yet' }), true, 'no folder to tell by: counted by its name, as the call does');
    assert.deepEqual([is({ proj: '_vibe', id: 'v', dir: ws }), is({ proj: '_codex', id: 'c', dir: '-elsewhere' })], [true, false], 'a Codex or Vibe session, by the folder it was started in');
  } finally { await x.close(); for (const m of made) for (const f of m.files) fs.unlinkSync(f); }
});

test('a folder inside the workspace and a folder beside it with the same project name are told apart session by session, whichever is read first', async () => {
  const v = standIn(), x = await activated(v, undefined, { noOpen: true }), made = [];
  const put = (proj, id, cwd) => { const d = path.join(tmp, 'projects', proj); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, id + '.jsonl'); fs.writeFileSync(f, JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: 'go' } }) + '\n'); made.push(f); };
  put('-w3-app-old', 'in3', '/w3/app/old'); put('-w3-app-old', 'by3', '/w3/app-old'); put('-w4-app-old', 'in4', '/w4/app/old'); put('-w4-app-old', 'by4', '/w4/app-old');   // Claude Code names app/old and app-old alike
  try {
    const is = (proj, id, ws) => x.ext._inWorkspace({ proj, id }, ws);
    assert.deepEqual([is('-w3-app-old', 'in3', '-w3-app'), is('-w3-app-old', 'by3', '-w3-app')], [true, false], 'the one inside read first');
    assert.deepEqual([is('-w4-app-old', 'by4', '-w4-app'), is('-w4-app-old', 'in4', '-w4-app')], [false, true], 'the one beside read first');
  } finally { await x.close(); for (const f of made) fs.unlinkSync(f); }
});

test('on Windows the workspace is found whatever the case of its drive letter: VS Code writes c:\\, Claude Code C:\\', async () => {
  const v = standIn(), x = await activated(v, undefined, { noOpen: true }), real = Object.getOwnPropertyDescriptor(process, 'platform');
  const wt = path.join(tmp, 'projects', 'C--work-app--claude-worktrees-b'), old = path.join(tmp, 'projects', 'C--work-app-old');
  fs.mkdirSync(wt, { recursive: true }); fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(wt, 'w1.jsonl'), JSON.stringify({ type: 'user', cwd: 'C:\\work\\app\\.claude\\worktrees\\b', message: { role: 'user', content: 'go' } }) + '\n');
  fs.writeFileSync(path.join(old, 'o1.jsonl'), JSON.stringify({ type: 'user', cwd: 'C:\\work\\app-old', message: { role: 'user', content: 'go' } }) + '\n');
  try {
    v.vscode.workspace.workspaceFolders = [{ uri: { fsPath: 'c:\\work\\app' } }];
    Object.defineProperty(process, 'platform', { ...real, value: 'win32' });
    const key = x.ext._projKey(), is = (r) => x.ext._inWorkspace(r, key);
    assert.equal(key, 'C--work-app', 'the name Claude Code gives the project, sent to the call too');
    assert.deepEqual([is({ proj: 'C--work-app' }), is({ proj: 'c--work-app' }), is({ proj: 'C--work-app--claude-worktrees-b', id: 'w1' }), is({ proj: 'C--work-app-old', id: 'o1' })], [true, true, true, false]);
    Object.defineProperty(process, 'platform', real); assert.equal(x.ext._projKey(), 'c--work-app', 'elsewhere a name is taken as it is written');
  } finally { Object.defineProperty(process, 'platform', real); await x.close(); fs.rmSync(wt, { recursive: true, force: true }); fs.rmSync(old, { recursive: true, force: true }); }
});

test('the status bar\'s tooltip says what a session that waits asks and for how long; one stopped by the usage limit, or logged out, says so instead of having given up', async () => {
  const v = standIn(), x = await activated(v, undefined, { noOpen: true }), T = 1e12, line = (r) => x.ext._tipLine({ proj: '-work-app', id: 'i', title: 'Ship it', state: 'turn', mtime: T, ...r }, T);
  try {
    assert.equal(line({ state: 'blocked', tool: 'Bash', ask: 'Bash(npm test)', since: T - 30e3 }), '✋ Ship it · Bash(npm test) · for less than a minute');
    assert.equal(line({ state: 'blocked', tool: 'ExitPlanMode', since: T - 7 * 60e3 }), '✋ Ship it · a plan to approve · for 7 min');
    assert.equal(line({ state: 'blocked', tool: '', since: T - 125 * 60e3 }), '✋ Ship it · for 2 h 5 min');
    assert.equal(line({ state: 'blocked', tool: 'AskUserQuestion' }), '✋ Ship it', 'no time known: none said');
    assert.equal(line({ limit: { resets: '7:20pm (Europe/Paris)' } }), '⏳ Ship it · usage limit · resets 7:20pm (Europe/Paris)');
    assert.equal(line({ limit: { resets: '' } }), '⏳ Ship it · usage limit');
    assert.equal(line({ auth: 1 }), '⚠ Ship it · logged out');
    assert.deepEqual([line({ gave: 1 }), line({}), line({ state: 'working' })], ['⚠ Ship it', '✓ Ship it', '⚙ Ship it'], 'the others as before');
  } finally { await x.close(); }
});

test('the status bar says "your turn" only for a turn you can take: sessions stopped by the usage limit say when it resets, a lost login says so', async () => {
  const v = standIn(), x = await activated(v, undefined, { noOpen: true }), bar = (...rows) => x.ext._barText(rows.map((r, i) => ({ proj: '-work-app', id: 'i' + i, title: 'T' + i, state: 'turn', mtime: 1e12, ...r })));
  try {
    assert.equal(bar({}, { limit: { resets: '7:20pm (Europe/Paris)' } }), '$(device-camera-video) $(check) your turn', 'one turn you can take: your turn');
    assert.equal(bar({ limit: { resets: '7:20pm (Europe/Paris)' } }, { limit: { resets: '7:20pm (Europe/Paris)' } }), '$(device-camera-video) ⏳ usage limit · resets 7:20pm', 'all stopped by the limit: when it resets, without its zone');
    assert.equal(bar({ limit: { resets: '' } }), '$(device-camera-video) ⏳ usage limit');
    assert.equal(bar({ auth: 1 }), '$(device-camera-video) $(warning) logged out');
    assert.equal(bar({ state: 'working' }, { limit: { resets: '3pm' } }), '$(device-camera-video) $(sync~spin) 1 working', 'another at work: as before');
    assert.equal(bar({ state: 'blocked' }, {}), '$(device-camera-video) $(warning) 1 needs you');
    assert.equal(bar(), '$(device-camera-video) Agent Standup');
  } finally { await x.close(); }
});
