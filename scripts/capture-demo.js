// Makes the screenshots and the demo video used in the README / website / Marketplace, from the built-in demo session.
//   npm i --no-save puppeteer-core     (and have Chrome + ffmpeg installed)
//   node scripts/capture-demo.js [stills|video|all]
// Output goes to docs/media/. Nothing here touches your real Claude Code sessions: it only uses the fictional demo.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require(path.join(process.env.PUPPETEER_DIR || '/tmp/as/pp', 'node_modules/puppeteer-core')); }
const root = path.join(__dirname, '..'), out = path.join(root, 'docs/media'), PORT = 4796;
const LANG = process.env.CAPTURE_LANG === 'fr' ? 'fr' : 'en', SUF = LANG === 'fr' ? '-fr' : '';   // CAPTURE_LANG=fr node scripts/capture-demo.js video  → demo-fr.mp4
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Nothing here reads your real sessions or settings: every folder the server looks at is a temporary one, and the drawn characters are used.
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'as-capture-')); for (const d of ['projects', 'characters']) fs.mkdirSync(path.join(tmp, d));
Object.assign(process.env, { AGENT_STANDUP_PROJECTS: path.join(tmp, 'projects'), AGENT_STANDUP_CHARACTERS: path.join(tmp, 'characters'), AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_KOKORO_DIR: path.join(tmp, 'kokoro'), AGENT_STANDUP_CODEX: 'off', AGENT_STANDUP_VIBE: 'off' });
fs.mkdirSync(out, { recursive: true });
const fresh = () => { try { fs.unlinkSync(process.env.AGENT_STANDUP_PREFS); } catch {} };   // the page saves what it is shown with (a language, the tree view) and would start the next capture from it
const prefs = (lang) => JSON.stringify({ lang, voice: false, sfx: false, music: false, epi: false, vanish: true, view: 'call', langChosen: true });

// Moments are found by what happens in the demo (not by position), so adding events to the demo never breaks the captures.
const D = require('../demo.js')();
const at = (fn) => { const i = D.events.findIndex(fn); if (i < 0) throw new Error('moment not found'); return i; };
const tool = (agent, text) => (e) => e.kind === 'tools' && e.agent === agent && ((e.tools[0].d || {}).text === text || (e.tools[0].d || {}).file === text);
const M = {
  hero: at((e) => e.kind === 'say' && e.agent === 'hugo'),
  terminal: at(tool('remy', 'npm test -- cart')),
  terminalOut: at(tool('ada', 'npm run profile -- login')),
  diff: at((e) => e.kind === 'tools' && e.agent === 'remy' && e.tools[0].name === 'Edit'),
  read: at(tool('ada', 'src/pages/Login.jsx')),
  todo: at((e) => e.kind === 'tools' && e.agent === 'main' && e.tools[0].name === 'TodoWrite'),
  tree: at((e) => e.kind === 'report' && e.agent === 'iris'),
  end: D.events.length - 1,
};
const STILLS = [   // [file, query, viewport]
  ['hero', `at=${M.hero}`, [1280, 720]],
  ['terminal', `at=${M.terminal}`, [1280, 720]], ['terminal-output', `at=${M.terminalOut}`, [1280, 720]],
  ['editor-diff', `at=${M.diff}`, [1280, 720]], ['editor-read', `at=${M.read}`, [1280, 720]],
  ['todo', `at=${M.todo}`, [1280, 720]], ['tree', `at=${M.tree}&view=tree`, [1280, 720]], ['recap', `at=${M.end}&recap=1`, [1280, 720]],
  ['hero-fr', `at=${M.hero}&lang=fr`, [1280, 720]],
];

(async () => {
  const mode = process.argv[2] || 'all';
  const server = require('../server.js').start(PORT); await new Promise((r) => server.once('listening', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((p) => { try { localStorage.setItem('cc.prefs', p); } catch {} }, prefs(LANG));
  if (mode === 'stills' || mode === 'all') {
    for (const [name, q, [w, h]] of STILLS) {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1.5 }); fresh();
      await page.goto(`http://localhost:${PORT}/?demo=1&${q}`, { waitUntil: 'networkidle0' });
      await new Promise((r) => setTimeout(r, 1500));
      await page.screenshot({ path: path.join(out, name + '.jpg'), type: 'jpeg', quality: 88 });
      console.log('still', name);
    }
  }
  if (mode === 'video' || mode === 'all') {
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 }); fresh();
    await page.goto(`http://localhost:${PORT}/?demo=1&speed=1.8&lang=${LANG}`, { waitUntil: 'networkidle0' });
    const raw = path.join(out, 'raw' + SUF + '.webm');
    const rec = await page.screencast({ path: raw });
    await page.evaluate(() => run(0));
    await page.waitForFunction(() => !S.playing, { timeout: 240000, polling: 500 });
    await new Promise((r) => setTimeout(r, 1500)); await rec.stop();
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-movflags', '+faststart', '-an', path.join(out, 'demo' + SUF + '.mp4')]);
    fs.unlinkSync(raw); console.log('video demo' + SUF + '.mp4');
  }
  await browser.close(); server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
