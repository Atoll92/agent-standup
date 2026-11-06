// Builds the unsigned desktop app for the current platform into dist-desktop/ (needs ~150 MB for Electron the first time).
//   node scripts/build-desktop.js [--arch arm64|x64]      then zip dist-desktop/<app folder>
// macOS: the app is ad-hoc signed so it runs locally; downloaded copies need System Settings → Privacy & Security → Open Anyway once (no Apple Developer ID here).
const fs = require('fs'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
const root = path.join(__dirname, '..'), d = path.join(root, 'desktop'), core = path.join(d, 'core'), out = path.join(root, 'dist-desktop');
const arch = process.argv.includes('--arch') ? process.argv[process.argv.indexOf('--arch') + 1] : process.arch;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); const dp = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')); dp.version = pkg.version; fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(dp, null, 2) + '\n');
fs.rmSync(core, { recursive: true, force: true }); fs.mkdirSync(path.join(core, 'media'), { recursive: true });
for (const f of ['server.js', 'codex.js', 'vibe.js', 'reply.js', 'kokoro.js', 'kokoro-worker.js', 'demo.js', 'LICENSE']) fs.copyFileSync(path.join(root, f), path.join(core, f));
fs.cpSync(path.join(root, 'public'), path.join(core, 'public'), { recursive: true }); for (const e of ['cats', 'vampire']) fs.cpSync(path.join(root, 'examples', e), path.join(core, 'examples', e), { recursive: true }); for (const f of ['icon.png', 'tray.png', 'tray@2x.png']) fs.copyFileSync(path.join(root, 'media', f), path.join(core, 'media', f));
if (!fs.existsSync(path.join(d, 'node_modules/electron'))) execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: d, stdio: 'inherit', shell: process.platform === 'win32' });
const appName = process.platform === 'win32' ? '"Agent Standup"' : 'Agent Standup';   // quoted on Windows, where the command goes through a shell and would split the name
const args = ['--yes', '@electron/packager@20.3.0', d, appName, `--platform=${process.platform}`, `--arch=${arch}`, `--out=${out}`, '--overwrite', '--prune=true', '--asar', '--app-bundle-id=com.doublegeste.agentstandup', '--ignore=^/node_modules/\\.cache'];
if (process.platform !== 'darwin') args.push('--executable-name=agent-standup');   // no space in the executable name on Windows and Linux
if (fs.existsSync(path.join(d, process.platform === 'darwin' ? 'icon.icns' : 'icon.ico'))) args.push(`--icon=${path.join(d, 'icon')}`);
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
if (process.platform === 'darwin') { const app = path.join(out, `Agent Standup-darwin-${arch}`, 'Agent Standup.app'); spawnSync('codesign', ['--force', '--deep', '-s', '-', app], { stdio: 'inherit' }); console.log('built', app); }
else console.log('built in', out);
