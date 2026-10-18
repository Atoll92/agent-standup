// Agent Standup — VS Code extension host. Runs the local server in a process of its own and shows it in a webview.
const vscode = require('vscode');
const http = require('http'), fs = require('fs'), path = require('path');

let panel = null, side = null, status = null, started = null;
const logErr = (where, e) => { try { require('./server.js').logError(where, e); } catch {} };   // the local error log (see logError in server.js): nothing is sent

const cfg = () => vscode.workspace.getConfiguration('agentStandup');
const tt = (s, ...a) => (vscode.l10n && vscode.l10n.t ? vscode.l10n.t(s, ...a) : s.replace(/\{(\d+)\}/g, (_, i) => a[i]));   // runtime strings: bundles in ./l10n, the English text is the key
const projKey = () => {
  const f = vscode.workspace.workspaceFolders;
  if (!f || !f.length || !cfg().get('onlyThisWorkspace')) return '';
  return f[0].uri.fsPath.replace(/[^a-zA-Z0-9]/g, '-');   // Claude Code's project-dir naming
};
const ping = (port) => new Promise((res) => {
  const r = http.get({ host: '127.0.0.1', port, path: '/api/current', timeout: 1500 }, (m) => { m.resume(); res(m.statusCode === 200); });
  r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); });
});
const getJson = (port, p) => new Promise((res, rej) => {   // what the server knows (the board, the sessions), asked over HTTP: it runs in another process
  const r = http.get({ host: '127.0.0.1', port, path: p, timeout: 10000 }, (m) => { let b = ''; m.setEncoding('utf8'); m.on('data', (d) => (b += d)); m.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
  r.on('error', rej); r.on('timeout', () => { r.destroy(); rej(new Error('timeout')); });
});

// Each window runs its own server on a free port (a fixed port can be set; if that port already serves Agent Standup it is reused).
// Reusing someone else's server by default caused trouble: it may run without the right environment (e.g. no way to call `claude`).
// The server runs in a process of its own (the editor's own runtime, as a plain Node): in the extension host, which every extension shares, reading a large session held them all,
// Claude Code's included, for a second or more. If that process cannot be started, or ends three times in a minute, the server runs in the extension host as it used to.
let lastPort = 0, crashes = [], inHost = false;
function hostServer(wanted, resolve) {
  const srv = require('./server.js').start(wanted);
  srv.once('listening', () => resolve({ port: (lastPort = srv.address().port), server: srv }));
  srv.once('error', async () => resolve((await ping(wanted)) ? { port: wanted } : { port: wanted, error: true }));
}
function ensureServer() {
  if (started) return started;
  const wanted = cfg().get('port') || lastPort || 0;   // lastPort: a server that ended comes back on the same port, so the open panels find it again
  const mine = (started = new Promise((resolve) => {
    if (inHost) return hostServer(wanted, resolve);
    let kid, done = false, ours = false;
    try { kid = require('child_process').fork(path.join(__dirname, 'server.js'), [], { env: { ...process.env, ...serverEnv(), PORT: String(wanted), ELECTRON_RUN_AS_NODE: '1', AGENT_STANDUP_CHILD: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); }
    catch (e) { logErr('server process', e); inHost = true; return hostServer(wanted, resolve); }
    const late = setTimeout(() => { if (!done) { logErr('server process', new Error('no answer in 8 s')); done = true; inHost = true; try { kid.kill(); } catch {} hostServer(wanted, resolve); } }, 8000);   // an editor whose runtime cannot run as Node: the extension host it is
    kid.on('message', async (m) => {
      clearTimeout(late);
      if (done) return;
      if (m && m.port) { done = ours = true; resolve({ port: (lastPort = m.port), kid }); }
      else if (m && m.error) { done = true; if (!cfg().get('port') && wanted === lastPort && wanted) { lastPort = 0; if (started === mine) started = null; return resolve(ensureServer()); } resolve(m.error === 'EADDRINUSE' && (await ping(wanted)) ? { port: wanted } : { port: wanted, error: true }); }   // the port set in the settings is taken: by another window's server (used) or by something else (said). The port of a server that ended, taken meanwhile: any free one
    });
    kid.on('error', (e) => { logErr('server process', e); if (!done) { inHost = true; done = true; hostServer(wanted, resolve); } });
    kid.on('exit', () => {
      clearTimeout(late);
      if (!done) { done = true; inHost = true; return hostServer(wanted, resolve); }   // it ended before it listened: the extension host it is
      if (ours && started === mine && !stopping) { started = null; const now = Date.now(); crashes = crashes.filter((t) => now - t < 60000).concat(now); if (crashes.length >= 3) inHost = true; }   // the next poll starts it again
    });
  }));
  return started;
}
let stopping = false;
async function url() {
  const { port, error } = await ensureServer();
  if (error) throw new Error(`Port ${port} is busy and not serving Agent Standup. Set agentStandup.port to 0 (automatic) or another port.`);
  const q = `?live=1&proj=${encodeURIComponent(projKey())}`;
  return `http://localhost:${port}/${q}`;
}

async function openPanel(pin) {   // pin: { id, proj } of the session to follow (from the status bar)
  opened();
  if (panel) { try { panel.reveal(); if (pin && pin.id) panel.webview.postMessage({ agentStandup: 'pin', id: pin.id, proj: pin.proj }); return; } catch { panel = null; } }   // a disposed panel falls through and is recreated
  let u;
  try { u = await url(); } catch (e) { return vscode.window.showErrorMessage(e.message); }
  if (pin && pin.id) u += `&pin=${encodeURIComponent(pin.id)}&pproj=${encodeURIComponent(pin.proj || '')}`;   // the session the call opens on, and where it is kept (pproj). The window goes on following its own folder (proj): a Vibe or Codex session is kept under its tool, which is not a folder, and put in proj it left the window showing that tool's sessions only
  const ext = await vscode.env.asExternalUri(vscode.Uri.parse(u + '&embed=1'));
  panel = vscode.window.createWebviewPanel('agentStandup', 'Agent Standup', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
  relay(panel.webview); panel.webview.html = frameHtml(ext.toString(true));
  panel.onDidDispose(() => (panel = null));
}
const frameHtml = (src) => `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:* http://127.0.0.1:* https:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <style>html,body{margin:0;height:100%;background:#12131a}iframe{border:0;width:100%;height:100vh}</style></head>
    <body><iframe src="${src}" allow="autoplay; clipboard-write"></iframe>
    <script>const vs = acquireVsCodeApi(); const fr = document.querySelector('iframe'); addEventListener('message', (e) => { if (e.source === fr.contentWindow) { if (e.data && e.data.agentStandup) vs.postMessage(e.data); } else if (e.data && e.data.agentStandup === 'pin') fr.contentWindow.postMessage(e.data, '*'); });</script></body></html>`;
// Messages from the page: open it in the browser, or open a donation link or the draft of a problem report (https only, known sites only).
// A link that carries a query (the draft of a report) is handed over as text: given as a Uri, VS Code decodes and re-encodes the query, and the draft arrives cut at its first "&" or "#".
const DONATE_HOSTS = /^(www\.)?(buymeacoffee\.com|ko-fi\.com|paypal\.me|paypal\.com|github\.com)$/, SHOP_HOSTS = /^(checkout\.stripe\.com|agent-standup\.com|(www\.)?instagram\.com)$/, ARTIFACT_PATH = /^\/(code\/)?artifact\/[\w-]+$/;   // SHOP_HOSTS: the payment page of a pack bought from ⚙ → Characters, and the page of the artist who drew it. Its address ends with a fragment the page needs, so it is handed over as text too
const relay = (webview) => webview.onDidReceiveMessage((m) => {
  if (!m) return;
  if (m.agentStandup === 'openBrowser') openBrowser();
  if (m.agentStandup === 'openCharacters') openCharacters();
  if (m.agentStandup === 'rate') rateNow();
  if (m.agentStandup === 'notify' && typeof m.text === 'string' && !(m.text.includes('✋') && cfg().get('notifyNeedsYou') !== false && !callInView() && Date.now() - needsTold < 60e3)) vscode.window.showInformationMessage('Agent Standup: ' + m.text.slice(0, 120));   // the page's own "may be waiting for you ✋", from a call out of view, a minute after the notification that names the session (see needsYou): the same news twice. Otherwise it is the only word of it (a stalled agent, a sub-agent's approval, a session of another folder)
  if (m.agentStandup === 'openExternal') { try { const u = new URL(m.url); if (u.protocol === 'https:' && (DONATE_HOSTS.test(u.hostname) || SHOP_HOSTS.test(u.hostname) || (u.hostname === 'claude.ai' && ARTIFACT_PATH.test(u.pathname)))) vscode.env.openExternal(u.search || u.hash ? u.toString() : vscode.Uri.parse(u.toString())); } catch {} }
});

// Sidebar view: the same live call, in the activity bar.
const sidebar = {
  async resolveWebviewView(view) {
    view.webview.options = { enableScripts: true }; relay(view.webview); opened(); side = view; view.onDidDispose(() => { if (side === view) side = null; });
    try {
      const ext = await vscode.env.asExternalUri(vscode.Uri.parse((await url()) + '&embed=1'));
      view.webview.html = frameHtml(ext.toString(true));
    } catch (e) { view.webview.html = `<body style="font:13px sans-serif;color:#ccc;padding:12px">${e.message}</body>`; }
  },
};

// The call goes to the Claude Code tab you are on: the conversation on one side of a split screen, its call on the other (off in the page's ⚙).
// VS Code tells a tab's label, not its session. Claude Code names a tab after the title of its session, cut after 24 characters: the label is looked up among the recent sessions,
// this workspace's first, the most recent first (two conversations whose titles start with the same 24 characters cannot be told apart: the label is all there is). A tab that has no title yet ("Claude Code") or matches nothing changes nothing. The sidebar chat and a terminal are not tabs: nothing says which session they show.
let tabKey = '';
async function followTab() {
  try {
    if (!panel && !side) return; const g = vscode.window.tabGroups.activeTabGroup, t = g && g.activeTab, vt = t && t.input && t.input.viewType;
    if (typeof vt !== 'string' || !vt.includes('claudeVSCodePanel')) return;   // any other tab (a file, the call itself): the call stays where it is
    const key = g.viewColumn + '|' + t.label; if (key === tabKey) return; tabKey = key;   // only when you change tab: the call may have been moved by hand since
    const one = (x) => String(x).replace(/\s+/g, ' ').trim(), cut = /…$/.test(t.label), label = one(t.label.replace(/…$/, '')); if (!label || t.label === 'Claude Code') return;
    const f = vscode.workspace.workspaceFolders, ws = f && f.length ? f[0].uri.fsPath.replace(/[^a-zA-Z0-9]/g, '-') : '';
    const { port, error } = await ensureServer(); if (error) return; const named = (list) => list.filter((r) => typeof r.title === 'string' && (cut ? one(r.title).startsWith(label) : one(r.title) === label));
    let rows = named(await getJson(port, '/api/board')); if (!rows.length) rows = named(await getJson(port, '/api/sessions'));   // a conversation of another day is no longer among the sessions of the moment: it is looked up in the whole list
    const r = rows.find((x) => ws && (x.proj === ws || x.proj.startsWith(ws + '-'))) || rows[0]; if (!r) return;
    for (const w of [panel, side]) if (w) w.webview.postMessage({ agentStandup: 'pin', id: r.id, proj: r.proj, tab: true });
  } catch (e) { if (!/ECONNREFUSED|ECONNRESET|socket hang up|timeout|JSON/.test(String(e && e.message))) logErr('follow tab', e); }   // a server that is starting again is not an error
}

// "Needs you": a notification when a session the status bar counts starts to wait on you (a question, an approval, a plan), naming it and what it asks (agentStandup.notifyNeedsYou).
// Once when it starts to wait, once more ("Still waiting") if it still waits 5 minutes later, then nothing until it waits again. Not while the call is in view (the page alerts itself),
// nor while you are on that session's Claude Code tab (its question is in front of you). Windows on the same folder share a mark in the extension's folder: the first to tell it tells it.
let needsTold = 0;   // when needsYou last showed a notification (the clock, not the scan's time)
const REMIND_MS = 5 * 60e3, needsSeen = new Map();   // "proj/id" → { ep, at, reminded }: the sessions that wait on you, since when this window has known it
const callInView = () => !!((panel && panel.visible) || (side && side.visible));
const oneLine = (x) => String(x).replace(/\s+/g, ' ').trim(), clip = (s, n) => { s = oneLine(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
function onTabOf(r) {   // the same match as followTab: the tab's label, whole or cut after 24 characters, against the session's title
  try {
    const g = vscode.window.tabGroups && vscode.window.tabGroups.activeTabGroup, t = g && g.activeTab, vt = t && t.input && t.input.viewType;
    if (typeof vt !== 'string' || !vt.includes('claudeVSCodePanel') || typeof t.label !== 'string' || typeof r.title !== 'string' || t.label === 'Claude Code') return false;
    const cut = /…$/.test(t.label), label = oneLine(t.label.replace(/…$/, '')); return !!label && (cut ? oneLine(r.title).startsWith(label) : oneLine(r.title) === label);
  } catch { return false; }
}
function claimNeeds(k, ep, kind) {   // true: this window is the first to tell it (no folder of its own, as in the tests: always)
  try {
    const dir = extCtx && extCtx.globalStorageUri && extCtx.globalStorageUri.fsPath; if (!dir) return true; const d = path.join(dir, 'needs'), now = Date.now(); fs.mkdirSync(d, { recursive: true });
    if (now - claimNeeds.tidy > 3600e3) { claimNeeds.tidy = now; for (const f of fs.readdirSync(d)) try { if (now - fs.statSync(path.join(d, f)).mtimeMs > 864e5) fs.unlinkSync(path.join(d, f)); } catch {} }   // marks older than a day
    fs.closeSync(fs.openSync(path.join(d, require('crypto').createHash('sha1').update(k + '\n' + ep).digest('hex').slice(0, 24) + '-' + kind), 'wx')); return true;
  } catch (e) { return !(e && e.code === 'EEXIST'); }
}
claimNeeds.tidy = 0;
function needsText(r) {
  const plan = r.tool === 'ExitPlanMode' || (r.menu && r.menu.kind === 'plan'), what = r.ask || (plan ? tt('a plan to approve') : /^(AskUserQuestion)?$/.test(r.tool || '') ? '' : r.tool), name = clip(r.title || r.id, 60);
  return what ? tt('{0} is waiting for you: {1}', name, clip(what, 80)) : tt('{0} is waiting for you', name);
}
function needsYou(rows, now = Date.now()) {   // rows: those the status bar counts, read in a focused window
  const on = cfg().get('notifyNeedsYou') !== false, here = new Set();
  for (const r of on ? rows : []) {
    if (r.state !== 'blocked') continue;
    const k = r.proj + '/' + r.id, ep = String(r.since || r.mtime || 0); here.add(k);
    let s = needsSeen.get(k); const again = !!s;   // a session that waits on and on is one wait, even when what says since when changes
    if (!s) needsSeen.set(k, (s = { ep, at: now, reminded: false }));
    else if (s.reminded || now - s.at < REMIND_MS) continue;
    if (callInView() || onTabOf(r)) continue;   // seen: the call or its tab shows it; a reminder may still come later
    if (again) s.reminded = true; if (!claimNeeds(k, s.ep, again ? 'again' : 'first')) continue;
    const text = needsText(r), go = tt('Go to session'), call = tt('Open call'); needsTold = Date.now();
    Promise.resolve(vscode.window.showInformationMessage('✋ ' + (again ? tt('Still waiting: {0}', text) : text), go, call)).then((a) => { if (a === go) return openPanel({ id: r.id, proj: r.proj }); if (a === call) return openPanel(); }, () => {});   // go: what the status bar does for that session
  }
  for (const k of [...needsSeen.keys()]) if (!here.has(k)) needsSeen.delete(k);   // answered (or the setting off): the next wait is told again
}

// The folder where the person drops their own pixel art (lead.png, you.png, others for the sub-agents, name-talk.png for an open mouth).
async function openCharacters() {
  try {
    const dir = require('./server.js').charactersDir(); const fresh = !fs.existsSync(dir); fs.mkdirSync(dir, { recursive: true });
    if (fresh) fs.writeFileSync(require('path').join(dir, 'README.txt'), 'Put your pixel art here (PNG, GIF, WebP, up to 300 KB each).\nlead.png = the lead · you.png = you · any other image = a sub-agent\nname-talk.png = optional open-mouth frame of name.png\nThen press Reload in the Agent Standup settings menu.\n');
    vscode.env.openExternal(vscode.Uri.file(dir));
  } catch (e) { vscode.window.showErrorMessage(e.message); }
}
async function openBrowser() {
  try { vscode.env.openExternal(vscode.Uri.parse(await url())); } catch (e) { vscode.window.showErrorMessage(e.message); }
}

// Opt-in only (agentStandup.shareUsage, off until the person says yes, and never when VS Code telemetry is off): empty requests for 1-pixel files on GitHub, so the project can count how much it is used.
// app-active.gif at most once a day when the editor starts (installs in use); app-week.gif at most once a week (weeks from Monday, UTC) when the call is opened: the requests of a week
// are the number of people who opened the call that week. Nothing is sent in a request: no id, no path, no content. (net: so that the tests send nothing)
const net = { pixel: (name) => { const r = require('https').get({ host: 'github.com', path: '/Atoll92/agent-standup/releases/download/stats/' + name, headers: { 'user-agent': 'agent-standup' }, timeout: 5000 }, (m) => { m.resume(); m.destroy(); }); r.on('error', () => {}); r.on('timeout', () => r.destroy()); } };
const sharing = () => !!cfg().get('shareUsage') && vscode.env.isTelemetryEnabled !== false;
// Once per day or week for all the windows: what one window stores in globalState reaches the others only later, and an editor reopened with several windows sent one request each.
// The first window to create the file of that day (or week) in the extension's own folder sends it; any other finds the file there. No folder (an old editor, the tests): as before.
function firstHere(name, period) {
  try {
    const dir = extCtx && extCtx.globalStorageUri && extCtx.globalStorageUri.fsPath; if (!dir) return true; fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (f.startsWith('sent-' + name + '-') && f !== 'sent-' + name + '-' + period) try { fs.unlinkSync(path.join(dir, f)); } catch {}
    fs.closeSync(fs.openSync(path.join(dir, 'sent-' + name + '-' + period), 'wx')); return true;
  } catch (e) { return !(e && e.code === 'EEXIST'); }
}
function pingActive(ctx) {
  try {
    if (!sharing()) return;
    const day = new Date().toISOString().slice(0, 10); if (ctx.globalState.get('lastActivePing') === day) return;
    ctx.globalState.update('lastActivePing', day); if (firstHere('active', day)) net.pixel('app-active.gif');
  } catch {}
}
const mondayOf = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
function pingWeek(st = extCtx && extCtx.globalState, now = new Date()) {
  try {
    if (!st || !sharing()) return;
    const week = mondayOf(now); if (st.get('lastWeekPing') === week) return;
    st.update('lastWeekPing', week); if (firstHere('week', week)) net.pixel('app-week.gif');
  } catch {}
}
// Asked once, the first time the call is opened (also of those who had the extension before this question existed): would they help count how many people use it? "Count me in" turns the
// setting on for all their windows; any other answer leaves it off, and it is not asked again. Not asked when VS Code telemetry is off (that answer is already given) or the setting is on.
// "Privacy policy" opens the policy and asks again, that one time, without the button.
const PRIVACY_PAGE = 'https://agent-standup.com/privacy/';
const askedHere = new WeakSet();   // the stores this window has already asked about: the panel and the side bar open together, and the answer may not be stored yet when the second one asks
function askUsage(st = extCtx && extCtx.globalState, again = false) {
  try {
    const set = cfg().inspect ? cfg().inspect('shareUsage') || {} : {};   // a workspace or folder that sets it off keeps it off: "Count me in" would change nothing there
    if (!st || (!again && (askedHere.has(st) || st.get('usage.asked'))) || cfg().get('shareUsage') || set.workspaceValue === false || set.workspaceFolderValue === false || vscode.env.isTelemetryEnabled === false) return Promise.resolve();
    askedHere.add(st); st.update('usage.asked', true);
    const yes = tt('Count me in'), no = tt('No thanks'), read = tt('Privacy policy');
    return Promise.resolve(vscode.window.showInformationMessage(tt('Help count how many people use Agent Standup? When you open the call, at most once a week (and once a day when the editor starts), the extension would load an empty 1-pixel file from GitHub: no identifier, nothing about you or your sessions. GitHub sees your IP address, as with any download. You can turn it off any time in the settings.'), yes, no, ...(again ? [] : [read]))).then((a) => {
      if (a === yes) return Promise.resolve(cfg().update('shareUsage', true, vscode.ConfigurationTarget.Global)).then(() => pingWeek(st));
      if (a === read) { vscode.env.openExternal(vscode.Uri.parse(PRIVACY_PAGE)); return askUsage(st, true); }
    }).catch((err) => { if (!/^Canceled$/.test(String(err && err.message))) logErr('usage ask', err); });   // the editor closed while the question was shown: not an error
  } catch (err) { logErr('usage ask', err); return Promise.resolve(); }
}
// Each time the call is opened, in a panel or in the side bar: the question about usage (the first time), the week counted (when shared), the days towards the rating
const opened = () => { askUsage(); pingWeek(); noteUse(); };
// A rating, asked once: on the third day of use, a notification asks for a rating on the page of the store this editor installs from
// (the VS Code Marketplace; Open VSX for Cursor, VSCodium and the others). "Later", or closing it, asks again a week later, one time; "Rate it" and "No thanks" end it.
// A day of use: the call was opened, or the status bar saw a session at work (many never open the call twice). ⚙ › Rate in the page opens the same store page, and ends the asking.
// Nothing is sent: VS Code keeps the number of days, the last of them and the answer, for this extension (see PRIVACY.md).
const RATE_PAGES = { vscode: 'https://marketplace.visualstudio.com/items?itemName=DoubleGeste.agent-standup&ssr=false#review-details', other: 'https://open-vsx.org/extension/DoubleGeste/agent-standup/reviews' };
let extCtx = null;
const ratedHere = new WeakSet();   // as askedHere: asked once by this window, whatever the store has written yet
const ratePage = () => (/^vscode(-insiders)?$/.test(vscode.env.uriScheme || '') ? RATE_PAGES.vscode : RATE_PAGES.other);
function rateNow(st = extCtx && extCtx.globalState) { try { if (st) st.update('rate.done', true); vscode.env.openExternal(ratePage()); } catch (err) { logErr('rating', err); } }
function noteUse(st = extCtx && extCtx.globalState, day = new Date().toISOString().slice(0, 10)) {
  try {
    if (!st || ratedHere.has(st) || st.get('rate.done')) return;
    const fresh = st.get('rate.last') !== day, days = (st.get('rate.days') || 0) + (fresh ? 1 : 0), later = st.get('rate.later') || '';
    if (fresh) { st.update('rate.last', day); st.update('rate.days', days); }
    if (days < 3 || (later && day < later)) return;
    ratedHere.add(st); st.update('rate.done', true);   // marked before it shows: another window opening the call at the same time does not ask too
    const rate = tt('Rate it'), not = tt('Later'), no = tt('No thanks'), page = ratePage();
    Promise.resolve(vscode.window.showInformationMessage(tt('Enjoying Agent Standup? A rating helps other people find it.'), rate, not, no)).then((a) => {
      if (a === rate) vscode.env.openExternal(page);   // handed over as text, as in relay: given as a Uri, VS Code re-encodes the query and the link loses its "&"
      else if (a !== no && !later) { st.update('rate.later', new Date(Date.parse(day) + 7 * 864e5).toISOString().slice(0, 10)); st.update('rate.done', false); ratedHere.delete(st); }
    }, () => {});
  } catch (err) { logErr('rating', err); }
}
let codex0, vibe0, reply0;   // what the environment asked for, put back when the setting is on
const serverEnv = () => ({ AGENT_STANDUP_CLAUDE: cfg().get('claudePath') || '', AGENT_STANDUP_CHARACTERS: cfg().get('charactersPath') || '', AGENT_STANDUP_CODEX: cfg().get('codex') === false ? 'off' : codex0, AGENT_STANDUP_VIBE: cfg().get('vibe') === false ? 'off' : vibe0, AGENT_STANDUP_REPLY: cfg().get('reply') ? 'on' : reply0 });   // undefined: not set
function activate(ctx) {
  extCtx = ctx; pingActive(ctx);
  try { process.env.AGENT_STANDUP_HOST = `${vscode.env.appName || 'editor'} ${vscode.version || ''}`.trim(); } catch {}   // named in a problem report: VS Code, Cursor, VSCodium…
  try { process.env.AGENT_STANDUP_RATE = ratePage(); } catch {}   // ⚙ › Rate, in the page opened in a browser: the store this editor installs from
  codex0 = process.env.AGENT_STANDUP_CODEX; vibe0 = process.env.AGENT_STANDUP_VIBE; reply0 = process.env.AGENT_STANDUP_REPLY;
  const applyPath = () => { const e = serverEnv(); for (const [k, v] of Object.entries(e)) { if (v == null) delete process.env[k]; else process.env[k] = v; } if (started) started.then((s) => { if (s.kid && s.kid.connected) s.kid.send({ env: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v === undefined ? null : v])) }); }).catch(() => {}); };   /* null: unset there too (JSON leaves out undefined) */   // here (the characters folder, a server in the extension host) and in the server's process
  applyPath(); ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((ev) => { if (ev.affectsConfiguration('agentStandup.claudePath') || ev.affectsConfiguration('agentStandup.charactersPath') || ev.affectsConfiguration('agentStandup.codex') || ev.affectsConfiguration('agentStandup.vibe') || ev.affectsConfiguration('agentStandup.reply')) applyPath(); }));
  ctx.subscriptions.push(
    vscode.commands.registerCommand('agentStandup.open', openPanel),
    vscode.commands.registerCommand('agentStandup.openInBrowser', openBrowser),
    vscode.commands.registerCommand('agentStandup.openCharacters', openCharacters),
    vscode.commands.registerCommand('agentStandup.focus', () => vscode.commands.executeCommand('workbench.view.extension.agentStandup')),
    vscode.window.registerWebviewViewProvider('agentStandup.view', sidebar, { webviewOptions: { retainContextWhenHidden: true } }),
  );
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  status.text = '$(device-camera-video) Agent Standup'; status.tooltip = tt('Open the live Agent Standup call'); status.command = 'agentStandup.open';
  status.show(); ctx.subscriptions.push(status);
  // Glanceable state without opening anything: counts for this workspace, red when an agent may need you. Reads the session files directly (no server needed).
  let target = null;
  let polling = false;
  const poll = async () => {
    if (polling) return; polling = true;
    try {
      const bar = cfg().get('statusBar'), tell = cfg().get('notifyNeedsYou') !== false;
      if (!bar) { if (status.text !== '$(device-camera-video) Agent Standup') { status.text = '$(device-camera-video) Agent Standup'; status.backgroundColor = undefined; status.tooltip = tt('Open the live Agent Standup call'); } if (!tell) return needsYou([]); }   // counts off: the plain button stays (and the notifications, unless they are off too)
      if (!vscode.window.state.focused) return;
      const key = projKey(), rows = require('./server.js').boardRows().filter((r) => (key ? r.proj === key || r.dir === key : !r.tmp)), now = Date.now();   // read here, as before (the ends of the transcripts only): no server process for a window whose call is never opened
      needsYou(rows, now); if (!bar) return;
      const act = rows.filter((r) => r.state !== 'idle' || now - r.mtime < 15 * 60e3), cnt = (st) => act.filter((r) => r.state === st).length;
      const blocked = cnt('blocked'), working = cnt('working') + cnt('waiting'), turn = cnt('turn'); if (act.length) noteUse();   // a day of use towards the rating, call opened or not
      const parts = []; if (blocked) parts.push('$(warning) ' + tt('{0} needs you', blocked)); if (working) parts.push('$(sync~spin) ' + tt('{0} working', working)); if (!blocked && !working && turn) parts.push('$(check) ' + tt('your turn'));
      status.text = '$(device-camera-video) ' + (parts.join(' · ') || 'Agent Standup');
      status.backgroundColor = blocked ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
      const best = act.find((r) => r.state === 'blocked') || act.find((r) => r.state === 'working') || act.find((r) => r.state === 'waiting') || act[0] || null; target = best ? { id: best.id, proj: best.proj } : null;
      status.tooltip = act.length ? act.slice(0, 6).map((r) => `${{ blocked: '✋', working: '⚙', waiting: '🔗', turn: '✓', idle: '💤' }[r.state]} ${r.title}`).join('\n') + '\n\n' + tt('Click to open the call') : tt('Open the live Agent Standup call');
    } catch (e) { logErr('status bar', e); } finally { polling = false; }
  };
  ctx.subscriptions.push(vscode.commands.registerCommand('agentStandup.openStatus', () => openPanel(target)));
  status.command = 'agentStandup.openStatus';
  try { ctx.subscriptions.push(vscode.window.onDidChangeWindowState((s) => { if (s.focused) poll(); })); } catch {}   // refresh the moment the window regains focus
  try { ctx.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(followTab), vscode.window.tabGroups.onDidChangeTabGroups(followTab)); } catch {}
  const pollT = setInterval(poll, 4000); poll(); ctx.subscriptions.push({ dispose: () => clearInterval(pollT) });
  // If another VS Code window was serving the port and closes, take over so this window keeps working.
  const watch = setInterval(async () => { try { if (!started) { if (panel || side) ensureServer(); return; } const s = await started; if (!s.error && !(s.kid ? s.kid.exitCode === null : s.server ? s.server.listening : await ping(s.port))) { started = null; ensureServer(); } } catch { started = null; } }, 5000);
  ctx.subscriptions.push({ dispose: () => clearInterval(watch) });   // its own server is asked whether it still runs, not pinged: a ping missed while a large session is read would start a second server and leave the first one running
  if (cfg().get('autoOpen')) openPanel();
}
async function deactivate() { stopping = true; try { if (started) { const s = await started; if (s.kid) s.kid.kill(); if (s.server) { s.server.close(); require('./server.js').shutdown(); } } } catch {} }
module.exports = { activate, deactivate, _server: () => started, _pingActive: pingActive, _noteUse: noteUse, _rateNow: rateNow, _ratePages: RATE_PAGES, _askUsage: askUsage, _pingWeek: pingWeek, _mondayOf: mondayOf, _net: net, _needsYou: needsYou };
