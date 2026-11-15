// test/supertonic.test.js: the voices of German, Danish, Japanese and Korean without the real model. The worker against a stand-in onnxruntime-node in a temporary install folder,
// its text cutting, and kokoro.js fetching the Supertonic files from a local server: kept only when whole and matching, a redirect followed, a damaged file thrown away.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto'), { spawn } = require('child_process');
const WORKER = path.join(__dirname, '..', 'supertonic-worker.js'), { normalise, pieces, seeded } = require(WORKER);

test('a long line is cut where a pause is natural, in every script, and nothing of it is lost', () => {
  const ja = 'サブエージェントが終わりました。報告をお渡しします。'.repeat(8), parts = pieces(ja, 120), text = parts.filter((p) => typeof p === 'string');
  assert.ok(text.length > 1 && text.every((p) => p.length <= 120), 'pieces of at most 120 characters');
  assert.equal(text.join(''), ja, 'the pieces put back together are the line');
  assert.ok(text.every((p) => p.endsWith('。')), 'cut at the end of a Japanese sentence, which has no space after it');
  assert.ok(parts.filter((p) => typeof p === 'number').every((g) => g === 0.45), 'each cut gets the pause of a sentence end');
  assert.deepEqual(pieces('Kurz.', 300), ['Kurz.']);
  assert.equal(normalise('Der Sub-Agent ist fertig — ich leite weiter'), 'Der Sub-Agent ist fertig - ich leite weiter.', 'a dash the model reads, and a full stop added');
  const a = seeded('x'), b = seeded('x'), c = seeded('y'), ra = [a(), a()], rb = [b(), b()]; assert.deepEqual(ra, rb, 'the same line gets the same noise'); assert.notDeepEqual(ra, [c(), c()]);
});

// A stand-in for onnxruntime-node: four sessions that answer with arrays of the right length and log what they were given.
const ORT = `const fs = require('fs'), path = require('path');
class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
const log = (o) => fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(o) + '\\n');
const InferenceSession = { async create(f) { const n = path.basename(f, '.onnx'); return { async run(i) {
  if (n === 'duration_predictor') { log({ dp: Array.from(i.text_ids.data, Number), style: i.style_dp.dims }); return { duration: { data: [0.5] } }; }
  if (n === 'text_encoder') return { text_emb: { dims: [1, 4, i.text_ids.dims[1]] } };
  if (n === 'vector_estimator') { log({ step: i.current_step.data[0], total: i.total_step.data[0], T: i.noisy_latent.dims[2], first: i.noisy_latent.data[0] }); return { denoised_latent: { data: i.noisy_latent.data } }; }
  const T = i.latent.dims[2]; return { wav_tts: { data: new Float32Array(T * 512 * 6).fill(process.env.STUB_NAN ? NaN : 0.1) } };
} }; } };
module.exports = { Tensor, InferenceSession };`;
function install() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-st-')), m = path.join(dir, 'supertonic-3'), ort = path.join(dir, 'node_modules', 'onnxruntime-node');
  fs.mkdirSync(ort, { recursive: true }); fs.writeFileSync(path.join(ort, 'index.js'), ORT); fs.writeFileSync(path.join(ort, 'package.json'), '{"name":"onnxruntime-node","main":"index.js"}');
  fs.mkdirSync(path.join(m, 'onnx'), { recursive: true }); fs.mkdirSync(path.join(m, 'voice_styles'));
  for (const n of ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder']) fs.writeFileSync(path.join(m, 'onnx', n + '.onnx'), '');
  fs.writeFileSync(path.join(m, 'onnx', 'tts.json'), JSON.stringify({ ae: { sample_rate: 44100, base_chunk_size: 512 }, ttl: { latent_dim: 24, chunk_compress_factor: 6 } }));
  const index = new Array(65536).fill(-1); [...'<>/ .deHalojkoス'].forEach((ch, i) => { index[ch.charCodeAt(0)] = i + 1; }); fs.writeFileSync(path.join(m, 'onnx', 'unicode_indexer.json'), JSON.stringify(index));   // a few characters only: the others are not known to this model
  fs.writeFileSync(path.join(m, 'voice_styles', 'F1.json'), JSON.stringify({ style_ttl: { dims: [1, 2, 2], data: [[[1, 2], [3, 4]]] }, style_dp: { dims: [1, 1, 2], data: [[[5, 6]]] } }));
  return dir;
}
function run(dir, reqs, env = {}) {   // → the worker's answers, in order
  const logf = path.join(dir, 'log'); fs.writeFileSync(logf, '');
  const p = spawn(process.execPath, [WORKER], { env: { ...process.env, AGENT_STANDUP_KOKORO_DIR: dir, STUB_LOG: logf, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }); let buf = '', err = ''; const got = [];
  p.stderr.on('data', (d) => { err += d; });
  return new Promise((resolve, reject) => {
    p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.ready) { for (const r of reqs) p.stdin.write(JSON.stringify(r) + '\n'); p.stdin.end(); } else got.push(m); } });
    p.on('close', () => (got.length === reqs.length ? resolve({ got, log: fs.readFileSync(logf, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) }) : reject(new Error('worker: ' + err))));
  });
}

test('the worker makes a 44.1 kHz WAV from a line, in the language and voice asked, and the same line twice gives the same sound', async () => {
  const dir = install(), out = (n) => path.join(dir, n + '.wav');
  try {
    const { got, log } = await run(dir, [{ id: 1, text: 'Hallo', lang: 'de', voice: 'F1', speed: 1, out: out('a') }, { id: 2, text: 'Hallo', lang: 'de', voice: 'F1', speed: 1, out: out('b') }, { id: 3, text: 'Hallo', lang: 'xx', voice: 'F1', out: out('c') }, { id: 4, text: 'Hallo', lang: 'de', voice: '../x', out: out('d') }]);
    assert.equal(got[0].ok, true); assert.equal(fs.readFileSync(out('a')).readUInt32LE(24), 44100, 'the sample rate of the model');
    assert.ok(Math.abs(got[0].seconds - Math.floor((0.5 / 1.05) * 44100) / 44100) < 1e-9, 'the length the model gave, at the pace of speed 1');
    assert.deepEqual(fs.readFileSync(out('a')), fs.readFileSync(out('b')), 'made again, the same sound');
    assert.deepEqual([got[2].ok, got[3].ok], [false, false]); assert.match(got[2].error, /language/); assert.match(got[3].error, /voice/);
    const ids = log.find((l) => l.dp).dp; assert.ok(ids.length > 5 && ids.every((x) => x > 0), 'the line goes in with its language tags, and an unknown character is left out instead of sent as -1');
    assert.deepEqual(log.filter((l) => l.step !== undefined).slice(0, 8).map((l) => l.step), [0, 1, 2, 3, 4, 5, 6, 7], 'eight steps');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a long line is made in pieces and joined; a model that returns NaN fails the line instead of writing silence', async () => {
  const dir = install(), out = path.join(dir, 'l.wav');
  try {
    const { got, log } = await run(dir, [{ id: 1, text: 'スス。'.repeat(60), lang: 'ja', voice: 'F1', speed: 1, out }]);
    assert.equal(got[0].ok, true); assert.equal(log.filter((l) => l.dp).length, 2, 'two pieces of at most 120 characters');
    assert.ok(got[0].seconds > 2 * Math.floor((0.5 / 1.05) * 44100) / 44100, 'the two pieces and the pause between them');
    const nan = await run(dir, [{ id: 1, text: 'Hallo', lang: 'de', voice: 'F1', out: path.join(dir, 'n.wav') }], { STUB_NAN: '1' });
    assert.deepEqual([nan.got[0].ok, nan.got[0].error], [false, 'the model returned NaN']); assert.ok(!fs.existsSync(path.join(dir, 'n.wav')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('kokoro.js fetches the Supertonic files only when asked, follows a redirect, and keeps a file only when its size and SHA-256 match', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-stdl-')); for (const m of ['kokoro-js', 'espeak-ng']) { fs.mkdirSync(path.join(dir, 'node_modules', m), { recursive: true }); fs.writeFileSync(path.join(dir, 'node_modules', m, 'package.json'), '{}'); }   // installed, phonemizer too: no npm is started
  const files = { 'onnx/a.onnx': Buffer.from('model part a'), 'voice_styles/F1.json': Buffer.from('{"voice":1}') }, sha = (b) => crypto.createHash('sha256').update(b).digest('hex'); let damaged = true, hits = 0;
  const srv = http.createServer((req, res) => { hits++; if (req.url.startsWith('/zh/')) return res.end(zfiles[req.url.slice(4)]); const f = req.url.replace(/^\/rev\//, '');
    if (f === 'onnx/a.onnx') { res.writeHead(302, { location: '/cdn/a' }); return res.end(); }
    if (req.url === '/cdn/a') return res.end(files['onnx/a.onnx']);
    if (files[f]) return res.end(damaged ? Buffer.from('{"voice":2}') : files[f]);
    res.writeHead(404); res.end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const zfiles = { 'config.json': Buffer.from('{"zh":1}'), 'voices/zf_001.bin': Buffer.from('voice') };   // the Chinese set: a model file and a voice, each going to its own place
  Object.assign(process.env, { AGENT_STANDUP_KOKORO_DIR: dir, AGENT_STANDUP_ST_URL: `http://127.0.0.1:${srv.address().port}/rev/`, AGENT_STANDUP_ST_FILES: JSON.stringify(Object.entries(files).map(([f, b]) => [f, b.length, sha(b)])),
    AGENT_STANDUP_ZH_URL: `http://127.0.0.1:${srv.address().port}/zh/`, AGENT_STANDUP_ZH_FILES: JSON.stringify(Object.entries(zfiles).map(([f, b]) => [f, b.length, sha(b)])) });
  const k = require('../kokoro.js'), done = async () => { while (k.status().installing) await new Promise((r) => setTimeout(r, 20)); return k.status(); };
  try {
    assert.equal(k.status().st, false); assert.ok(!k.voices().some((v) => v.locale === 'de_DE'), 'no German voice before the files are there');
    k.install(); assert.equal((await done()).st, false); assert.equal(hits, 0, 'installing without st fetches nothing');
    k.install({ st: true }); let st = await done();
    assert.equal(st.st, false); assert.match(st.dlError, /damaged/, 'a file whose bytes do not match is refused'); assert.ok(!fs.existsSync(path.join(dir, 'supertonic-3', 'voice_styles', 'F1.json')) && !fs.existsSync(path.join(dir, 'supertonic-3', 'voice_styles', 'F1.json.part')), 'and not left behind');
    assert.ok(fs.existsSync(path.join(dir, 'supertonic-3', 'onnx', 'a.onnx')), 'the good file, behind a redirect, is kept'); damaged = false; hits = 0;
    k.install({ st: true }); st = await done();
    assert.deepEqual([st.st, st.dlError, hits], [true, null, 1], 'the second try fetches only what was missing'); assert.equal(st.stMb, 0);
    assert.deepEqual(k.voices().filter((v) => v.locale === 'de_DE').map((v) => v.label), ['Heart', 'Fenrir', 'Emma', 'Michael', 'Bella', 'George', 'Sarah', 'Puck'], 'eight German voices, named like the English cast');
    assert.equal(k.natural('ja_heart'), true); assert.equal(k.natural('af_heart'), false);
    for (const m of ['pinyin-pro', 'jieba-wasm', 'opencc-js']) { fs.mkdirSync(path.join(dir, 'node_modules', m), { recursive: true }); fs.writeFileSync(path.join(dir, 'node_modules', m, 'package.json'), '{}'); }   // the packages of the Chinese phonemes, as if npm had run: no npm here
    assert.equal(k.status().zh, false, 'the packages are there, not the Chinese files'); assert.ok(!k.voices().some((v) => v.locale === 'zh_CN'));
    k.install({ zh: true }); st = await done(); assert.equal(st.dlError, null);
    assert.equal(fs.readFileSync(path.join(dir, 'models', 'onnx-community', 'Kokoro-82M-v1.1-zh-ONNX', 'config.json'), 'utf8'), '{"zh":1}', 'the model where transformers.js keeps what it downloads');
    assert.equal(fs.readFileSync(path.join(dir, 'zh-voices', 'zf_001.bin'), 'utf8'), 'voice');
    assert.equal(st.zh, true); assert.deepEqual(k.voices().filter((v) => v.locale === 'zh_CN').map((v) => v.label), ['Heart', 'Fenrir', 'Emma', 'Michael', 'Bella', 'George', 'Sarah', 'Puck'], 'eight Chinese voices once all is there');
    assert.equal(k.natural('zh_heart'), true, 'a Chinese voice never hands its line to a system voice');
  } finally { srv.close(); k.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('kokoro.js tries a file again when the connection is cut in the middle of it, and tells a download that gives up in words', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-stcut-')); for (const m of ['kokoro-js', 'espeak-ng']) { fs.mkdirSync(path.join(dir, 'node_modules', m), { recursive: true }); fs.writeFileSync(path.join(dir, 'node_modules', m, 'package.json'), '{}'); }   // installed: no npm is started
  const body = Buffer.alloc(200000, 7), sha = crypto.createHash('sha256').update(body).digest('hex'); let cuts = 1, hits = 0; const errs = [];
  const srv = http.createServer((req, res) => { hits++; if (errs.length) { res.writeHead(errs.shift()); return res.end(); }   // errs: the status codes to answer with, one each
    res.writeHead(200, { 'content-length': body.length });
    if (cuts-- > 0) { res.write(body.subarray(0, 50000)); return setTimeout(() => req.socket.destroy(), 30); }   // reset after 50 KB
    res.end(body); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { AGENT_STANDUP_KOKORO_DIR: dir, AGENT_STANDUP_ST_URL: `http://127.0.0.1:${srv.address().port}/`, AGENT_STANDUP_ST_FILES: JSON.stringify([['onnx/big.bin', body.length, sha]]) });
  delete require.cache[require.resolve('../kokoro.js')];   // the folder and the files are read when the module loads
  const k = require('../kokoro.js'), done = async () => { while (k.status().installing) await new Promise((r) => setTimeout(r, 20)); return k.status(); };
  try {
    k.install({ st: true }); let st = await done();
    assert.deepEqual([st.st, st.dlError, hits], [true, null, 2], 'cut once: the file is asked for again, and the install goes on without a second click');
    fs.rmSync(path.join(dir, 'supertonic-3'), { recursive: true, force: true }); cuts = 3; hits = 0;
    k.install({ st: true }); st = await done();
    assert.equal(st.st, false); assert.equal(hits, 3, 'three tries, no more'); assert.match(st.dlError, /connection cut/, 'not the "aborted" of node');
    fs.rmSync(path.join(dir, 'supertonic-3'), { recursive: true, force: true }); cuts = 0; hits = 0; errs.push(503);
    k.install({ st: true }); st = await done(); assert.deepEqual([st.st, st.dlError, hits], [true, null, 2], 'a server error is tried again');
    fs.rmSync(path.join(dir, 'supertonic-3'), { recursive: true, force: true }); hits = 0; errs.push(404);
    k.install({ st: true }); st = await done(); assert.equal(st.st, false); assert.match(st.dlError, /HTTP 404/); assert.equal(hits, 1, 'a file that is not there is asked for once');
  } finally { srv.close(); k.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});
