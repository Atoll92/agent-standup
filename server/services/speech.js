// What the agents say, as speech made on this machine and cached as wav files for a day:
//   the system's voices: macOS `say`, Windows System.Speech (SAPI) through PowerShell, Linux espeak-ng;
//   or Kokoro's natural voices, once the person installed them (see kokoro.js).
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');

const WINDOWS = process.platform === 'win32', MAC = process.platform === 'darwin';
const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const CACHE_DAYS_MS = 864e5;
const MAX_TEXT = { system: 700, kokoro: 1500 };

// The command that lists the system's voices: [program, arguments, timeout in ms].
const LIST_VOICES = MAC ? ['say', ['-v', '?'], 5000]
  : WINDOWS ? ['powershell.exe', [...POWERSHELL, "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }"], 20000]
  : ['espeak-ng', ['--voices'], 5000];

// What that command printed → { available, voices: [{ name, locale ('fr_FR') }], platform }
function parseVoices(output) {
  const voices = [];
  if (MAC) {
    for (const line of output.split('\n')) { const match = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#/); if (match) voices.push({ name: match[1].trim(), locale: match[2] }); }
  } else if (WINDOWS) {
    for (const line of output.split(/\r?\n/)) { const [name, locale] = line.trim().split('|'); if (name && locale) voices.push({ name, locale: locale.replace('-', '_') }); }
  } else {
    for (const line of output.split('\n').slice(1)) {
      const columns = line.trim().split(/\s+/);
      if (columns[1] && /^(fr|en)/.test(columns[1])) voices.push({ name: columns[1], locale: columns[1].replace('-', '_').replace(/^(\w{2})$/, (language) => language + '_' + language.toUpperCase()) });
    }
  }
  return { available: voices.length > 0, voices, platform: process.platform };
}

// One line, spoken by a system voice at `wordsPerMinute`, into the wav file `out`.
function speakWithSystem(voice, wordsPerMinute, text, out) {
  return new Promise((resolve, reject) => {
    // macOS `say` obeys commands written between [[ and ]] (a 30-second silence, another voice, another speed) and this text comes
    // from a transcript: they are taken out, and no two brackets are left side by side.
    text = text.replace(/\[\[[^\]]*\]\]/g, ' ').replace(/\[(?=\[)/g, '[ ').replace(/\](?=\])/g, '] ');
    let child;
    if (MAC) child = spawn('say', ['-v', voice, '-r', String(wordsPerMinute), '--data-format=LEI16@22050', '-o', out, '--', text]);
    else if (WINDOWS) {
      const rate = Math.max(-6, Math.min(8, Math.round((wordsPerMinute - 175) / 12)));   // SAPI rate: -10..10
      child = spawn('powershell.exe', [...POWERSHELL, '$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice($env:AS_VOICE); $s.Rate = [int]$env:AS_RATE; $s.SetOutputToWaveFile($env:AS_OUT); $s.Speak($env:AS_TEXT); $s.Dispose()'],
        { env: { ...process.env, AS_VOICE: voice, AS_RATE: String(rate), AS_OUT: out, AS_TEXT: text }, windowsHide: true });
    } else child = spawn('espeak-ng', ['-v', voice, '-s', String(wordsPerMinute), '-w', out, '--', text]);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 && fs.existsSync(out) ? resolve() : reject(new Error('tts failed'))));
  });
}

class Speech {
  #systemVoices = null;
  #listingVoices = null;   // the system being asked for its voices, while it answers
  #jobs = new Map();   // cache key → the speech being made for it

  // Makes the cache folder (private to the person) and drops what is older than a day.
  constructor({ kokoro, dir = path.join(os.tmpdir(), 'agent-standup-tts-' + (process.getuid ? process.getuid() : 'user')) }) {
    this.kokoro = kokoro;
    this.dir = dir;
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}
    try { for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name); if (Date.now() - fs.statSync(file).mtimeMs > CACHE_DAYS_MS) fs.unlinkSync(file); } } catch {}
  }

  // { available, voices: [{ name, locale }], platform }, asked of the system once, waiting for its answer.
  systemVoices() {
    if (this.#systemVoices) return this.#systemVoices;
    let output = '';
    try { output = execFileSync(LIST_VOICES[0], LIST_VOICES[1], { encoding: 'utf8', timeout: LIST_VOICES[2], windowsHide: true }); } catch {}
    return (this.#systemVoices = parseVoices(output));
  }

  // The same, without holding the server up: the system's first answer takes a second or more, and the session the page asks for
  // at the same moment must not wait behind it.
  loadSystemVoices() {
    if (this.#systemVoices) return Promise.resolve(this.#systemVoices);
    return this.#listingVoices || (this.#listingVoices = new Promise((resolve) => {
      const keep = (output) => resolve(this.#systemVoices || (this.#systemVoices = parseVoices(output)));
      try { execFile(LIST_VOICES[0], LIST_VOICES[1], { encoding: 'utf8', timeout: LIST_VOICES[2], windowsHide: true }, (error, output) => keep(error ? '' : String(output))); } catch { keep(''); }
    }));
  }

  // Kokoro's voices, and whether they can be used now; asking warms Kokoro up.
  kokoroVoices() {
    const status = this.kokoro.status();
    if (status.installed && !status.gaveUp) this.kokoro.warm();
    return { available: status.installed && !status.gaveUp, ready: status.ready, voices: this.kokoro.voices(), platform: process.platform, engine: 'kokoro' };
  }

  // The wav file of `text` said by `voice` at `rate` words per minute; engine 'kokoro' or the system's.
  // fallbackVoice: the system voice to use when Kokoro cannot say it (the page's best system voice for that character).
  speak(text, voice, rate, engine, fallbackVoice) {
    const isKokoro = engine === 'kokoro';
    if (isKokoro) { if (!this.kokoro.hasVoice(voice)) return Promise.reject(new Error('unknown voice')); }
    else { const system = this.systemVoices(); if (!system.available || !system.voices.some((known) => known.name === voice)) return Promise.reject(new Error('unknown voice')); }
    text = String(text).slice(0, isKokoro ? MAX_TEXT.kokoro : MAX_TEXT.system);
    rate = Math.max(90, Math.min(360, Math.round(+rate || 180)));

    // kokoro2: clips made before 1.25.10 could be cut short and must not be played again
    const key = crypto.createHash('sha1').update([isKokoro ? 'kokoro2' : 'system', voice, rate, text].join('|')).digest('hex'), file = path.join(this.dir, key + '.wav');
    if (fs.existsSync(file)) return Promise.resolve(file);
    if (this.#jobs.has(key)) return this.#jobs.get(key);
    fs.mkdirSync(this.dir, { recursive: true });
    const partial = file + '.part.wav';
    const job = (isKokoro ? this.#speakWithKokoro(text, voice, rate, partial, fallbackVoice) : speakWithSystem(voice, rate, text, partial))
      .then(() => { fs.renameSync(partial, file); return file; })
      .finally(() => this.#jobs.delete(key));
    this.#jobs.set(key, job);
    return job;
  }

  // A line Kokoro cannot make goes to a system voice instead of being dropped: the one the page names, or else the first English one.
  #speakWithKokoro(text, voice, rate, out, fallbackVoice) {
    return this.kokoro.synth(text, voice, this.kokoro.speedFor(rate), out).catch((error) => {
      const voices = this.systemVoices().voices, fallback = voices.find((known) => known.name === fallbackVoice) || voices.find((known) => known.locale.startsWith('en_'));
      if (!fallback) throw error;
      return speakWithSystem(fallback.name, rate, text, out);
    });
  }
}

module.exports = { Speech };
