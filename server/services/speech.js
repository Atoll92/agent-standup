// What the agents say, as speech made on this machine and cached as wav files for a day:
//   the system's voices: macOS `say`, Windows System.Speech (SAPI) through PowerShell, Linux espeak-ng;
//   or Kokoro's natural voices, once the person installed them (see kokoro.js).
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const WINDOWS = process.platform === 'win32', MAC = process.platform === 'darwin';
const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const CACHE_DAYS_MS = 864e5;
const MAX_TEXT = { system: 700, kokoro: 1500 };

// The voices of the system, by name and locale ('fr_FR').
function systemVoices() {
  const voices = [];
  try {
    if (MAC) {
      const output = execFileSync('say', ['-v', '?'], { encoding: 'utf8', timeout: 5000 });
      for (const line of output.split('\n')) { const match = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#/); if (match) voices.push({ name: match[1].trim(), locale: match[2] }); }
    } else if (WINDOWS) {
      const output = execFileSync('powershell.exe', [...POWERSHELL, "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }"], { encoding: 'utf8', timeout: 20000, windowsHide: true });
      for (const line of output.split(/\r?\n/)) { const [name, locale] = line.trim().split('|'); if (name && locale) voices.push({ name, locale: locale.replace('-', '_') }); }
    } else {
      const output = execFileSync('espeak-ng', ['--voices'], { encoding: 'utf8', timeout: 5000 });
      for (const line of output.split('\n').slice(1)) {
        const columns = line.trim().split(/\s+/);
        if (columns[1] && /^(fr|en)/.test(columns[1])) voices.push({ name: columns[1], locale: columns[1].replace('-', '_').replace(/^(\w{2})$/, (language) => language + '_' + language.toUpperCase()) });
      }
    }
  } catch {}
  return voices;
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
  #jobs = new Map();   // cache key → the speech being made for it

  // Makes the cache folder (private to the person) and drops what is older than a day.
  constructor({ kokoro, dir = path.join(os.tmpdir(), 'agent-standup-tts-' + (process.getuid ? process.getuid() : 'user')) }) {
    this.kokoro = kokoro;
    this.dir = dir;
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}
    try { for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name); if (Date.now() - fs.statSync(file).mtimeMs > CACHE_DAYS_MS) fs.unlinkSync(file); } } catch {}
  }

  // { available, voices: [{ name, locale }], platform }, asked of the system once.
  systemVoices() {
    if (!this.#systemVoices) { const voices = systemVoices(); this.#systemVoices = { available: voices.length > 0, voices, platform: process.platform }; }
    return this.#systemVoices;
  }

  // Kokoro's voices, and whether they can be used now; asking warms Kokoro up.
  kokoroVoices() {
    const status = this.kokoro.status();
    if (status.installed && !status.gaveUp) this.kokoro.warm();
    return { available: status.installed && !status.gaveUp, ready: status.ready, voices: this.kokoro.voices(), platform: process.platform, engine: 'kokoro' };
  }

  // The wav file of `text` said by `voice` at `rate` words per minute; engine 'kokoro' or the system's.
  speak(text, voice, rate, engine) {
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
    const job = (isKokoro ? this.#speakWithKokoro(text, voice, rate, partial) : speakWithSystem(voice, rate, text, partial))
      .then(() => { fs.renameSync(partial, file); return file; })
      .finally(() => this.#jobs.delete(key));
    this.#jobs.set(key, job);
    return job;
  }

  // A line Kokoro cannot make goes to a system voice of the same language instead of being dropped.
  #speakWithKokoro(text, voice, rate, out) {
    return this.kokoro.synth(text, voice, this.kokoro.speedFor(rate), out).catch((error) => {
      const language = voice.startsWith('ff_') ? 'fr' : 'en', fallback = this.systemVoices().voices.find((known) => known.locale.startsWith(language + '_'));
      if (!fallback) throw error;
      return speakWithSystem(fallback.name, rate, text, out);
    });
  }
}

module.exports = { Speech };
