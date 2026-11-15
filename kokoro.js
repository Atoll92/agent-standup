// Natural voices with Kokoro-82M (kokoro-js on ONNX Runtime), installed on demand outside the extension.
// Nothing here runs until the person clicks Install in ⚙ → Sound: the packages (about 430 MB) go to one user folder, the model (about 155 MB) is fetched on first use.
// French, Spanish and Brazilian Portuguese are the same model: kokoro-js only reads English, so the install adds a full eSpeak NG (WebAssembly, 18 MB, GPL: fetched by npm like the rest, never shipped with the app) for the phonemes. See kokoro-worker.js.
// German, Danish, Japanese and Korean, which Kokoro has no voice for, are another model, Supertonic 3, on the onnxruntime-node that kokoro-js brings: about 400 MB more, fetched from Hugging Face only when
// the person adds the voices of one of these languages (install({ st: true })), at a fixed revision, each file checked against its size and SHA-256 before it is kept. See supertonic-worker.js.
// Chinese (Simplified and Traditional, both Mandarin) is Kokoro's own Chinese model, Kokoro-82M-v1.1-zh, in the same worker as Kokoro: install({ zh: true }) adds three npm packages for its phonemes
// (pinyin-pro, jieba-wasm, opencc-js; see zh-g2p.js) and fetches the model in full precision and eight of its voices the same checked way, about 365 MB in all.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), https = require('https'), crypto = require('crypto'), { spawn } = require('child_process');

const WIN = process.platform === 'win32';
const DIR = process.env.AGENT_STANDUP_KOKORO_DIR || (WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agent-standup', 'kokoro') : path.join(os.homedir(), '.cache', 'agent-standup', 'kokoro'));
const PKG = 'kokoro-js@1.2.1', G2P = 'espeak-ng@1.0.2', G2P_MB = 18, DTYPE = 'q4', SIZE_MB = 750, MAX_RESTARTS = 3;
const WORKER = process.env.AGENT_STANDUP_KOKORO_WORKER || path.join(__dirname, 'kokoro-worker.js'), LOG = path.join(DIR, 'install.log');
const ST_WORKER = process.env.AGENT_STANDUP_ST_WORKER || path.join(__dirname, 'supertonic-worker.js'), ST_DIR = path.join(DIR, 'supertonic-3');
const ST_URL = process.env.AGENT_STANDUP_ST_URL || 'https://huggingface.co/Supertone/supertonic-3/resolve/3cadd1ee6394adea1bd021217a0e650ede09a323/';   // the revision of 18 May 2026; the upstream repository is archived
const ST_FILES = [['onnx/duration_predictor.onnx', 3700147, 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db'], ['onnx/text_encoder.onnx', 36416150, 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff'],
  ['onnx/vector_estimator.onnx', 256534781, '883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c'], ['onnx/vocoder.onnx', 101424195, '085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba'],
  ['onnx/tts.json', 8253, '42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09'], ['onnx/unicode_indexer.json', 277676, '9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f'], ['LICENSE', 15007, '0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f'],
  ['voice_styles/F1.json', 292046, 'bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2'], ['voice_styles/F2.json', 292423, '7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6'], ['voice_styles/F3.json', 290794, '12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab'],
  ['voice_styles/F4.json', 291808, 'c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b'], ['voice_styles/M1.json', 291748, 'e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b'], ['voice_styles/M2.json', 292055, 'b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50'],
  ['voice_styles/M3.json', 290198, 'ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b'], ['voice_styles/M4.json', 291522, 'ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303']];
if (process.env.AGENT_STANDUP_ST_FILES) ST_FILES.splice(0, ST_FILES.length, ...JSON.parse(process.env.AGENT_STANDUP_ST_FILES));   // the tests: small files of their own, served by a local server
const ST_MB = () => Math.round(ST_FILES.reduce((n, f) => n + f[1], 0) / 1e6);
const ZH_REPO = 'onnx-community/Kokoro-82M-v1.1-zh-ONNX', ZH_PKGS = ['pinyin-pro@3.29.5', 'jieba-wasm@2.4.0', 'opencc-js@1.4.2'], ZH_PKG_MB = 23;
const ZH_URL = process.env.AGENT_STANDUP_ZH_URL || 'https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3/';   // the revision of 5 July 2025
// The cast: in the order agents get them, a woman and a man in turn as in English, each character keeping its English name. Among the 40 of the 100 Chinese voices tried, a speech recogniser understood
// all about as well (2026-11-14), so they are chosen to sound apart: their pitches spread from 102 to 289 Hz.
const ZH_CAST = [['zf_001', 'Heart', '0a89ec12bb93fb9c74077924daf02568baad64e1f869389f5aaee01a386035f8'], ['zm_010', 'Fenrir', '73b088f7e0dc47adca4d6a642ee68843df90ff56ec2800c29d96609989d6de0a'], ['zf_038', 'Emma', '569bb54ebf05c00c89eaf56218992474a8a0494d8f94a14e933ae6a5ea9f7e31'], ['zm_029', 'Michael', 'ff78cb9f64d43fe6179c9479257775bea94dc31eade9362b0c630749025d8ecd'], ['zf_019', 'Bella', 'ab5906846335ac1227c47fd04be8b7b10a47c3ee77729296cc4c0f3f8fe79073'], ['zm_016', 'George', '4dc408a11f1e8925ff8bca40c885e7596d08be63c2c61571234b96170f8e6d1b'], ['zf_036', 'Sarah', 'b72873066ef9d57d4ea0605d32a82b2655010af51edbaecd6f926250d84efa4e'], ['zm_030', 'Puck', '32f8fe4d5f626dfb67adb73499690fd4f5952763746efbcadcf2daad4a3560a6']];   // [voice, name, SHA-256]; median pitch 249, 136, 289, 102, 168, 155, 202, 122 Hz
const ZH_FILES = [['onnx/model.onnx', 339369442, '94b973941b1852754f979be5d5e20be666d5c81d9bb886b88ae1dc85c9b895ca'], ['config.json', 44, 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f'],
  ['tokenizer.json', 4944, '5715a60b09d5e4b9074435d68c6ccd5675b9d48b220e109fdea3cda681e23d15'], ['tokenizer_config.json', 113, 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20'], ...ZH_CAST.map(([v, , sha]) => ['voices/' + v + '.bin', 522240, sha])];
if (process.env.AGENT_STANDUP_ZH_FILES) ZH_FILES.splice(0, ZH_FILES.length, ...JSON.parse(process.env.AGENT_STANDUP_ZH_FILES));
const zhPath = (f) => (f.startsWith('voices/') ? path.join(DIR, 'zh-voices', path.basename(f)) : path.join(DIR, 'models', ...ZH_REPO.split('/'), f));   // the model where transformers.js keeps what it downloads: the worker then loads it from disk
const ZH_MB = () => Math.round(ZH_FILES.reduce((n, f) => n + f[1], 0) / 1e6) + ZH_PKG_MB;

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
// German, Danish, Japanese and Korean: Supertonic 3's voices are the same in every language it speaks. Eight of its ten, a woman and a man in turn as in English, each character keeping its English name.
const ST_CAST = [['F1', 'Heart'], ['M1', 'Fenrir'], ['F2', 'Emma'], ['M2', 'Michael'], ['F3', 'Bella'], ['M3', 'George'], ['F4', 'Sarah'], ['M4', 'Puck']];
const stCast = (lang, locale) => ST_CAST.map(([st, label]) => ({ name: lang + '_' + label.toLowerCase(), label, locale, st, stLang: lang }));
const ZH = ZH_CAST.map(([v, label]) => ({ name: 'zh_' + label.toLowerCase(), label, locale: 'zh_CN', lang: 'zh', mix: [[v, 1]], zh: true }));
const VOICES = [...EN, ...FR, ...ES, ...PT, ...stCast('de', 'de_DE'), ...stCast('da', 'da_DK'), ...stCast('ja', 'ja_JP'), ...stCast('ko', 'ko_KR'), ...ZH], find = (n) => VOICES.find((v) => v.name === n);
const voices = () => VOICES.filter((v) => (v.zh ? zhInstalled() : v.st ? installed() && stInstalled() : !v.lang || g2p())).map(({ name, label, locale }) => ({ name, label, locale })), hasVoice = (n) => !!find(n);   // the ones that are not English are listed once their phonemizer or their model is there
const localeOf = (n) => (find(n) || EN[0]).locale, natural = (n) => !!((find(n) || {}).st || (find(n) || {}).zh);   // natural: a Supertonic or Chinese voice, which never hands its line to a system voice
const speedFor = (wpm) => Math.max(0.5, Math.min(2, Math.round((wpm / 178) * 20) / 20));   // 178 words a minute is about Kokoro's natural pace
const exists = (f) => { try { fs.statSync(f); return true; } catch { return false; } };
const installed = () => exists(path.join(DIR, 'node_modules', 'kokoro-js', 'package.json'));
const g2p = () => installed() && exists(path.join(DIR, 'node_modules', 'espeak-ng', 'package.json'));   // an install made before the other languages were added has kokoro-js alone: the same button adds the phonemizer
const size = (f) => { try { return fs.statSync(f).size; } catch { return -1; } }, whole = (files, at) => files.every(([f, n]) => size(at(f)) === n);   // a file is renamed into place only once checked
const stInstalled = () => whole(ST_FILES, (f) => path.join(ST_DIR, f));
const zhPkgs = () => ZH_PKGS.every((p) => exists(path.join(DIR, 'node_modules', p.slice(0, p.lastIndexOf('@')), 'package.json'))), zhInstalled = () => g2p() && zhPkgs() && whole(ZH_FILES, zhPath);

function findNpm() {
  const home = os.homedir(), names = WIN ? ['npm.cmd', 'npm.bat', 'npm'] : ['npm'], cands = [];
  for (const d of (process.env.PATH || '').split(path.delimiter)) for (const n of names) cands.push(path.join(d, n));
  const dirs = WIN ? [path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')] : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), path.join(home, '.volta/bin')];
  try { const nvm = path.join(home, '.nvm', 'versions', 'node'); for (const v of fs.readdirSync(nvm)) dirs.push(path.join(nvm, v, 'bin')); } catch {}
  for (const d of dirs) for (const n of names) cands.push(path.join(d, n));
  return cands.find((c) => c && exists(c)) || null;
}

// ---- install: `npm install --prefix DIR kokoro-js@x espeak-ng@y`, output in DIR/install.log, one job at a time; with { st: true }, the Supertonic files as well, fetched beside it;
// with { zh: true }, the three packages of the Chinese phonemes in the same npm run, and the Chinese model and voices fetched beside it
let job = null, lastError = '';
function install(o = {}) {
  const sets = [o.st && !stInstalled() && 'st', o.zh && !whole(ZH_FILES, zhPath) && 'zh'].filter(Boolean);
  if (sets.length && !dl && (installed() || job || findNpm())) fetchSets(sets);   // useless without the npm part (onnxruntime-node, kokoro-js), which is started below when it is missing
  const zh = o.zh && !zhPkgs(), pkgs = g2p() && !zh ? [] : [PKG, G2P, ...(zh ? ZH_PKGS : [])];   // Kokoro's own packages always named with the others: npm removes from the folder whatever its package.json does not list
  if (job || !pkgs.length) return status();
  const npm = findNpm(); if (!npm) { lastError = 'npm not found'; return status(); }
  fs.mkdirSync(DIR, { recursive: true }); lastError = '';
  const out = fs.openSync(LOG, 'w'), args = ['install', '--prefix', DIR, '--no-audit', '--no-fund', ...pkgs];
  const env = { ...process.env }, pk = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH'; env[pk] = path.dirname(npm) + path.delimiter + (env[pk] || '');   // npm starts with `#!/usr/bin/env node`: an editor or app opened from the Dock has a PATH without node's folder (exit 127, issue #11), and node sits next to npm
  job = WIN && /\.(cmd|bat)$/i.test(npm) ? spawn('"' + npm + '"', args.map((a) => (a === DIR ? '"' + a + '"' : a)), { shell: true, env, stdio: ['ignore', out, out], windowsHide: true }) : spawn(npm, args, { env, stdio: ['ignore', out, out], windowsHide: true });
  const done = (why) => { job = null; try { fs.closeSync(out); } catch {} if (why) lastError = why; else warm(); };
  job.on('error', (e) => done('npm: ' + e.message));
  job.on('close', (code) => done(code === 0 && installed() ? '' : 'npm install failed (exit ' + code + ')'));
  return status();
}

// ---- the Supertonic and Chinese files, one after the other: each goes to <name>.part, is checked (size and SHA-256), then renamed. A file already there whole is kept, so a download cut short goes on where it stopped.
let dl = null, dlError = '';
function get(url, file, [, size, sha], hops = 0) {
  return new Promise((resolve, reject) => {
    let abort = null;   // set once the answer is coming in: from then on every failure goes through fail(), so the half file is gone before the answer
    const req = (url.startsWith('http:') ? http : https).get(url, { headers:   /* http: only the tests' local server */ { 'user-agent': 'agent-standup' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 6) { res.resume(); return get(new URL(res.headers.location, url).href, file, [, size, sha], hops + 1).then(resolve, reject); }   // Hugging Face hands the large files to its CDN
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const h = crypto.createHash('sha256'), part = file + '.part', out = fs.createWriteStream(part); let n = 0;
      let failed = false; const fail = abort = (e) => { if (failed) return; failed = true; /* the first cause is the one told: a cut connection also makes the half file say "write after destroyed" */ res.destroy(); const gone = () => fs.rm(part, { force: true }, () => reject(e)); if (out.closed) gone(); else { out.once('close', gone); out.destroy(); } };   // the half file is gone before the answer: a second try starts a new one of the same name
      res.on('data', (d) => { h.update(d); n += d.length; if (dl) dl.done += d.length; }); res.on('error', (e) => fail(e && e.message === 'aborted' ? new Error('connection cut') : e)); out.on('error', fail);   // 'aborted' is what node says of a connection reset mid-body
      res.on('close', () => { if (!res.complete) fail(new Error('connection cut')); });
      out.on('finish', () => { if (n !== size || h.digest('hex') !== sha) return fail(new Error('a file arrived damaged')); try { fs.renameSync(part, file); resolve(); } catch (e) { fail(e); } });
      res.pipe(out);
    });
    req.on('error', (e) => (abort ? abort(e) : reject(e))); req.setTimeout(60e3, () => req.destroy(new Error('no answer from Hugging Face')));
  });
}
const CUT = /connection cut|no answer|ECONNRESET|ECONNABORTED|EPIPE|ETIMEDOUT|EAI_AGAIN|socket hang up|HTTP 5\d\d/;   // a cut connection, a stalled one or a server error: worth another try; a missing file (HTTP 404, and other 4xx), an address that does not resolve or a refused connection (ENOTFOUND, ECONNREFUSED) or a damaged file is not
async function getRetrying(url, to, f) {   // up to three tries a file, a short pause between them, the progress taken back to where the file began
  for (let at = 1, from = dl ? dl.done : 0; ; at++) { try { return await get(url, to, f); } catch (e) { if (at >= 3 || !CUT.test(String((e && (e.code || e.message)) || e))) throw e; if (dl) dl.done = from; await new Promise((r) => setTimeout(r, 1000 * at)); } }
}
const SETS = { st: { files: ST_FILES, url: () => ST_URL, at: (f) => path.join(ST_DIR, f) }, zh: { files: ZH_FILES, url: () => ZH_URL, at: zhPath } };
function fetchSets(names) {
  dlError = ''; const todo = []; for (const n of names) { const S = SETS[n]; for (const f of S.files) if (size(S.at(f[0])) !== f[1]) todo.push([S.url() + f[0], S.at(f[0]), f]); }
  dl = { done: 0, total: todo.reduce((n, t) => n + t[2][1], 0) };
  (async () => { for (const [url, to, f] of todo) { fs.mkdirSync(path.dirname(to), { recursive: true }); await getRetrying(url, to, f); } })()
    .then(() => { dl = null; }, (e) => { dl = null; dlError = 'download: ' + String((e && e.message) || e).slice(0, 120); });
}

// ---- workers: one child process per model (Kokoro; Supertonic for German, Danish, Japanese and Korean), each started on first use and restarted after a crash up to MAX_RESTARTS times.
// One line at a time across both. The Supertonic one only starts when a line in one of its languages comes, so whoever never hears them never loads its 400 MB.
const W = { k: { script: () => WORKER, env: { AGENT_STANDUP_KOKORO_DTYPE: DTYPE }, name: 'kokoro', w: null, restarts: 0, err: (e) => { lastError = e; } }, s: { script: () => ST_WORKER, env: { AGENT_STANDUP_ST_DIR: ST_DIR }, name: 'supertonic', w: null, restarts: 0, err: (e) => { dlError = e; } } };
let seq = 0; const queue = []; let busy = false;
function startWorker(kind = 'k') {
  const K = W[kind]; if (K.w) return K.w;
  if (K.restarts >= MAX_RESTARTS) throw new Error(K.name + ' worker gave up');
  const p = spawn(process.execPath, [K.script()], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AGENT_STANDUP_KOKORO_DIR: DIR, ...K.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const w = (K.w = { p, ready: false, pending: new Map(), err: '' }); let buf = '';
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; }   // library chatter is ignored
      if (m.ready) { w.ready = true; K.err(''); continue; }
      const r = w.pending.get(m.id); if (!r) continue; w.pending.delete(m.id); m.ok ? r.resolve(m) : r.reject(new Error(m.error || 'tts failed'));
    }
  });
  p.stderr.on('data', (d) => { w.err = (w.err + d).slice(-600); }); p.stdin.on('error', () => {});
  const gone = (why) => { if (K.w !== w) return; K.w = null; K.restarts++; K.err(why); const jobs = [...w.pending.values()]; w.pending.clear(); busy = false; for (const r of jobs) r.reject(new Error(why)); };
  p.on('error', (e) => gone(K.name + ' worker: ' + e.message)); p.on('close', (code) => gone(K.name + ' worker exited (' + code + ') ' + (w.err.trim().split('\n').pop() || '')));
  return w;
}
function warm() { if (installed() && !W.k.w && W.k.restarts < MAX_RESTARTS) try { startWorker('k'); } catch {} }
function pump() {
  if (busy || !queue.length) return;
  const j = queue.shift(), v = find(j.voice), kind = v.st ? 's' : 'k', K = W[kind]; let w; try { w = startWorker(kind); } catch (e) { j.reject(e); return pump(); }
  const id = ++seq, late = setTimeout(() => { if (w.pending.has(id)) { K.err(K.name + ' worker: no answer'); try { w.p.kill(); } catch {} } }, w.ready ? Math.max(60e3, j.text.length * 80) : 180e3);   // a worker that hangs is stopped (and started again on the next line): every line after it waited for ever. Supertonic takes about 40 ms a letter in Japanese
  const next = (fn, ok) => (r) => { clearTimeout(late); busy = false; if (ok) K.restarts = 0; fn(r); pump(); }; busy = true;   // ok: a line spoken, the count of crashes starts again (three over days of an open editor turned the voices off)
  w.pending.set(id, { resolve: next(j.resolve, true), reject: next(j.reject) });
  w.p.stdin.write(JSON.stringify(v.st ? { id, text: j.text, voice: v.st, lang: v.stLang, speed: j.speed, out: j.out } : { id, text: j.text, voice: j.voice, speed: j.speed, out: j.out, lang: v.lang, mix: v.mix }) + '\n');
}
function synth(text, voice, speed, out) {
  if (!installed()) return Promise.reject(new Error('kokoro not installed'));
  if (!hasVoice(voice)) return Promise.reject(new Error('unknown voice'));
  if (find(voice).st && !stInstalled()) return Promise.reject(new Error('supertonic not installed'));
  if (find(voice).zh && !zhInstalled()) return Promise.reject(new Error('chinese voices not installed'));
  return new Promise((resolve, reject) => { queue.push({ text: String(text).slice(0, 2500), voice, speed, out, resolve, reject }); pump(); });
}
function status() {
  let log = ''; try { log = fs.readFileSync(LOG, 'utf8').slice(-400); } catch {}
  const k = W.k.w, sw = W.s.w;
  return { dir: DIR, sizeMb: SIZE_MB, installed: installed(), g2p: g2p(), g2pMb: G2P_MB, installing: !!job || !!dl, ready: !!(k && k.ready), gaveUp: W.k.restarts >= MAX_RESTARTS, error: lastError || null, npm: !!findNpm(), log,
    st: stInstalled(), stMb: ST_MB(), stReady: !!(sw && sw.ready), stGaveUp: W.s.restarts >= MAX_RESTARTS, zh: zhInstalled(), zhMb: ZH_MB(), dlPct: dl ? Math.floor((100 * dl.done) / Math.max(1, dl.total)) : null, dlError: dlError || null };   // st: the Supertonic files are there (German, Danish, Japanese, Korean); zh: the Chinese packages and files
}
function shutdown() {
  for (const j of queue.splice(0)) j.reject(new Error('kokoro shut down'));
  for (const K of Object.values(W)) if (K.w) { const w = K.w; K.w = null; try { w.p.kill(); } catch {} for (const r of w.pending.values()) r.reject(new Error('kokoro shut down')); w.pending.clear(); }
  busy = false; if (job) { try { job.kill(); } catch {} job = null; }
}
module.exports = { DIR, voices, hasVoice, localeOf, natural, speedFor, status, install, warm, synth, shutdown };
