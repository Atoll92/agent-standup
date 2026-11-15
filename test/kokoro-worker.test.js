// test/kokoro-worker.test.js: the Kokoro worker against a stand-in kokoro-js in a temporary install folder (no model, no download)
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const WORKER = path.join(__dirname, '..', 'kokoro-worker.js'), MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_JS = `const fs = require('fs'), path = require('path');
class KokoroTTS {   // from_pretrained behaves like transformers.js: a file that is there is used as it is (and fails when it is cut short); a missing one is "downloaded"
  static async from_pretrained(model, { dtype }) {
    const f = path.join(process.env.AGENT_STANDUP_KOKORO_DIR, 'models', ...model.split('/'), 'onnx', 'model_' + dtype + '.onnx');
    fs.appendFileSync(process.env.STUB_LOG, 'load ' + (fs.existsSync(f) ? fs.statSync(f).size : 'absent') + '\\n');
    if (process.env.STUB_FAIL) throw new Error('no network');
    if (fs.existsSync(f) && fs.statSync(f).size < 100) throw new Error('Load model from ' + f + ' failed: Protobuf parsing failed.');
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(200)); return new KokoroTTS();
  }
  constructor() { this.tokenizer = Object.assign((t, o) => ({ input_ids: { text: t, dims: [1, (o && o.truncation ? Math.min(t.length, 510) : t.length) + 2] } }), { model_max_length: 512 }); }   // one token per character and, like the real one, a silent cut at the model's limit when asked to truncate
  async model({ input_ids, style, speed }) { fs.appendFileSync(process.env.STUB_LOG + '.model', JSON.stringify({ phonemes: input_ids.text.slice(0, input_ids.dims[1] - 2), style: [style.data[0], style.data[255]], dims: style.dims, speed: speed.data[0] }) + '\\n'); return { waveform: { data: new Float32Array(2400).fill(0.1) } }; }   // the model called directly, as the worker does for French: what it was given goes to a log
  async generate(text) { text = text.trim(); const kept = this.tokenizer(text, { truncation: true }).input_ids.dims[1] - 2; fs.appendFileSync(process.env.STUB_LOG + '.spoken', JSON.stringify(text.slice(0, kept)) + '\\n'); return { audio: new Float32Array(2400).fill(0.1), sampling_rate: 24000 }; }   // what was really "spoken" goes to a log
}
module.exports = { KokoroTTS };`;
// A stand-in for the eSpeak NG package, called the way the real one is (a text file in, a phoneme file out, one line per paragraph): it "phonemizes" a stretch into itself,
// marks an English word the way eSpeak does, ties two sounds, puts a hyphen after an article, and has nothing to say for an arrow. Each run is logged.
const ESPEAK_JS = `import fs from 'fs';
export default async function (o) {
  const files = {}, M = { FS: { writeFile: (n, t) => { files[n] = t; }, readFile: (n) => files[n] } }; for (const f of o.preRun) f(M);
  const arg = (k) => o.arguments[o.arguments.indexOf(k) + 1], said = files['in.txt'].split('\\n\\n');
  fs.appendFileSync(process.env.STUB_LOG + '.espeak', JSON.stringify({ lang: arg('-v'), b: arg('-b'), stretches: said.length }) + '\\n');
  files[arg('--phonout')] = said.map((s) => s.trim().replace(/→/g, '').replace(/server/g, '(en)server(fr)').replace(/tch/g, 't^ʃ').replace(/\\ble /g, 'le- ')).filter(Boolean).join('\\n') + '\\n'; return M;
}`;
function install(french) {   // a fake install folder: the two packages the worker requires, nothing else; with `french`, the phonemizer and two voice files as well
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-kokoro-'));
  for (const [m, src] of [['@huggingface/transformers', 'module.exports = { env: {}, Tensor: class { constructor(type, data, dims) { this.data = data; this.dims = dims; } } };'], ['kokoro-js', KOKORO_JS]]) { const d = path.join(dir, 'node_modules', m); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'package.json'), '{"main":"index.js"}'); fs.writeFileSync(path.join(d, 'index.js'), src); }
  if (french) {
    const d = path.join(dir, 'node_modules', 'espeak-ng'); fs.mkdirSync(path.join(d, 'dist'), { recursive: true }); fs.writeFileSync(path.join(d, 'package.json'), '{"type":"module","main":"dist/espeak-ng.js"}'); fs.writeFileSync(path.join(d, 'dist', 'espeak-ng.js'), ESPEAK_JS);
    const v = path.join(dir, 'node_modules', 'kokoro-js', 'voices'); fs.mkdirSync(v); for (const [n, x] of [['ff_siwis', 1], ['am_fenrir', 3]]) fs.writeFileSync(path.join(v, n + '.bin'), Buffer.from(new Float32Array(510 * 256).fill(x).buffer));   // a voice: 510 styles of 256 numbers
  }
  return dir;
}
function run(dir, env = {}) {   // the worker as kokoro.js starts it; resolves with what it printed once it is ready or gone
  const log = path.join(dir, 'stub.log'); fs.writeFileSync(log, '');
  const p = spawn(process.execPath, [WORKER], { env: { ...process.env, AGENT_STANDUP_KOKORO_DIR: dir, AGENT_STANDUP_KOKORO_DTYPE: 'q4', STUB_LOG: log, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  const lines = () => out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const ask = (m) => new Promise((res) => { const n = lines().length; p.stdin.write(JSON.stringify(m) + '\n'); const t = setInterval(() => { const ls = lines(); if (ls.length > n) { clearInterval(t); res(ls[ls.length - 1]); } }, 20); });
  const until = (f) => new Promise((res) => { const t = setInterval(() => { if (f()) { clearInterval(t); res(); } }, 20); });
  return { p, ask, until, lines, err: () => err, log: () => fs.readFileSync(log, 'utf8').trim().split('\n') };
}
const model = (dir) => path.join(dir, 'models', ...MODEL.split('/'), 'onnx', 'model_q4.onnx');

test('a model file cut short by an interrupted download is dropped and fetched again, once', async () => {
  const dir = install(); fs.mkdirSync(path.dirname(model(dir)), { recursive: true }); fs.writeFileSync(model(dir), Buffer.alloc(10));   // 10 bytes of a 305 MB file
  const w = run(dir);
  try {
    await w.until(() => w.lines().some((l) => l.ready) || w.p.exitCode !== null);
    assert.ok(w.lines().some((l) => l.ready), 'the worker came up: ' + w.err());
    assert.deepEqual(w.log(), ['load 10', 'load absent'], 'one failed load, the file dropped, one fresh load');
    assert.equal(fs.statSync(model(dir)).size, 200, 'the model was fetched again');
    assert.match(w.err(), /could not be loaded .*fetching it again/);
    const out = path.join(dir, 'line.wav'), r = await w.ask({ id: 1, text: 'Hello.', voice: 'af_heart', speed: 1, out });
    assert.equal(r.ok, true); assert.ok(fs.statSync(out).size > 44, 'a WAV was written');
  } finally { w.p.kill(); }
});

test('a load that fails with no model file to drop is fatal, not a loop', async () => {
  const dir = install(), w = run(dir, { STUB_FAIL: '1' });
  try {
    await w.until(() => w.p.exitCode !== null);
    assert.equal(w.p.exitCode, 1); assert.deepEqual(w.log(), ['load absent']); assert.match(w.err(), /no network/);
  } finally { w.p.kill(); }
});

test('a line longer than the model takes is made in parts and joined: nothing is dropped', async () => {
  const dir = install(), w = run(dir), log = path.join(dir, 'stub.log.spoken'), spoken = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)), squash = (s) => s.replace(/\s+/g, '');
  try {
    await w.until(() => w.lines().some((l) => l.ready));
    const fits = 'A line that fits is made in one call, as before.', long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} says something about the build, then stops.`).join(' ');   // about 2,500 characters
    let r = await w.ask({ id: 1, text: fits, voice: 'af_heart', speed: 1, out: path.join(dir, 'a.wav') }); assert.equal(r.ok, true); assert.deepEqual(spoken(), [fits]);
    fs.writeFileSync(log, ''); r = await w.ask({ id: 2, text: long, voice: 'af_heart', speed: 1, out: path.join(dir, 'b.wav') }); assert.equal(r.ok, true, r.error);
    const parts = spoken(); assert.ok(parts.length > 1 && parts.every((p) => p.trim() && p.length <= 510), 'several parts, each within the limit');
    assert.equal(squash(parts.join(' ')), squash(long), 'every character was spoken, in order'); assert.ok(r.seconds > 0.1 * parts.length - 0.01, 'the parts are all in the audio');
  } finally { w.p.kill(); }
});

test('French goes to the model as eSpeak phonemes, with the marks put back and the voice mixed as asked', async () => {
  const dir = install(true), w = run(dir), read = (ext) => fs.readFileSync(path.join(dir, 'stub.log.' + ext), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  try {
    await w.until(() => w.lines().some((l) => l.ready));
    const fr = { voice: 'fr_fenrir', lang: 'fr-fr', mix: [['ff_siwis', 0.4], ['am_fenrir', 0.6]] };
    let r = await w.ask({ id: 1, text: 'Bonjour, j’ai fini le test : server.js est « corrigé » ! Un match ?', speed: 1.1, out: path.join(dir, 'a.wav'), ...fr }); assert.equal(r.ok, true, r.error);
    const m = read('model'); assert.equal(m.length, 1, 'one call to the model, none to the English generate');
    assert.equal(m[0].phonemes, 'Bonjour, j\'ai fini le test: server.js est “corrigé”! Un maʧ?', 'marks kept, no space before them, the dot of a file name left alone, eSpeak’s ties, hyphens and language notes gone');
    assert.deepEqual(m[0].dims, [1, 256]); assert.ok(m[0].style.every((x) => Math.abs(x - 2.2) < 1e-5), '0.4 of one voice and 0.6 of the other: ' + m[0].style); assert.ok(Math.abs(m[0].speed - 1.1) < 1e-6);
    assert.deepEqual(read('espeak'), [{ lang: 'fr-fr', b: '1', stretches: 5 }], 'the whole line in one run of eSpeak'); assert.ok(fs.statSync(path.join(dir, 'a.wav')).size > 44);
    fs.writeFileSync(path.join(dir, 'stub.log.espeak'), ''); fs.writeFileSync(path.join(dir, 'stub.log.model'), '');
    r = await w.ask({ id: 2, text: 'D’accord, →, c’est fait.', speed: 1, out: path.join(dir, 'b.wav'), ...fr }); assert.equal(r.ok, true, r.error);
    assert.equal(read('model')[0].phonemes, 'D\'accord, , c\'est fait.', 'a stretch with nothing to say stays empty: the next one is not given its place');
    assert.deepEqual(read('espeak').map((e) => e.stretches), [3, 1, 1, 1], 'one run for all, then one each when a line is missing');
    fs.writeFileSync(path.join(dir, 'stub.log.model'), ''); const long = Array.from({ length: 30 }, (_, i) => `La phrase numéro ${i} parle du build, puis elle se termine.`).join(' ');   // about 1,700 characters
    r = await w.ask({ id: 3, text: long, speed: 1, out: path.join(dir, 'c.wav'), ...fr }); assert.equal(r.ok, true, r.error);
    const parts = read('model').map((x) => x.phonemes), squash = (t) => t.replace(/\s+/g, ''); assert.ok(parts.length > 1 && parts.every((p) => p.length <= 510), 'several parts, each within the limit');
    assert.equal(squash(parts.join(' ')), squash(long), 'every character was spoken, in order');
    r = await w.ask({ id: 4, text: 'Hello.', voice: 'af_heart', speed: 1, out: path.join(dir, 'd.wav') }); assert.equal(r.ok, true); assert.equal(read('model').length, parts.length, 'English still goes through kokoro-js as before');
  } finally { w.p.kill(); }
});

test('Chinese goes to its own model, loaded on the first Chinese line, as the phonemes of zh-g2p.js, an English word in it as eSpeak gives it', async () => {
  const dir = install(true), read = (ext) => fs.readFileSync(path.join(dir, 'stub.log.' + ext), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const m of ['pinyin-pro', 'jieba-wasm', 'opencc-js']) fs.symlinkSync(path.join(__dirname, '..', 'node_modules', m), path.join(dir, 'node_modules', m), 'junction');   // as the Chinese voices install them
  fs.mkdirSync(path.join(dir, 'zh-voices')); fs.writeFileSync(path.join(dir, 'zh-voices', 'zf_001.bin'), Buffer.from(new Float32Array(510 * 256).fill(5).buffer));
  const w = run(dir), zh = { lang: 'zh', mix: [['zf_001', 1]] }, g2p = require('../zh-g2p.js').make(require('pinyin-pro'), require('jieba-wasm'), require('opencc-js').Converter({ from: 'tw', to: 'cn' }));
  try {
    await w.until(() => w.lines().some((l) => l.ready)); assert.equal(w.log().length, 1, 'only the English model at start');
    const text = '你好，我改好了 server 里的错误。';
    let r = await w.ask({ id: 1, text, speed: 1, out: path.join(dir, 'a.wav'), ...zh }); assert.equal(r.ok, true, r.error);
    assert.equal(w.log().length, 2, 'the Chinese model loaded for the first Chinese line'); const m = read('model');
    assert.equal(m[0].phonemes, await g2p(text, async (x) => x), 'the phonemes of zh-g2p.js, the English word through eSpeak');
    assert.match(m[0].phonemes, /^ㄋㄧ2ㄏㄠ3, /); assert.ok(m[0].style.every((x) => x === 5), 'the Chinese voice, read from zh-voices');
    assert.deepEqual(read('espeak').map((e) => e.lang), ['en-us'], 'eSpeak asked for the English word only');
    r = await w.ask({ id: 2, text: '還有兩個測試沒通過。', speed: 1, out: path.join(dir, 'b.wav'), ...zh }); assert.equal(r.ok, true, r.error); assert.equal(w.log().length, 2, 'loaded once');
    assert.equal(read('model')[1].phonemes, await g2p('还有两个测试没通过。'), 'Traditional is read as Simplified');
    fs.writeFileSync(path.join(dir, 'stub.log.model'), ''); const long = '我检查了所有的文件，测试全部通过，没有发现新的问题。'.repeat(12);
    r = await w.ask({ id: 3, text: long, speed: 1, out: path.join(dir, 'c.wav'), ...zh }); assert.equal(r.ok, true, r.error);
    const parts = read('model'); assert.ok(parts.length > 1, 'a long Chinese line is cut at its own full stops, with no space after them');
  } finally { w.p.kill(); }
});

test('the French voices are listed once the phonemizer is installed, and reach the worker with their language and mix', async () => {
  const dir = install(false); process.env.AGENT_STANDUP_KOKORO_DIR = dir; process.env.STUB_LOG = path.join(dir, 'stub.log'); fs.writeFileSync(process.env.STUB_LOG, '');
  const kokoro = require('../kokoro.js'), names = () => kokoro.voices().map((v) => v.name);
  try {
    assert.equal(kokoro.status().g2p, false); assert.deepEqual([...new Set(kokoro.voices().map((v) => v.locale.slice(0, 2)))], ['en'], 'an install made before the other languages: English voices only, so the page keeps system voices for the rest');
    assert.ok(kokoro.hasVoice('fr_fenrir')); assert.equal(kokoro.localeOf('fr_fenrir'), 'fr_FR'); assert.equal(kokoro.localeOf('af_heart'), 'en_US');
    fs.rmSync(dir, { recursive: true }); fs.renameSync(install(true), dir);   // the same folder once the install has added the phonemizer
    assert.equal(kokoro.status().g2p, true); const of = (l) => kokoro.voices().filter((v) => v.locale.startsWith(l + '_')), fr = of('fr'), en = of('en');
    for (const l of ['fr', 'es', 'pt']) { assert.equal(of(l).length, en.length, 'as many ' + l + ' voices as English ones, so each character keeps its place in every language'); assert.equal(new Set(of(l).map((v) => v.name)).size, en.length); }
    assert.equal(fr[0].name, 'ff_siwis'); assert.equal(of('es')[0].name, 'ef_dora'); assert.equal(of('pt')[0].name, 'pf_dora'); assert.equal(kokoro.localeOf('pt_george'), 'pt_BR'); assert.deepEqual(Object.keys(fr[1]), ['name', 'label', 'locale']);
    const r = await kokoro.synth('Bonjour.', 'fr_fenrir', 1, path.join(dir, 'a.wav')); assert.ok(r.seconds > 0);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'stub.log.model'), 'utf8').trim()); assert.equal(m.phonemes, 'Bonjour.'); assert.ok(Math.abs(m.style[0] - 2.2) < 1e-5, 'ff_siwis mixed with am_fenrir');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'stub.log.espeak'), 'utf8').trim()).lang, 'fr-fr');
  } finally { kokoro.shutdown(); }
});
