// Lines of a session in French, and the quips of the call, written by Claude. Each answer is cached by its text.
//
// Three ways to ask, fastest first: the Anthropic API when the person has a key in the environment (~1-2 s);
// two warm `claude` workers for a few lines (~2-3 s each, see translationWorker.js); one batched `claude -p` call otherwise (~6 s).
const os = require('os');
const { TranslationWorker } = require('./translationWorker');

const TRANSLATE = 'Translate each string of this JSON array into natural spoken French, as a teammate would say it in a meeting. Keep code identifiers, file paths, library names and numbers unchanged.';
const quipInstruction = (language) => `Each string is a work report from a software agent. For each, write ONE short, deadpan, funny reaction (max 12 words) from a grumpy teammate in a South Park-style cartoon meeting, in ${language === 'fr' ? 'French' : 'English'}. No emojis.`;
const MAX_BATCH_CALLS = 3;            // `claude -p` calls running at once
const BATCH_TIMEOUT_MS = 60000;
const FEW_LINES = 3;                  // up to this many lines go to the warm workers, one each

// The JSON array in a model's answer (it may say something around it).
const arrayIn = (text) => JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));

class Translator {
  #cache = new Map();   // kind + '|' + text → its answer
  #running = 0;
  #waiting = [];

  constructor({ claude }) {
    this.claude = claude;
    this.workers = [new TranslationWorker(claude), new TranslationWorker(claude)];
  }

  // { texts: the French of each text (the text itself when there is none), ok: whether every one was translated }
  async translate(texts) {
    const missing = [...new Set(texts.filter((text) => !this.#cache.has('fr|' + text)))];
    if (missing.length && missing.length <= FEW_LINES && !process.env.ANTHROPIC_API_KEY) {
      await Promise.all(missing.map(async (text) => { const french = await this.#leastBusyWorker().ask(text); if (french) this.#cache.set('fr|' + text, french); }));
      return { texts: texts.map((text) => this.#cache.get('fr|' + text) || text), ok: texts.every((text) => this.#cache.has('fr|' + text)) };
    }
    return this.#mapAll('fr', TRANSLATE, texts);
  }

  // A teammate's reaction to each report, in `language` ('fr' or 'en'): { texts, ok } as for translate.
  quips(texts, language) { return this.#mapAll('q' + language, quipInstruction(language), texts); }

  // Start the workers before the first line comes.
  warm() { this.workers.forEach((worker) => { if (!worker.process) worker.start(); }); }

  shutdown() { this.workers.forEach((worker) => worker.kill()); }

  #leastBusyWorker() { return this.workers.reduce((first, second) => (first.load <= second.load ? first : second)); }

  // Every text through one instruction, in one call: the API, or else `claude -p`.
  #mapAll(kind, instruction, texts) {
    const missing = [...new Set(texts.filter((text) => !this.#cache.has(kind + '|' + text)))];
    const answer = (ok) => ({ texts: texts.map((text) => this.#cache.get(kind + '|' + text) || text), ok });
    if (!missing.length) return Promise.resolve(answer(true));
    const prompt = instruction + ' Output ONLY a JSON array of strings, same length and order, no markdown.\n' + JSON.stringify(missing);
    const keep = (results) => missing.forEach((text, index) => this.#cache.set(kind + '|' + text, String(results[index])));
    return this.#askApi(prompt, missing)
      .then((results) => { keep(results); return answer(true); })
      .catch(() => this.#oneAtATime(() => this.#askCli(prompt, missing).then((results) => { if (results) keep(results); return answer(!!results); })));
  }

  async #askApi(prompt, missing) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('no key');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    });
    const results = arrayIn((await response.json()).content[0].text);
    if (results.length !== missing.length) throw new Error('bad length');
    return results;
  }

  // The answers, or null when claude could not give them all.
  #askCli(prompt, missing) {
    return new Promise((resolve) => {
      const child = this.claude.spawn(['-p', '--model', 'haiku', '--no-session-persistence', '--tools', ''], { cwd: os.tmpdir() });
      if (!child) return resolve(null);
      let output = '';
      const timer = setTimeout(() => child.kill(), BATCH_TIMEOUT_MS);
      child.stdout.on('data', (data) => (output += data));
      child.on('error', () => resolve(null));
      child.on('close', () => {
        clearTimeout(timer);
        try { const results = arrayIn(output); resolve(results.length === missing.length ? results : null); } catch { resolve(null); }
      });
      child.stdin.end(prompt);
    });
  }

  // At most MAX_BATCH_CALLS of these at once; the others wait their turn.
  #oneAtATime(task) {
    return new Promise((resolve, reject) => {
      this.#waiting.push(() => task().then(resolve, reject).finally(() => { this.#running--; this.#startWaiting(); }));
      this.#startWaiting();
    });
  }

  #startWaiting() {
    while (this.#running < MAX_BATCH_CALLS && this.#waiting.length) { this.#running++; this.#waiting.shift()(); }
  }
}

module.exports = { Translator };
