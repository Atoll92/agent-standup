#!/usr/bin/env node
// Supertonic worker: the natural voices of German, Danish, Japanese and Korean, which Kokoro does not speak. Supertonic 3 (Supertone; model under the OpenRAIL-M licence, downloaded on demand by kokoro.js,
// never shipped with the app) runs on the onnxruntime-node that the Kokoro install already holds. Loads the four parts of the model once, then reads one JSON request per stdin line
// ({ id, text, voice, lang, speed, out }: voice is a style file, F1 to M5), writes a 16-bit WAV to `out` and answers { id, ok, seconds } or { id, ok: false, error }. Started by kokoro.js.
// The inference follows Supertone's MIT-licensed Node example (github.com/supertone-inc/supertonic, nodejs/helper.js), with three changes: a line is cut at the ends of its sentences in every script
// (。！？ too: the example only cuts at ". "), a character the model does not know is left out instead of sent as -1, and the noise the model starts from is drawn from the line itself,
// so the same line sounds the same each time it is made (the example draws it at random, and a slip then comes and goes).
const fs = require('fs'), path = require('path'), readline = require('readline'), { createRequire } = require('module');
const send = (o) => fs.writeSync(1, JSON.stringify(o) + '\n');
const STEPS = 8;   // 5 steps slipped words in French (October 2026 audit); 8 did not
const LANGS = new Set(['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi']);
const finite = (s) => { for (let i = 0; i < s.length; i++) if (s[i] !== s[i]) return false; return true; };
function wav(samples, rate) {   // Float32 in [-1, 1] → 16-bit mono WAV
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); buf.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2); }
  return buf;
}
// ---- text, as the model was trained to read it (the example's normaliser)
const EMOJI = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
const SWAP = [['–', '-'], ['‑', '-'], ['—', '-'], ['_', ' '], ['“', '"'], ['”', '"'], ['‘', "'"], ['’', "'"], ['´', "'"], ['`', "'"], ['[', ' '], [']', ' '], ['|', ' '], ['/', ' '], ['#', ' '], ['→', ' '], ['←', ' '], ['@', ' at '], ['e.g.,', 'for example, '], ['i.e.,', 'that is, ']];
function normalise(text) {
  text = text.normalize('NFKD').replace(EMOJI, ''); for (const [a, b] of SWAP) text = text.split(a).join(b);
  text = text.replace(/[♥☆♡©\\]/g, '').replace(/ ([,.!?;:'])/g, '$1').replace(/"{2,}/g, '"').replace(/'{2,}/g, "'").replace(/\s+/g, ' ').trim();
  return /[.!?;:,'")\]}…。」』】〉》›»]$/.test(text) ? text : text + '.';
}
// ---- a long line is made in parts and joined. The model takes about 300 characters at a time (120 in Japanese and Korean, the example's limits), cut where a pause is natural, best first:
// the end of a sentence, a comma, a space; a text with none of these is cut in the middle. Each cut gets its pause, in seconds at speed 1.
const CUTS = [[/[.!?…。！？]+["'”’»)\]」』]*\s*/g, 0.45], [/[,;:、，；：]\s*/g, 0.2], [/\s+/g, 0.05]];
function halve(s) {
  for (const [re, gap] of CUTS) { let at = 0; for (const m of s.matchAll(re)) { const i = m.index + m[0].length; if (i < s.length && Math.abs(i - s.length / 2) < Math.abs(at - s.length / 2)) at = i; } if (at) return [s.slice(0, at), s.slice(at), gap]; }
  const at = Math.ceil(s.length / 2); return [s.slice(0, at), s.slice(at), 0];
}
function pieces(text, max) { if (text.length <= max) return [text]; const [a, b, gap] = halve(text); return [...pieces(a.trim(), max), gap, ...pieces(b.trim(), max)].filter((x) => x !== ''); }
// ---- the noise: a generator seeded by the line, the voice and the language
function seeded(str) {
  let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
async function main() {
  const dir = process.env.AGENT_STANDUP_KOKORO_DIR, model = process.env.AGENT_STANDUP_ST_DIR || path.join(dir, 'supertonic-3');
  const ort = createRequire(path.join(dir, 'node_modules', 'x.js'))('onnxruntime-node');   // resolved from the install folder, not from the extension
  const onnx = (n) => path.join(model, 'onnx', n), cfg = JSON.parse(fs.readFileSync(onnx('tts.json'), 'utf8')), index = JSON.parse(fs.readFileSync(onnx('unicode_indexer.json'), 'utf8'));
  // without ONNX Runtime's memory arena and patterns, the worker holds about 470 MB instead of 760, at the same speed (measured on an M1 Pro, November 2026)
  const [dp, enc, est, voc] = await Promise.all(['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder'].map((n) => ort.InferenceSession.create(onnx(n + '.onnx'), { enableCpuMemArena: false, enableMemPattern: false })));
  const rate = cfg.ae.sample_rate, chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor, dim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  const styles = new Map(), style = (v) => {   // a voice: two tensors, read once from voice_styles/<v>.json
    if (!/^[FM][1-5]$/.test(v)) throw new Error('unknown voice ' + v);
    if (!styles.has(v)) { const j = JSON.parse(fs.readFileSync(path.join(model, 'voice_styles', v + '.json'), 'utf8')), t = (o) => new ort.Tensor('float32', Float32Array.from(o.data.flat(Infinity)), o.dims); styles.set(v, { ttl: t(j.style_ttl), dp: t(j.style_dp) }); }
    return styles.get(v);
  };
  const f32 = (data, dims) => new ort.Tensor('float32', data, dims);
  async function infer(text, lang, st, speed, seed) {   // one piece → Float32Array at `rate`
    const ids = []; for (const ch of `<${lang}>${normalise(text)}</${lang}>`) { const id = index[ch.charCodeAt(0)]; if (id >= 0) ids.push(BigInt(id)); }
    const n = ids.length, textIds = new ort.Tensor('int64', BigInt64Array.from(ids), [1, n]), textMask = f32(new Float32Array(n).fill(1), [1, 1, n]);
    const dur = (await dp.run({ text_ids: textIds, style_dp: st.dp, text_mask: textMask })).duration.data[0] / speed;
    const emb = (await enc.run({ text_ids: textIds, style_ttl: st.ttl, text_mask: textMask })).text_emb;
    const len = Math.floor(dur * rate), T = Math.max(1, Math.ceil(len / chunk)), rnd = seeded(seed), lat = new Float32Array(dim * T);
    for (let i = 0; i < lat.length; i++) { const u = Math.max(1e-10, rnd()), v = rnd(); lat[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    let x = f32(lat, [1, dim, T]); const latMask = f32(new Float32Array(T).fill(1), [1, 1, T]), total = f32(Float32Array.of(STEPS), [1]);
    for (let s = 0; s < STEPS; s++) x = f32((await est.run({ noisy_latent: x, text_emb: emb, style_ttl: st.ttl, text_mask: textMask, latent_mask: latMask, total_step: total, current_step: f32(Float32Array.of(s), [1]) })).denoised_latent.data, [1, dim, T]);
    const out = (await voc.run({ latent: x })).wav_tts.data; return out.subarray(0, Math.min(len, out.length));
  }
  async function make(text, lang, voice, speed) {   // the whole line, its pieces joined by their pauses; a piece the model returns as NaN is made once more from other noise
    if (!LANGS.has(lang)) throw new Error('unknown language ' + lang);
    const st = style(voice), parts = pieces(String(text).replace(/\s+/g, ' ').trim(), lang === 'ja' || lang === 'ko' ? 120 : 300), audio = [];
    for (const p of parts) {
      if (typeof p === 'number') { audio.push(new Float32Array(Math.round((p / speed) * rate))); continue; }
      let a = await infer(p, lang, st, speed, voice + '|' + lang + '|' + p); if (!finite(a)) { a = await infer(p, lang, st, speed, 'again|' + voice + '|' + p); if (!finite(a)) throw new Error('the model returned NaN'); }
      audio.push(a);
    }
    const all = new Float32Array(audio.reduce((n, a) => n + a.length, 0)); let at = 0; for (const a of audio) { all.set(a, at); at += a.length; } return all;
  }
  send({ ready: true });
  for await (const line of readline.createInterface({ input: process.stdin })) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    try { const a = await make(m.text, m.lang, m.voice, (+m.speed || 1) * 1.05); fs.writeFileSync(m.out, wav(a, rate)); send({ id: m.id, ok: true, seconds: a.length / rate }); }   // 1.05: the example's pace, the model's own at speed 1
    catch (e) { send({ id: m.id, ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
  }
}
if (require.main === module) main().catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
module.exports = { normalise, pieces, seeded };
