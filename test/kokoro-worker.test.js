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
  async generate() { return { audio: new Float32Array(2400).fill(0.1), sampling_rate: 24000 }; }
}
module.exports = { KokoroTTS };`;
function install() {   // a fake install folder: the two packages the worker requires, nothing else
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-kokoro-'));
  for (const [m, src] of [['@huggingface/transformers', 'module.exports = { env: {} };'], ['kokoro-js', KOKORO_JS]]) { const d = path.join(dir, 'node_modules', m); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'package.json'), '{"main":"index.js"}'); fs.writeFileSync(path.join(d, 'index.js'), src); }
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
