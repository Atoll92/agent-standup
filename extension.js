// Agent Standup — VS Code extension host. Runs the local server in-process and shows it in a webview.
const vscode = require('vscode');
const http = require('http'), fs = require('fs');

let panel = null, status = null, started = null;

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
  if (panel) { try { panel.reveal(); if (pin && pin.id) panel.webview.postMessage({ agentStandup: 'pin', id: pin.id, proj: pin.proj }); return; } catch { panel = null; } }   // a disposed panel falls through and is recreated
  let u;
  try { u = await url(); } catch (e) { return vscode.window.showErrorMessage(e.message); }
  if (pin && pin.id) u = u.replace(/([?&])proj=[^&]*&?/, '$1').replace(/[?&]$/, '') + `&pin=${encodeURIComponent(pin.id)}&proj=${encodeURIComponent(pin.proj || '')}`;   // one proj parameter only: the pinned session's project
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
// Messages from the page: open it in the browser, or open a donation link (https only, known donation sites only).
const DONATE_HOSTS = /^(www\.)?(buymeacoffee\.com|ko-fi\.com|paypal\.me|paypal\.com|github\.com)$/;
const relay = (webview) => webview.onDidReceiveMessage((m) => {
  if (!m) return;
  if (m.agentStandup === 'openBrowser') openBrowser();
  if (m.agentStandup === 'openCharacters') openCharacters();
  if (m.agentStandup === 'notify' && typeof m.text === 'string') vscode.window.showInformationMessage('Agent Standup: ' + m.text.slice(0, 120));
  if (m.agentStandup === 'openExternal') { try { const u = new URL(m.url); if (u.protocol === 'https:' && DONATE_HOSTS.test(u.hostname)) vscode.env.openExternal(vscode.Uri.parse(u.toString())); } catch {} }
});

// Sidebar view: the same live call, in the activity bar.
const sidebar = {
  async resolveWebviewView(view) {
    view.webview.options = { enableScripts: true }; relay(view.webview);
    try {
      const ext = await vscode.env.asExternalUri(vscode.Uri.parse((await url()) + '&embed=1'));
      view.webview.html = frameHtml(ext.toString(true));
    } catch (e) { view.webview.html = `<body style="font:13px sans-serif;color:#ccc;padding:12px">${e.message}</body>`; }
  },
};

// The folder where the person drops their own pixel art (lead.png, you.png, others for the sub-agents, name-talk.png for an open mouth).
async function openCharacters() {
  try {
    const dir = require('./server.js').charactersDir(); const fresh = !fs.existsSync(dir); fs.mkdirSync(dir, { recursive: true });
    if (fresh) fs.writeFileSync(require('path').join(dir, 'README.txt'), 'Put your pixel art here (PNG, GIF, WebP, up to 300 KB each).\nlead.png = the lead (Claude) · you.png = you · any other image = a sub-agent\nname-talk.png = optional open-mouth frame of name.png\nThen press Reload in the Agent Standup settings menu.\n');
    vscode.env.openExternal(vscode.Uri.file(dir));
  } catch (e) { vscode.window.showErrorMessage(e.message); }
}
async function openBrowser() {
  try { vscode.env.openExternal(vscode.Uri.parse(await url())); } catch (e) { vscode.window.showErrorMessage(e.message); }
}

// Opt-in only (agentStandup.shareUsage, off by default, and never when VS Code telemetry is off): at most one request per day to a 1-pixel file on GitHub, so the project can count how many installs are used. Nothing is sent in the request: no id, no path, no content.
function pingActive(ctx) {
  try {
    if (!cfg().get('shareUsage') || vscode.env.isTelemetryEnabled === false) return;
    const day = new Date().toISOString().slice(0, 10); if (ctx.globalState.get('lastActivePing') === day) return;
    ctx.globalState.update('lastActivePing', day);
    const r = require('https').get({ host: 'github.com', path: '/Atoll92/agent-standup/releases/download/stats/app-active.gif', headers: { 'user-agent': 'agent-standup' }, timeout: 5000 }, (m) => { m.resume(); m.destroy(); });
    r.on('error', () => {}); r.on('timeout', () => r.destroy());
  } catch {}
}
function activate(ctx) {
  pingActive(ctx);
  const applyPath = () => { process.env.AGENT_STANDUP_CLAUDE = cfg().get('claudePath') || ''; process.env.AGENT_STANDUP_CHARACTERS = cfg().get('charactersPath') || ''; };
  applyPath(); ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((ev) => { if (ev.affectsConfiguration('agentStandup.claudePath') || ev.affectsConfiguration('agentStandup.charactersPath')) applyPath(); }));
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
      const key = projKey(), rows = require('./server.js').boardRows().filter((r) => !key || r.proj === key || r.dir === key), now = Date.now();
      const act = rows.filter((r) => r.state !== 'idle' || now - r.mtime < 15 * 60e3), cnt = (st) => act.filter((r) => r.state === st).length;
      const blocked = cnt('blocked'), working = cnt('working') + cnt('waiting'), turn = cnt('turn');
      const parts = []; if (blocked) parts.push('$(warning) ' + tt('{0} needs you', blocked)); if (working) parts.push('$(sync~spin) ' + tt('{0} working', working)); if (!blocked && !working && turn) parts.push('$(check) ' + tt('your turn'));
      status.text = '$(device-camera-video) ' + (parts.join(' · ') || 'Agent Standup');
      status.backgroundColor = blocked ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
      const best = act.find((r) => r.state === 'blocked') || act.find((r) => r.state === 'working') || act.find((r) => r.state === 'waiting') || act[0] || null; target = best ? { id: best.id, proj: best.proj } : null;
      status.tooltip = act.length ? act.slice(0, 6).map((r) => `${{ blocked: '✋', working: '⚙', waiting: '🔗', turn: '✓', idle: '💤' }[r.state]} ${r.title}`).join('\n') + '\n\n' + tt('Click to open the call') : tt('Open the live Agent Standup call');
    } catch {}
  };
  ctx.subscriptions.push(vscode.commands.registerCommand('agentStandup.openStatus', () => openPanel(target)));
  status.command = 'agentStandup.openStatus';
  try { ctx.subscriptions.push(vscode.window.onDidChangeWindowState((s) => { if (s.focused) poll(); })); } catch {}   // refresh the moment the window regains focus
  const pollT = setInterval(poll, 4000); poll(); ctx.subscriptions.push({ dispose: () => clearInterval(pollT) });
  // If another VS Code window was serving the port and closes, take over so this window keeps working.
  const watch = setInterval(async () => { try { if (!started) return; const s = await started; if (!s.error && !(await ping(s.port))) { started = null; ensureServer(); } } catch { started = null; } }, 5000);
  ctx.subscriptions.push({ dispose: () => clearInterval(watch) });
  if (cfg().get('autoOpen')) openPanel();
}
async function deactivate() { try { if (started) { const s = await started; s.server && s.server.close(); } require('./server.js').shutdown(); } catch {} }
module.exports = { activate, deactivate, _pingActive: pingActive };
