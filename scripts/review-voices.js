// Records what the cast says on agent-standup.com/review/ (website/src/review-lines.js) with the natural voices, through the app's own Kokoro worker,
// and writes website/static/review/voices/<id>.mp3 (mono, trimmed, at an even loudness). Also the music under the meeting: website/static/review/music.mp3 (scripts/promo-music.js).
//   node scripts/review-voices.js        (cached in reports/review-voices/: a line is made again only when its text, voice or speed changes)
// Needs the natural voices installed (the app installs them on demand, into ~/.cache/agent-standup/kokoro) and ffmpeg.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { spawn, execFileSync } = require('child_process');
global.REVIEW_SHORT = require('../website/src/review-stats.js').REVIEW_SHORT;
const { REVIEW_VOICES, REVIEW_LINES } = require('../website/src/review-lines.js');
const ROOT = path.join(__dirname, '..'), RAW = path.join(ROOT, 'reports/review-voices'), OUT = path.join(ROOT, 'website/static/review/voices');
const KDIR = process.env.AGENT_STANDUP_KOKORO_DIR || path.join(os.homedir(), '.cache/agent-standup/kokoro');
fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });

const worker = spawn(process.execPath, [path.join(ROOT, 'kokoro-worker.js')], { env: { ...process.env, AGENT_STANDUP_KOKORO_DIR: KDIR }, stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = new Map(); let buf = '', n = 0;
worker.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1); let j; try { j = JSON.parse(l); } catch { continue; }
    const w = waiting.get(j.id); if (w) { waiting.delete(j.id); j.error ? w[1](new Error(j.error)) : w[0](j); }
  }
});
const synth = (text, voice, speed, out) => new Promise((ok, ko) => { const id = ++n; waiting.set(id, [ok, ko]); worker.stdin.write(JSON.stringify({ id, text, voice, speed, out }) + '\n'); });
// silence off both ends (silenceremove), one loudness for every line (loudnorm, then back to 24 kHz: it works at 192 kHz), a gentle high-pass for the rumble
const FX = 'highpass=f=70,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse,loudnorm=I=-17:TP=-2:LRA=9,aresample=24000';

(async () => {
  const keep = new Set();
  for (const [id, [who, text]] of Object.entries(REVIEW_LINES)) {
    const [voice, speed] = REVIEW_VOICES[who], key = crypto.createHash('sha1').update([text, voice, speed].join('|')).digest('hex').slice(0, 10), raw = path.join(RAW, `${id}-${key}.wav`), mp3 = path.join(OUT, id + '.mp3');
    keep.add(id + '.mp3');
    if (!fs.existsSync(raw)) await synth(text, voice, speed, raw);
    if (!fs.existsSync(mp3) || fs.statSync(mp3).mtimeMs < fs.statSync(raw).mtimeMs) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', FX, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '56k', mp3]);
    console.log(id.padEnd(18), who.padEnd(7), text);
  }
  for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) fs.rmSync(path.join(OUT, f));   // lines taken out of review-lines.js
  const music = path.join(ROOT, 'website/static/review/music.mp3');
  if (!fs.existsSync(music)) {
    const wav = path.join(RAW, 'music.wav'); execFileSync(process.execPath, [path.join(__dirname, 'promo-music.js'), wav, '64', '']);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-af', 'loudnorm=I=-20:TP=-2,aresample=44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '96k', music]);
  }
  worker.kill(); process.exit(0);
})().catch((e) => { console.error(e); worker.kill(); process.exit(1); });
