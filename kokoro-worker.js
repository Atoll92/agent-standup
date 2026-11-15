#!/usr/bin/env node
// Kokoro worker: loads the Kokoro-82M model once, then reads one JSON request per stdin line ({ id, text, voice, speed, out } and, for a voice that is not English, { lang, mix }),
// writes a 16-bit WAV to `out` and answers { id, ok, seconds } or { id, ok: false, error }. Started by kokoro.js.
const fs = require('fs'), path = require('path'), readline = require('readline'), { createRequire } = require('module'), { pathToFileURL } = require('url');
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// Chinese is another model of the same family, Kokoro-82M-v1.1-zh, in full precision: on an M1 Pro the 8-bit file was twice as slow, and the half-precision one returned silence (NaN) for most voices.
// kokoro.js puts its files, checked, where transformers.js keeps what it downloads, so loading it here reads them from disk. Its phonemes come from zh-g2p.js, its voices from <dir>/zh-voices.
const ZH_MODEL = 'onnx-community/Kokoro-82M-v1.1-zh-ONNX', ZH_DTYPE = 'fp32';
const send = (o) => fs.writeSync(1, JSON.stringify(o) + '\n');
const finite = (samples) => { for (let i = 0; i < samples.length; i++) if (samples[i] !== samples[i]) return false; return true; };   // a quantised model can return NaN for a whole line, which would be written as silence
function wav(samples, rate) {   // Float32 in [-1, 1] → 16-bit mono WAV
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); buf.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2); }
  return buf;
}
const FILE = { q8: 'model_quantized', q4: 'model_q4', fp32: 'model', fp16: 'model_fp16', q4f16: 'model_q4f16' };   // the file transformers.js keeps for each dtype, under models/<MODEL>/onnx/
// The model takes 510 phonemes per call (about 480 letters of plain English, 300 when the line is full of numbers) and kokoro-js cuts the rest without a word:
// a line that does not fit is made in parts and joined. LONG is what the tokenizer throws instead of cutting (see main).
const LONG = new Error('too long for one call'), QUIET = 0.003;
const CUTS = [[/[.!?…]+["'”’»)\]]*\s+(?![\sa-zà-ÿ])|\s*\n\s*|[。！？]+[”’」』）]*\s*/g, 0.45], [/[,;:—–]\s+|[，、；：]\s*/g, 0.2], [/\s+/g, 0.05]];   // where a line may be cut, best first, each with the pause it gets in seconds at speed 1: the end of a sentence, a comma, a space (Chinese marks need no space after them)
function halve(s) {   // two parts at the cut nearest the middle, so no part is a stray word; a text with no space at all is cut in the middle
  for (const [re, gap] of CUTS) { let at = 0; for (const m of s.matchAll(re)) { const i = m.index + m[0].length; if (i < s.length && Math.abs(i - s.length / 2) < Math.abs(at - s.length / 2)) at = i; } if (at) return [s.slice(0, at), s.slice(at), gap]; }
  const at = Math.ceil(s.length / 2); return [s.slice(0, at), s.slice(at), 0];
}
function join(parts, rate) {   // [audio, pause, audio, …] → one Float32Array. The model puts about 0.3 s of silence before and 0.45 s after what it says: kept at the two ends of the line, removed at each join, where the pause decides
  const cut = parts.map((p, i) => { if (typeof p === 'number') return new Float32Array(Math.round(p * rate)); const s = p.audio; let a = 0, z = s.length; if (i) while (a < z && Math.abs(s[a]) < QUIET) a++; if (i < parts.length - 1) while (z > a && Math.abs(s[z - 1]) < QUIET) z--; return s.subarray(a, z); });
  const out = new Float32Array(cut.reduce((n, c) => n + c.length, 0)); let at = 0; for (const c of cut) { out.set(c, at); at += c.length; } return out;
}
// ---- Languages other than English. kokoro-js only knows how to turn English into phonemes, and refuses the voices of the other languages; the model itself is not English only.
// The phonemes come from the full eSpeak NG the install adds next to kokoro-js (WebAssembly), written the way Kokoro's own Python front end (misaki) writes them, and go straight to the model.
const E2M = Object.entries({ 'a^ɪ': 'I', 'a^ʊ': 'W', 'd^z': 'ʣ', 'd^ʒ': 'ʤ', 'e^ɪ': 'A', 'o^ʊ': 'O', 'ə^ʊ': 'Q', 's^s': 'S', 't^s': 'ʦ', 't^ʃ': 'ʧ', 'ɔ^ɪ': 'Y' }).sort();   // eSpeak's tied pairs → the single letters the model was trained on
const MARKS = /(\s*(?:[;:,!?¡¿—…"«»“”(){}[\]]|\.(?![\p{L}\p{N}]))+\s*)+/gu;   // the punctuation the model reads as pauses and intonation. eSpeak drops it, so the text is phonemized between the marks and they are put back. A dot inside a word (server.js) is not one
let espeakNg = null;
async function espeak(dir, stretches, lang) {   // [text between two marks, …] → the phonemes of each, in one run of eSpeak when it answers one line per stretch
  espeakNg ||= (await import(pathToFileURL(path.join(dir, 'node_modules', 'espeak-ng', 'dist', 'espeak-ng.js')).href)).default;
  const run = async (text) => {   // the text goes in as a UTF-8 file: as an argument, accented letters arrive mangled. '-b', '1' and not '-b=1', for the same reason
    const m = await espeakNg({ arguments: ['--phonout', 'generated', '-q', '-b', '1', '--ipa', '--tie=^', '-v', lang, '-f', 'in.txt'], preRun: [(M) => M.FS.writeFile('in.txt', text)], print() {}, printErr() {} });
    return m.FS.readFile('generated', { encoding: 'utf8' }).split('\n').map((l) => l.replace(/\((\^?[a-z-])+\)/g, '').trim()).filter(Boolean);   // "(en)…(fr)": eSpeak's notes that it changed language for a word
  };
  const got = stretches.length ? await run(stretches.join('\n\n')) : []; if (got.length === stretches.length) return got;
  const each = []; for (const s of stretches) each.push((await run(s)).join(' ')); return each;   // a stretch with nothing to say (an arrow, a symbol) gave no line: one run each, so that none is given the phonemes of another
}
async function phonemes(dir, text, lang) {
  text = text.replace(/[‘’]/g, "'").replace(/«\s*/g, '“').replace(/\s*»/g, '”').replace(/\s+([:;!?])/g, '$1');   // French typography: no space before the mark for the model
  const parts = []; let last = 0;
  for (const m of text.matchAll(MARKS)) { if (m.index > last) parts.push([false, text.slice(last, m.index)]); parts.push([true, m[0]]); last = m.index + m[0].length; }
  if (last < text.length) parts.push([false, text.slice(last)]);
  const got = await espeak(dir, parts.filter((p) => !p[0]).map((p) => p[1]), lang); let i = 0, ps = parts.map(([mark, t]) => (mark ? t : got[i++])).join('');
  for (const [a, b] of E2M) ps = ps.split(a).join(b);
  return ps.replace(/[\^-]/g, '').trim();
}
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
  const strict = (m) => { const tok = m.tokenizer; if (tok) m.tokenizer = (t, o) => { const r = tok(t, { ...o, truncation: false }); if (r.input_ids.dims.at(-1) > (tok.model_max_length || 512)) throw LONG; return r; }; return m; };
  strict(tts);   // kokoro-js calls the tokenizer with truncation on, which drops every phoneme past the model's limit and says nothing: count them all here and refuse instead
  const packs = new Map(), pack = (n) => { if (!packs.has(n)) { const b = fs.readFileSync(/^z[fm]_/.test(n) ? path.join(dir, 'zh-voices', n + '.bin') : path.join(dir, 'node_modules', 'kokoro-js', 'voices', n + '.bin')); packs.set(n, new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))); } return packs.get(n); };   // a voice: 510 styles of 256 numbers, one per length of line. All 54 of v1.0 come with kokoro-js; the Chinese ones are fetched by kokoro.js
  let zh = null;   // the Chinese model and its phonemizer, loaded on the first Chinese line: whoever never hears one never loads them
  const zhLoad = async () => zh || (zh = { tts: strict(await KokoroTTS.from_pretrained(ZH_MODEL, { dtype: ZH_DTYPE, device: 'cpu' })), g2p: require(path.join(__dirname, 'zh-g2p.js')).make(req('pinyin-pro'), req('jieba-wasm'), req('opencc-js').Converter({ from: 'tw', to: 'cn' })) });
  const foreign = async (text, o) => {   // what kokoro-js' generate_from_ids does, with a style that can be a mix of several voices (o.mix: [[voice, share], …])
    const z = o.lang === 'zh' ? await zhLoad() : null, m = z ? z.tts : tts;   // Chinese: its own model; an English word inside the line is said from its English phonemes
    const ph = z ? await z.g2p(text, (w) => phonemes(dir, w, 'en-us')) : await phonemes(dir, text, o.lang);
    const { input_ids } = m.tokenizer(ph, { truncation: true }), at = 256 * Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509), style = new Float32Array(256);
    for (const [name, share] of o.mix) { const v = pack(name); for (let i = 0; i < 256; i++) style[i] += share * v[at + i]; }
    const { waveform } = await m.model({ input_ids, style: new tf.Tensor('float32', style, [1, 256]), speed: new tf.Tensor('float32', [o.speed], [1]) });
    return { audio: waveform.data, sampling_rate: 24000 };
  };
  const say = (text, o) => (o.lang ? foreign(text, o) : tts.generate(text, { voice: o.voice, speed: o.speed }));
  const make = async (text, o) => { let a = await say(text, o); if (!finite(a.audio)) { a = await say(text, o); if (!finite(a.audio)) throw new Error('the model returned NaN'); } return a; };   // made once more; if it fails again the server hands the line to a system voice
  const parts = async (text, o) => {   // → [audio] when the line fits (the usual case, made exactly as before), else [audio, pause, audio, …] in the order of the text
    try { return [await make(text, o)]; } catch (e) { if (e !== LONG) throw e; }
    const [a, b, gap] = halve(text); return [...await parts(a, o), gap / o.speed, ...await parts(b, o)];
  };
  send({ ready: true });
  for await (const line of readline.createInterface({ input: process.stdin })) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    try {
      const ps = await parts(String(m.text).trim(), { voice: m.voice, speed: +m.speed || 1, lang: m.lang, mix: m.mix }), rate = ps[0].sampling_rate, audio = ps.length > 1 ? join(ps, rate) : ps[0].audio;
      fs.writeFileSync(m.out, wav(audio, rate)); send({ id: m.id, ok: true, seconds: audio.length / rate });
    }
    catch (e) { send({ id: m.id, ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
  }
}
main().catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
