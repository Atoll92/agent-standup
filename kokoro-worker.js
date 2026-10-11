#!/usr/bin/env node
// Kokoro worker: loads the Kokoro-82M model once, then reads one JSON request per stdin line ({ id, text, voice, speed, out }),
// writes a 16-bit WAV to `out` and answers { id, ok, seconds } or { id, ok: false, error }. Started by kokoro.js.
const fs = require('fs'), path = require('path'), readline = require('readline'), { createRequire } = require('module');
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const send = (o) => fs.writeSync(1, JSON.stringify(o) + '\n');
const finite = (samples) => { for (let i = 0; i < samples.length; i++) if (samples[i] !== samples[i]) return false; return true; };   // a quantised model can return NaN for a whole line, which would be written as silence
function wav(samples, rate) {   // Float32 in [-1, 1] → 16-bit mono WAV
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); buf.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2); }
  return buf;
}
const FILE = { q8: 'model_quantized', q4: 'model_q4', fp32: 'model', fp16: 'model_fp16', q4f16: 'model_q4f16' };   // the file transformers.js keeps for each dtype, under models/<MODEL>/onnx/
async function main() {
  const dir = process.env.AGENT_STANDUP_KOKORO_DIR, dtype = process.env.AGENT_STANDUP_KOKORO_DTYPE || 'q4';
  const req = createRequire(path.join(dir, 'node_modules', 'x.js'));   // resolve from the install folder, not from the extension
  const tf = req('@huggingface/transformers'); tf.env.cacheDir = path.join(dir, 'models');
  const { KokoroTTS } = req('kokoro-js'), load = () => KokoroTTS.from_pretrained(MODEL, { dtype, device: 'cpu' });
  let tts; try { tts = await load(); } catch (e) {
    // transformers.js writes the model straight to its final name and never checks it again: a download cut short (the worker killed while the model
    // was being fetched, e.g. by a reload of the window) leaves a file that fails to load every time after. Drop this model's files and fetch them once more.
    const onnx = path.join(dir, 'models', ...MODEL.split('/'), 'onnx'), name = FILE[dtype] || 'model'; let dropped = 0;
    for (const ext of ['.onnx', '.onnx_data']) { try { fs.unlinkSync(path.join(onnx, name + ext)); dropped++; } catch {} }
    if (!dropped) throw e; console.error('kokoro: the ' + dtype + ' model could not be loaded (' + String((e && e.message) || e).slice(0, 80) + '); fetching it again'); tts = await load();
  }
  send({ ready: true });
  for await (const line of readline.createInterface({ input: process.stdin })) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    try {
      let a = await tts.generate(String(m.text), { voice: m.voice, speed: +m.speed || 1 });
      if (!finite(a.audio)) { a = await tts.generate(String(m.text), { voice: m.voice, speed: +m.speed || 1 }); if (!finite(a.audio)) throw new Error('the model returned NaN'); }   // made once more; if it fails again the server hands the line to a system voice
      fs.writeFileSync(m.out, wav(a.audio, a.sampling_rate)); send({ id: m.id, ok: true, seconds: a.audio.length / a.sampling_rate });
    }
    catch (e) { send({ id: m.id, ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
  }
}
main().catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
