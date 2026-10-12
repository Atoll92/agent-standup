// Natural voices with Kokoro-82M (kokoro-js on ONNX Runtime), installed on demand outside the extension.
// Nothing here runs until the person clicks Install in ⚙ → Sound: the packages (about 430 MB) go to one user folder, the model (about 155 MB) is fetched on first use.
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');

const WIN = process.platform === 'win32';
const DIR = process.env.AGENT_STANDUP_KOKORO_DIR || (WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agent-standup', 'kokoro') : path.join(os.homedir(), '.cache', 'agent-standup', 'kokoro'));
const PKG = 'kokoro-js@1.2.1', DTYPE = 'q4', SIZE_MB = 730, MAX_RESTARTS = 3;
const WORKER = process.env.AGENT_STANDUP_KOKORO_WORKER || path.join(__dirname, 'kokoro-worker.js'), LOG = path.join(DIR, 'install.log');

// In the order agents get them (the lead takes the first), so successive agents sound distinct. English only: kokoro-js has no French voice (it refuses ff_siwis), so French lines are read by the system voices.
const VOICES = [['af_heart', 'Heart', 'en_US'], ['am_fenrir', 'Fenrir', 'en_US'], ['bf_emma', 'Emma', 'en_GB'], ['am_michael', 'Michael', 'en_US'], ['af_bella', 'Bella', 'en_US'], ['bm_george', 'George', 'en_GB'], ['af_sarah', 'Sarah', 'en_US'], ['am_puck', 'Puck', 'en_US']].map(([name, label, locale]) => ({ name, label, locale }));
const voices = () => VOICES, hasVoice = (n) => VOICES.some((v) => v.name === n);
const speedFor = (wpm) => Math.max(0.5, Math.min(2, Math.round((wpm / 178) * 20) / 20));   // 178 words a minute is about Kokoro's natural pace
const exists = (f) => { try { fs.statSync(f); return true; } catch { return false; } };
const installed = () => exists(path.join(DIR, 'node_modules', 'kokoro-js', 'package.json'));

function findNpm() {
  const home = os.homedir(), names = WIN ? ['npm.cmd', 'npm.bat', 'npm'] : ['npm'], cands = [];
  for (const d of (process.env.PATH || '').split(path.delimiter)) for (const n of names) cands.push(path.join(d, n));
  const dirs = WIN ? [path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')] : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), path.join(home, '.volta/bin')];
  try { const nvm = path.join(home, '.nvm', 'versions', 'node'); for (const v of fs.readdirSync(nvm)) dirs.push(path.join(nvm, v, 'bin')); } catch {}
  for (const d of dirs) for (const n of names) cands.push(path.join(d, n));
  return cands.find((c) => c && exists(c)) || null;
}

// ---- install: `npm install --prefix DIR kokoro-js@x`, output in DIR/install.log, one job at a time
let job = null, lastError = '';
function install() {
  if (job || installed()) return status();
  const npm = findNpm(); if (!npm) { lastError = 'npm not found'; return status(); }
  fs.mkdirSync(DIR, { recursive: true }); lastError = '';
  const out = fs.openSync(LOG, 'w'), args = ['install', '--prefix', DIR, '--no-audit', '--no-fund', PKG];
  job = WIN && /\.(cmd|bat)$/i.test(npm) ? spawn('"' + npm + '"', args.map((a) => (a === DIR ? '"' + a + '"' : a)), { shell: true, stdio: ['ignore', out, out], windowsHide: true }) : spawn(npm, args, { stdio: ['ignore', out, out], windowsHide: true });
  const done = (why) => { job = null; try { fs.closeSync(out); } catch {} if (why) lastError = why; else warm(); };
  job.on('error', (e) => done('npm: ' + e.message));
  job.on('close', (code) => done(code === 0 && installed() ? '' : 'npm install failed (exit ' + code + ')'));
  return status();
}

// ---- worker: one child process that holds the model, started on first use, restarted after a crash up to MAX_RESTARTS times; one line at a time
let worker = null, restarts = 0, seq = 0; const queue = []; let busy = false;
function startWorker() {
  if (worker) return worker;
  if (restarts >= MAX_RESTARTS) throw new Error('kokoro worker gave up');
  const p = spawn(process.execPath, [WORKER], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AGENT_STANDUP_KOKORO_DIR: DIR, AGENT_STANDUP_KOKORO_DTYPE: DTYPE }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const w = (worker = { p, ready: false, pending: new Map(), err: '' }); let buf = '';
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; }   // library chatter is ignored
      if (m.ready) { w.ready = true; lastError = ''; continue; }
      const r = w.pending.get(m.id); if (!r) continue; w.pending.delete(m.id); m.ok ? r.resolve(m) : r.reject(new Error(m.error || 'tts failed'));
    }
  });
  p.stderr.on('data', (d) => { w.err = (w.err + d).slice(-600); }); p.stdin.on('error', () => {});
  const gone = (why) => { if (worker !== w) return; worker = null; restarts++; lastError = why; const jobs = [...w.pending.values()]; w.pending.clear(); busy = false; for (const r of jobs) r.reject(new Error(why)); };
  p.on('error', (e) => gone('kokoro worker: ' + e.message)); p.on('close', (code) => gone('kokoro worker exited (' + code + ') ' + (w.err.trim().split('\n').pop() || '')));
  return w;
}
function warm() { if (installed() && !worker && restarts < MAX_RESTARTS) try { startWorker(); } catch {} }
function pump() {
  if (busy || !queue.length) return;
  const j = queue.shift(); let w; try { w = startWorker(); } catch (e) { j.reject(e); return pump(); }
  const id = ++seq, next = (fn) => (v) => { busy = false; fn(v); pump(); }; busy = true;
  w.pending.set(id, { resolve: next(j.resolve), reject: next(j.reject) });
  w.p.stdin.write(JSON.stringify({ id, text: j.text, voice: j.voice, speed: j.speed, out: j.out }) + '\n');
}
function synth(text, voice, speed, out) {
  if (!installed()) return Promise.reject(new Error('kokoro not installed'));
  if (!hasVoice(voice)) return Promise.reject(new Error('unknown voice'));
  return new Promise((resolve, reject) => { queue.push({ text: String(text).slice(0, 2500), voice, speed, out, resolve, reject }); pump(); });
}
function status() {
  let log = ''; try { log = fs.readFileSync(LOG, 'utf8').slice(-400); } catch {}
  return { dir: DIR, sizeMb: SIZE_MB, installed: installed(), installing: !!job, ready: !!(worker && worker.ready), gaveUp: restarts >= MAX_RESTARTS, error: lastError || null, npm: !!findNpm(), log };
}
function shutdown() {
  for (const j of queue.splice(0)) j.reject(new Error('kokoro shut down'));
  if (worker) { const w = worker; worker = null; try { w.p.kill(); } catch {} for (const r of w.pending.values()) r.reject(new Error('kokoro shut down')); w.pending.clear(); }
  busy = false; if (job) { try { job.kill(); } catch {} job = null; }
}
module.exports = { DIR, voices, hasVoice, speedFor, status, install, warm, synth, shutdown };
