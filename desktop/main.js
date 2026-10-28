// Agent Standup desktop app: the same local server as the extension, in its own window, with an indicator in the menu bar (macOS) or tray (Windows, Linux)
// that shows what your agents are doing and notifies you when one is waiting for your answer. Nothing leaves your machine.
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification, session } = require('electron');
const path = require('path'), fs = require('fs');
process.env.AGENT_STANDUP_HOST = 'desktop app';   // named in a problem report (⚙ › Report a problem)
const core = require('./core/server.js');
const SELFTEST = process.argv.includes('--selftest') ? process.argv[process.argv.indexOf('--selftest') + 1] : null;   // renders the window to a PNG and quits: used to check a build
let win = null, tray = null, port = 0, quitting = false, lastNeeds = 0, trayTimer = null, notifyFailed = false;
// Links the page may open in the browser: the same sites as the VS Code extension (extension.js), https only. Anything else is refused.
const DONATE_HOSTS = /^(www\.)?(buymeacoffee\.com|ko-fi\.com|paypal\.me|paypal\.com|github\.com)$/, SHOP_HOSTS = /^(checkout\.stripe\.com|agent-standup\.com|(www\.)?instagram\.com)$/, ARTIFACT_PATH = /^\/(code\/)?artifact\/[\w-]+$/;
function openOutside(url) { try { const u = new URL(url); if (u.protocol === 'https:' && (DONATE_HOSTS.test(u.hostname) || SHOP_HOSTS.test(u.hostname) || (u.hostname === 'claude.ai' && ARTIFACT_PATH.test(u.pathname)))) shell.openExternal(u.href); } catch {} }
// What the page may ask the browser for: its own notification while the window is hidden, and its Copy buttons. Camera, microphone, screen, location and the rest are refused, and only the app's own page gets anything.
const PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write']);
const ownPage = (u) => { try { return !!port && new URL(u).origin === `http://localhost:${port}`; } catch { return false; } };

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();   // a second copy only brings the first one to the front
else app.on('second-instance', () => showWindow());

function showWindow() { if (!win) createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 420, minHeight: 360, backgroundColor: '#12131a', title: 'Agent Standup', show: !SELFTEST,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'document-user-activation-required' } });
  win.loadURL(`http://localhost:${port}/`);
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });   // no window ever opens inside the app
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://localhost:${port}/`)) { e.preventDefault(); openOutside(url); } });
  win.on('close', (e) => { if (!quitting && !SELFTEST && process.platform !== 'linux') { e.preventDefault(); win.hide(); } });   // closing the window keeps the indicator running (not on Linux: many desktops have no tray to come back from)
  win.on('closed', () => { win = null; });
}

function counts() {
  const now = Date.now(), act = core.boardRows().filter((r) => r.state !== 'idle' || now - r.mtime < 15 * 60e3), n = (s) => act.filter((r) => r.state === s).length;
  const turn = act.filter((r) => r.state === 'turn'), lim = turn.find((r) => r.limit);   // a session stopped on your usage limit, or on a login that is gone: not a turn you can take (as the CLI's status)
  return { needs: n('blocked'), working: n('working') + n('waiting'), free: turn.some((r) => !r.limit && !r.auth), limit: lim ? String(lim.limit.resets || '').replace(/\s*\([^)]*\)\s*$/, '') : null, auth: turn.some((r) => r.auth), latest: act.filter((r) => r.state === 'blocked').sort((x, y) => (y.since || y.mtime || 0) - (x.since || x.mtime || 0))[0] };   // latest: the session that started to wait last, named in the notification
}
function refreshTray() {
  if (!tray) return; let c; try { c = counts(); } catch { return; }
  const rest = !c.needs && !c.working, text = [c.needs ? `✋${c.needs}` : '', c.working ? `⚙${c.working}` : '', rest && c.free ? '✓' : '', rest && !c.free && c.limit != null ? '⏳' : '', rest && !c.free && c.auth ? '⚠' : ''].filter(Boolean).join(' ');   // the reset time without its zone (Europe/Paris)
  if (process.platform === 'darwin') tray.setTitle(text ? ' ' + text : '');
  tray.setToolTip('Agent Standup' + (text ? ' — ' + [c.needs && `${c.needs} need you`, c.working && `${c.working} working`, rest && c.free && 'your turn', rest && !c.free && c.limit != null && 'usage limit' + (c.limit ? ' · resets ' + c.limit : ''), rest && !c.free && c.auth && 'logged out: run /login'].filter(Boolean).join(', ') : ''));
  if (c.needs > lastNeeds && !(win && win.isFocused()) && Notification.isSupported()) {
    const r = c.latest, clip = (s, k) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > k ? s.slice(0, k - 1).trimEnd() + '…' : s; };
    const n = new Notification({ title: 'Agent Standup', body: r ? `✋ ${clip(r.title || r.id, 60)} is waiting for your answer` + (r.ask ? ': ' + clip(r.ask, 80) : '') : 'An agent is waiting for your answer ✋' });   // its question, or the call it waits to run: Bash(npm test)
    n.on('click', () => { let a = null; try { a = r && core.answerIn(r.id); } catch {} if (!a || (a.how !== 'editor' && a.how !== 'app')) showWindow(); });   // where it can be answered, brought to the front alone: its Claude Code tab in the editor, its terminal or the Claude app (server.js, answerIn); else this window
    n.on('failed', (e, err) => { if (!notifyFailed) console.warn('notification not shown:', err); notifyFailed = true; });   // macOS refuses it when notifications are off for the app, or the app is not signed
    n.show();
  }
  lastNeeds = c.needs;
}
function createTray() {
  const small = nativeImage.createFromPath(path.join(__dirname, 'core/media/tray.png'));   // 18 px drawing (and tray@2x.png beside it); the store icon shrunk as a fallback
  tray = new Tray(small.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, 'core/media/icon.png')).resize({ width: 18, height: 18 }) : small);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Agent Standup', click: showWindow }, { label: 'Open in browser', click: () => shell.openExternal(`http://localhost:${port}/`) },
    { label: 'Open characters folder', click: () => { const d = core.charactersDir(); try { fs.mkdirSync(d, { recursive: true }); } catch {} shell.openPath(d); } },
    { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow); refreshTray(); trayTimer = setInterval(refreshTray, 4000);
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  const srv = core.start(0); await new Promise((r) => srv.once('listening', r)); port = srv.address().port;
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(PERMISSIONS.has(perm) && ownPage(details && details.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => PERMISSIONS.has(perm) && ownPage(origin));
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'core/media/icon.png')));
  createWindow(); createTray();
  if (SELFTEST) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const img = await win.webContents.capturePage(); fs.writeFileSync(SELFTEST, img.toPNG());
      console.log(JSON.stringify({ ok: true, port, title: win.getTitle(), size: img.getSize(), trayTitle: tray ? 'created' : 'none' })); quitting = true; app.quit();
    }, 3000));
  }
});
app.on('activate', showWindow);
app.on('before-quit', () => { quitting = true; clearInterval(trayTimer); try { core.shutdown(); } catch {} });
app.on('window-all-closed', () => { /* stay in the tray */ });
