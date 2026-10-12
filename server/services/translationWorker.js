// A `claude` process kept running to translate one line at a time: after a slow first call each line takes ~2-3 s (a cold `claude -p` costs ~6 s).
const os = require('os');

const SYSTEM_PROMPT = 'You are a translation engine. Translate the user message into natural spoken French, as a colleague would say it in a meeting. Keep code identifiers, file paths, library names and numbers unchanged. Reply with ONLY the translation, nothing else.';
const LINES_BEFORE_RESTART = 30;    // the conversation's context grows with every line: a fresh process now and then
const LINE_TIMEOUT_MS = 45000;
const IDLE_MS = 10 * 60 * 1000;     // a worker that translated nothing for this long frees its process

class TranslationWorker {
  constructor(claude) {
    this.claude = claude;
    this.queue = [];          // lines waiting: { text, resolve }
    this.busy = false;
    this.linesDone = 0;       // by the current process
    this.process = null;
    this.current = null;      // the line being translated
    this.output = '';         // what the process wrote that is not a whole line yet
    this.idleTimer = null;
  }

  get load() { return this.queue.length + this.busy; }

  // The French of `text`, or null when it could not be translated.
  ask(text) { return new Promise((resolve) => { this.queue.push({ text, resolve }); this.#next(); }); }

  start() {
    const child = this.claude.spawn(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--no-session-persistence', '--tools', '', '--system-prompt', SYSTEM_PROMPT], { cwd: os.tmpdir() });
    if (!child) return;
    this.process = child; this.output = ''; this.linesDone = 0;
    child.stderr.on('data', (data) => { this.claude.lastError = String(data).slice(-300); });
    child.stdout.on('data', (data) => this.#read(data));
    const died = () => { if (this.process !== child) return; this.process = null; this.#finish(null); };
    child.on('close', died); child.on('error', died);
  }

  kill() {
    clearTimeout(this.idleTimer);
    if (this.process) { const child = this.process; this.process = null; try { child.kill(); } catch {} }
  }

  #read(data) {
    this.output += data;
    let end;
    while ((end = this.output.indexOf('\n')) >= 0) {
      const line = this.output.slice(0, end);
      this.output = this.output.slice(end + 1);
      try {
        const message = JSON.parse(line);
        if (message.type === 'result' && this.current) {
          this.claude.lastError = message.is_error ? String(message.result || '').slice(0, 200) : '';
          this.#finish(message.is_error ? null : String(message.result || '').trim());
        }
      } catch {}
    }
  }

  #finish(translation) {
    const job = this.current;
    this.current = null; this.busy = false;
    if (job) { clearTimeout(job.timer); job.resolve(translation); }
    this.#next();
  }

  #next() {
    if (this.busy || !this.queue.length) return;
    if (!this.process || this.linesDone >= LINES_BEFORE_RESTART) {
      if (this.process) { const old = this.process; this.process = null; old.kill(); }
      this.start();
      if (!this.process) { while (this.queue.length) this.queue.shift().resolve(null); return; }
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!this.busy && !this.queue.length) this.kill(); }, IDLE_MS);
    const job = this.queue.shift();
    this.busy = true; this.linesDone++; this.current = job;
    job.timer = setTimeout(() => { if (this.current === job && this.process) this.process.kill(); }, LINE_TIMEOUT_MS);
    this.process.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: job.text } }) + '\n');
  }
}

module.exports = { TranslationWorker };
