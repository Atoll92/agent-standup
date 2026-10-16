// Agent Standup — VS Code extension host. Runs the local server in-process and shows it in a webview.
const vscode = require('vscode');
const http = require('http'), fs = require('fs');

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

// Each window runs its own server on a free port (a fixed port can be set; if that port already serves Agent Standup it is reused).
// Reusing someone else's server by default caused trouble: it may run without the right environment (e.g. no way to call `claude`).
function ensureServer() {
  if (started) return started;
  const wanted = cfg().get('port') || 0;
  started = new Promise((resolve) => {
    const srv = require('./server.js').start(wanted);
    srv.once('listening', () => resolve({ port: srv.address().port, server: srv }));
    srv.once('error', async () => resolve((await ping(wanted)) ? { port: wanted } : { port: wanted, error: true }));
  });
  return started;
}
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
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
  if (m.agentStandup === 'notify' && typeof m.text === 'string') vscode.window.showInformationMessage('Agent Standup: ' + m.text.slice(0, 120));
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
function followTab() {
  try {
    if (!panel && !side) return; const g = vscode.window.tabGroups.activeTabGroup, t = g && g.activeTab, vt = t && t.input && t.input.viewType;
    if (typeof vt !== 'string' || !vt.includes('claudeVSCodePanel')) return;   // any other tab (a file, the call itself): the call stays where it is
    const key = g.viewColumn + '|' + t.label; if (key === tabKey) return; tabKey = key;   // only when you change tab: the call may have been moved by hand since
    const one = (x) => String(x).replace(/\s+/g, ' ').trim(), cut = /…$/.test(t.label), label = one(t.label.replace(/…$/, '')); if (!label || t.label === 'Claude Code') return;
    const f = vscode.workspace.workspaceFolders, ws = f && f.length ? f[0].uri.fsPath.replace(/[^a-zA-Z0-9]/g, '-') : '';
    const srv = require('./server.js'), named = (list) => list.filter((r) => typeof r.title === 'string' && (cut ? one(r.title).startsWith(label) : one(r.title) === label));
    let rows = named(srv.boardRows()); if (!rows.length) rows = named(srv.sessionRows());   // a conversation of another day is no longer among the sessions of the moment: it is looked up in the whole list
    const r = rows.find((x) => ws && (x.proj === ws || x.proj.startsWith(ws + '-'))) || rows[0]; if (!r) return;
    for (const w of [panel, side]) if (w) w.webview.postMessage({ agentStandup: 'pin', id: r.id, proj: r.proj, tab: true });
  } catch (e) { logErr('follow tab', e); }
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
function pingActive(ctx) {
  try {
    if (!sharing()) return;
    const day = new Date().toISOString().slice(0, 10); if (ctx.globalState.get('lastActivePing') === day) return;
    ctx.globalState.update('lastActivePing', day); net.pixel('app-active.gif');
  } catch {}
}
const mondayOf = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
function pingWeek(st = extCtx && extCtx.globalState, now = new Date()) {
  try {
    if (!st || !sharing()) return;
    const week = mondayOf(now); if (st.get('lastWeekPing') === week) return;
    st.update('lastWeekPing', week); net.pixel('app-week.gif');
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
    }).catch((err) => logErr('usage ask', err));
  } catch (err) { logErr('usage ask', err); return Promise.resolve(); }
}
// Each time the call is opened, in a panel or in the side bar: the question about usage (the first time), the week counted (when shared), the days towards the rating
const opened = () => { askUsage(); pingWeek(); noteUse(); };
// A rating, asked once: when the call is opened on a third day, a notification asks for a rating on the page of the store this editor installs from
// (the VS Code Marketplace; Open VSX for Cursor, VSCodium and the others). "Later", or closing it, asks again a week later, one time; "Rate it" and "No thanks" end it.
// Nothing is sent: VS Code keeps the number of days, the last of them and the answer, for this extension (see PRIVACY.md).
const RATE_PAGES = { vscode: 'https://marketplace.visualstudio.com/items?itemName=DoubleGeste.agent-standup&ssr=false#review-details', other: 'https://open-vsx.org/extension/DoubleGeste/agent-standup/reviews' };
let extCtx = null;
const ratedHere = new WeakSet();   // as askedHere: asked once by this window, whatever the store has written yet
function noteUse(st = extCtx && extCtx.globalState, day = new Date().toISOString().slice(0, 10)) {
  try {
    if (!st || ratedHere.has(st) || st.get('rate.done')) return;
    const fresh = st.get('rate.last') !== day, days = (st.get('rate.days') || 0) + (fresh ? 1 : 0), later = st.get('rate.later') || '';
    if (fresh) { st.update('rate.last', day); st.update('rate.days', days); }
    if (days < 3 || (later && day < later)) return;
    ratedHere.add(st); st.update('rate.done', true);   // marked before it shows: another window opening the call at the same time does not ask too
    const rate = tt('Rate it'), not = tt('Later'), no = tt('No thanks'), page = /^vscode(-insiders)?$/.test(vscode.env.uriScheme || '') ? RATE_PAGES.vscode : RATE_PAGES.other;
    Promise.resolve(vscode.window.showInformationMessage(tt('Enjoying Agent Standup? A rating helps other people find it.'), rate, not, no)).then((a) => {
      if (a === rate) vscode.env.openExternal(page);   // handed over as text, as in relay: given as a Uri, VS Code re-encodes the query and the link loses its "&"
      else if (a !== no && !later) { st.update('rate.later', new Date(Date.parse(day) + 7 * 864e5).toISOString().slice(0, 10)); st.update('rate.done', false); ratedHere.delete(st); }
    }, () => {});
  } catch (err) { logErr('rating', err); }
}
function activate(ctx) {
  extCtx = ctx; pingActive(ctx);
  try { process.env.AGENT_STANDUP_HOST = `${vscode.env.appName || 'editor'} ${vscode.version || ''}`.trim(); } catch {}   // named in a problem report: VS Code, Cursor, VSCodium…
  const codex0 = process.env.AGENT_STANDUP_CODEX, vibe0 = process.env.AGENT_STANDUP_VIBE, reply0 = process.env.AGENT_STANDUP_REPLY;   // what the environment asked for, put back when the setting is on
  const applyPath = () => { process.env.AGENT_STANDUP_CLAUDE = cfg().get('claudePath') || ''; process.env.AGENT_STANDUP_CHARACTERS = cfg().get('charactersPath') || ''; if (cfg().get('codex') === false) process.env.AGENT_STANDUP_CODEX = 'off'; else if (codex0 === undefined) delete process.env.AGENT_STANDUP_CODEX; else process.env.AGENT_STANDUP_CODEX = codex0; if (cfg().get('vibe') === false) process.env.AGENT_STANDUP_VIBE = 'off'; else if (vibe0 === undefined) delete process.env.AGENT_STANDUP_VIBE; else process.env.AGENT_STANDUP_VIBE = vibe0; if (cfg().get('reply')) process.env.AGENT_STANDUP_REPLY = 'on'; else if (reply0 === undefined) delete process.env.AGENT_STANDUP_REPLY; else process.env.AGENT_STANDUP_REPLY = reply0; };
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
  const poll = () => {
    try {
      if (!cfg().get('statusBar')) { if (status.text !== '$(device-camera-video) Agent Standup') { status.text = '$(device-camera-video) Agent Standup'; status.backgroundColor = undefined; status.tooltip = tt('Open the live Agent Standup call'); } return; }   // counts off: the plain button stays
      if (!vscode.window.state.focused) return;
      const key = projKey(), rows = require('./server.js').boardRows().filter((r) => (key ? r.proj === key || r.dir === key : !r.tmp)), now = Date.now();
      const act = rows.filter((r) => r.state !== 'idle' || now - r.mtime < 15 * 60e3), cnt = (st) => act.filter((r) => r.state === st).length;
      const blocked = cnt('blocked'), working = cnt('working') + cnt('waiting'), turn = cnt('turn');
      const parts = []; if (blocked) parts.push('$(warning) ' + tt('{0} needs you', blocked)); if (working) parts.push('$(sync~spin) ' + tt('{0} working', working)); if (!blocked && !working && turn) parts.push('$(check) ' + tt('your turn'));
      status.text = '$(device-camera-video) ' + (parts.join(' · ') || 'Agent Standup');
      status.backgroundColor = blocked ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
      const best = act.find((r) => r.state === 'blocked') || act.find((r) => r.state === 'working') || act.find((r) => r.state === 'waiting') || act[0] || null; target = best ? { id: best.id, proj: best.proj } : null;
      status.tooltip = act.length ? act.slice(0, 6).map((r) => `${{ blocked: '✋', working: '⚙', waiting: '🔗', turn: '✓', idle: '💤' }[r.state]} ${r.title}`).join('\n') + '\n\n' + tt('Click to open the call') : tt('Open the live Agent Standup call');
    } catch (e) { logErr('status bar', e); }
  };
  ctx.subscriptions.push(vscode.commands.registerCommand('agentStandup.openStatus', () => openPanel(target)));
  status.command = 'agentStandup.openStatus';
  try { ctx.subscriptions.push(vscode.window.onDidChangeWindowState((s) => { if (s.focused) poll(); })); } catch {}   // refresh the moment the window regains focus
  try { ctx.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(followTab), vscode.window.tabGroups.onDidChangeTabGroups(followTab)); } catch {}
  const pollT = setInterval(poll, 4000); poll(); ctx.subscriptions.push({ dispose: () => clearInterval(pollT) });
  // If another VS Code window was serving the port and closes, take over so this window keeps working.
  const watch = setInterval(async () => { try { if (!started) return; const s = await started; if (!s.error && !(await ping(s.port))) { started = null; ensureServer(); } } catch { started = null; } }, 5000);
  ctx.subscriptions.push({ dispose: () => clearInterval(watch) });
  if (cfg().get('autoOpen')) openPanel();
}
async function deactivate() { try { if (started) { const s = await started; s.server && s.server.close(); } require('./server.js').shutdown(); } catch {} }
module.exports = { activate, deactivate, _pingActive: pingActive, _noteUse: noteUse, _ratePages: RATE_PAGES, _askUsage: askUsage, _pingWeek: pingWeek, _mondayOf: mondayOf, _net: net };
