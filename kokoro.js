// Natural voices with Kokoro-82M (kokoro-js on ONNX Runtime), installed on demand outside the extension.
// Nothing here runs until the person clicks Install in ⚙ → Sound: the packages (about 430 MB) go to one user folder, the model (about 155 MB) is fetched on first use.
// French, Spanish and Brazilian Portuguese are the same model: kokoro-js only reads English, so the install adds a full eSpeak NG (WebAssembly, 18 MB, GPL: fetched by npm like the rest, never shipped with the app) for the phonemes. See kokoro-worker.js.
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');

const WIN = process.platform === 'win32';
const DIR = process.env.AGENT_STANDUP_KOKORO_DIR || (WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agent-standup', 'kokoro') : path.join(os.homedir(), '.cache', 'agent-standup', 'kokoro'));
const PKG = 'kokoro-js@1.2.1', G2P = 'espeak-ng@1.0.2', G2P_MB = 18, DTYPE = 'q4', SIZE_MB = 750, MAX_RESTARTS = 3;
const WORKER = process.env.AGENT_STANDUP_KOKORO_WORKER || path.join(__dirname, 'kokoro-worker.js'), LOG = path.join(DIR, 'install.log');

// In the order agents get them (the lead takes the first), so successive agents sound distinct.
const EN = [['af_heart', 'Heart', 'en_US'], ['am_fenrir', 'Fenrir', 'en_US'], ['bf_emma', 'Emma', 'en_GB'], ['am_michael', 'Michael', 'en_US'], ['af_bella', 'Bella', 'en_US'], ['bm_george', 'George', 'en_GB'], ['af_sarah', 'Sarah', 'en_US'], ['am_puck', 'Puck', 'en_US']].map(([name, label, locale]) => ({ name, label, locale }));
// The other languages. A voice here is a mix of the model's voices ([[voice, share], …]) said from the phonemes of `lang` (an eSpeak NG language).
// French: the model has one French voice, ff_siwis (a woman), which the lead takes as it is. The others are that voice mixed with the character's English one, in the same order as above:
// each keeps something of its own voice in both languages. Measured by transcribing the clips back (Whisper), a mix with 40 to 50 % of the French voice is understood as well as the French voice alone,
// and an English voice alone is not (two to four times the errors). The men get 40 % where that stays clear, which sets them apart: their pitch is 150 to 170 Hz against 205 for ff_siwis. Michael slurred words at 40 %.
const FR = [['ff_siwis', 'Siwis', null, 1], ['fr_fenrir', 'Fenrir', 'am_fenrir', 0.4], ['fr_emma', 'Emma', 'bf_emma', 0.5], ['fr_michael', 'Michael', 'am_michael', 0.5], ['fr_bella', 'Bella', 'af_bella', 0.5], ['fr_george', 'George', 'bm_george', 0.4], ['fr_sarah', 'Sarah', 'af_sarah', 0.5], ['fr_puck', 'Puck', 'am_puck', 0.4]]
  .map(([name, label, other, share]) => ({ name, label, locale: 'fr_FR', lang: 'fr-fr', mix: other ? [['ff_siwis', share], [other, 1 - share]] : [['ff_siwis', 1]] }));
// Spanish and Brazilian Portuguese: one woman (f) and two men (m, m2) each in the model. The lead and the first agent take the woman and the first man as they are; the others are one of the three,
// of the same sex, mixed half and half with the character's English voice. By the same measure every one of these was understood as well as the three voices alone.
const cast = (pre, locale, lang, f, m, m2) => [[f, 'Dora', [[f, 1]]], [m, 'Alex', [[m, 1]]], [pre + '_emma', 'Emma', [[f, 0.5], ['bf_emma', 0.5]]], [pre + '_michael', 'Michael', [[m2, 0.5], ['am_michael', 0.5]]], [pre + '_bella', 'Bella', [[f, 0.5], ['af_bella', 0.5]]], [pre + '_george', 'George', [[m2, 0.5], ['bm_george', 0.5]]], [pre + '_sarah', 'Sarah', [[f, 0.5], ['af_sarah', 0.5]]], [pre + '_puck', 'Puck', [[m, 0.5], ['am_puck', 0.5]]]]
  .map(([name, label, mix]) => ({ name, label, locale, lang, mix }));
const ES = cast('es', 'es_ES', 'es', 'ef_dora', 'em_alex', 'em_santa'), PT = cast('pt', 'pt_BR', 'pt-br', 'pf_dora', 'pm_alex', 'pm_santa');
const VOICES = [...EN, ...FR, ...ES, ...PT], find = (n) => VOICES.find((v) => v.name === n);
const voices = () => VOICES.filter((v) => !v.lang || g2p()).map(({ name, label, locale }) => ({ name, label, locale })), hasVoice = (n) => !!find(n);   // the ones that are not English are listed once the phonemizer is there; until then the page keeps the system voices for these languages
const localeOf = (n) => (find(n) || EN[0]).locale;
const speedFor = (wpm) => Math.max(0.5, Math.min(2, Math.round((wpm / 178) * 20) / 20));   // 178 words a minute is about Kokoro's natural pace
const exists = (f) => { try { fs.statSync(f); return true; } catch { return false; } };
const installed = () => exists(path.join(DIR, 'node_modules', 'kokoro-js', 'package.json'));
const g2p = () => installed() && exists(path.join(DIR, 'node_modules', 'espeak-ng', 'package.json'));   // an install made before the other languages were added has kokoro-js alone: the same button adds the phonemizer

function findNpm() {
  const home = os.homedir(), names = WIN ? ['npm.cmd', 'npm.bat', 'npm'] : ['npm'], cands = [];
  for (const d of (process.env.PATH || '').split(path.delimiter)) for (const n of names) cands.push(path.join(d, n));
  const dirs = WIN ? [path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')] : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), path.join(home, '.volta/bin')];
  try { const nvm = path.join(home, '.nvm', 'versions', 'node'); for (const v of fs.readdirSync(nvm)) dirs.push(path.join(nvm, v, 'bin')); } catch {}
  for (const d of dirs) for (const n of names) cands.push(path.join(d, n));
  return cands.find((c) => c && exists(c)) || null;
}

// ---- install: `npm install --prefix DIR kokoro-js@x espeak-ng@y`, output in DIR/install.log, one job at a time
let job = null, lastError = '';
function install() {
  if (job || g2p()) return status();
  const npm = findNpm(); if (!npm) { lastError = 'npm not found'; return status(); }
  fs.mkdirSync(DIR, { recursive: true }); lastError = '';
  const out = fs.openSync(LOG, 'w'), args = ['install', '--prefix', DIR, '--no-audit', '--no-fund', PKG, G2P];
  const env = { ...process.env }, pk = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH'; env[pk] = path.dirname(npm) + path.delimiter + (env[pk] || '');   // npm starts with `#!/usr/bin/env node`: an editor or app opened from the Dock has a PATH without node's folder (exit 127, issue #11), and node sits next to npm
  job = WIN && /\.(cmd|bat)$/i.test(npm) ? spawn('"' + npm + '"', args.map((a) => (a === DIR ? '"' + a + '"' : a)), { shell: true, env, stdio: ['ignore', out, out], windowsHide: true }) : spawn(npm, args, { env, stdio: ['ignore', out, out], windowsHide: true });
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
  const id = ++seq, late = setTimeout(() => { if (w.pending.has(id)) { lastError = 'kokoro worker: no answer'; try { w.p.kill(); } catch {} } }, w.ready ? 60e3 : 180e3);   // a worker that hangs is stopped (and started again on the next line): every line after it waited for ever
  const next = (fn, ok) => (v) => { clearTimeout(late); busy = false; if (ok) restarts = 0; fn(v); pump(); }; busy = true;   // ok: a line spoken, the count of crashes starts again (three over days of an open editor turned the voices off)
  w.pending.set(id, { resolve: next(j.resolve, true), reject: next(j.reject) });
  const v = find(j.voice);
  w.p.stdin.write(JSON.stringify({ id, text: j.text, voice: j.voice, speed: j.speed, out: j.out, lang: v.lang, mix: v.mix }) + '\n');
}
function synth(text, voice, speed, out) {
  if (!installed()) return Promise.reject(new Error('kokoro not installed'));
  if (!hasVoice(voice)) return Promise.reject(new Error('unknown voice'));
  return new Promise((resolve, reject) => { queue.push({ text: String(text).slice(0, 2500), voice, speed, out, resolve, reject }); pump(); });
}
function status() {
  let log = ''; try { log = fs.readFileSync(LOG, 'utf8').slice(-400); } catch {}
  return { dir: DIR, sizeMb: SIZE_MB, installed: installed(), g2p: g2p(), g2pMb: G2P_MB, installing: !!job, ready: !!(worker && worker.ready), gaveUp: restarts >= MAX_RESTARTS, error: lastError || null, npm: !!findNpm(), log };
}
function shutdown() {
  for (const j of queue.splice(0)) j.reject(new Error('kokoro shut down'));
  if (worker) { const w = worker; worker = null; try { w.p.kill(); } catch {} for (const r of w.pending.values()) r.reject(new Error('kokoro shut down')); w.pending.clear(); }
  busy = false; if (job) { try { job.kill(); } catch {} job = null; }
}
module.exports = { DIR, voices, hasVoice, localeOf, speedFor, status, install, warm, synth, shutdown };
