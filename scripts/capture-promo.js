// Records the short launch video (about 45 s, captioned, with original synthesised music) from the built-in fictional demo.
//   npm i --no-save puppeteer-core     (and have Chrome + ffmpeg installed)
//   CAPTURE_LANG=fr node scripts/capture-promo.js     → docs/media/promo-fr.mp4   (default: en → promo.mp4)
// Nothing here reads your real sessions: the Sessions board is fed with made-up rows through a request interception.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require(path.join(process.env.PUPPETEER_DIR || '/tmp/as/pp', 'node_modules/puppeteer-core')); }
const root = path.join(__dirname, '..'), out = path.join(root, 'docs/media'), PORT = 4795;
const LANG = process.env.CAPTURE_LANG === 'fr' ? 'fr' : 'en', SUF = LANG === 'fr' ? '-fr' : '';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const T = (en, fr) => (LANG === 'fr' ? fr : en);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Nothing here reads your real sessions or settings: every folder the server looks at is a temporary one, and the drawn characters are used.
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'as-capture-')); for (const d of ['projects', 'characters']) fs.mkdirSync(path.join(tmp, d));
Object.assign(process.env, { AGENT_STANDUP_PROJECTS: path.join(tmp, 'projects'), AGENT_STANDUP_CHARACTERS: path.join(tmp, 'characters'), AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_KOKORO_DIR: path.join(tmp, 'kokoro'), AGENT_STANDUP_CODEX: 'off', AGENT_STANDUP_VIBE: 'off' });
fs.mkdirSync(out, { recursive: true });

const now = Date.now();
const BOARD = [
  { proj: '-Users-dev-shop-api', id: 's1', title: T('Fix the slow login on the shop API', 'Corriger le login lent de l’API boutique'), mtime: now - 3000, state: 'working', tool: 'Bash', ageMs: 3000, subActive: 3, subTotal: 4 },
  { proj: '-Users-dev-billing', id: 's2', title: T('Migrate billing to the new payments SDK', 'Migrer la facturation vers le nouveau SDK de paiement'), mtime: now - 42000, state: 'blocked', tool: 'Edit', ageMs: 42000, subActive: 0, subTotal: 2 },
  { proj: '-Users-dev-docs', id: 's3', title: T('Write the onboarding docs', 'Écrire la doc d’onboarding'), mtime: now - 20000, state: 'waiting', tool: 'Agent', ageMs: 20000, subActive: 2, subTotal: 2 },
  { proj: '-Users-dev-search', id: 's4', title: T('Refactor the search filters', 'Refactorer les filtres de recherche'), mtime: now - 150000, state: 'turn', tool: '', ageMs: 150000, subActive: 0, subTotal: 0 },
  { proj: '-Users-dev-shop-web', id: 's5', title: T('Upgrade dependencies', 'Mettre à jour les dépendances'), mtime: now - 3 * 3600e3, state: 'idle', tool: '', ageMs: 3 * 3600e3, subActive: 0, subTotal: 0 },
];

(async () => {
  const server = require('../server.js').start(PORT); await new Promise((r) => server.once('listening', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((p) => { try { localStorage.setItem('cc.prefs', p); } catch {} }, JSON.stringify({ lang: LANG, voice: false, office: false, music: false, epi: false, vanish: true, view: 'call', langChosen: true, banter: true, roster: true, reactions: false }));
  await page.setRequestInterception(true);
  page.on('request', (req) => { if (/\/api\/board/.test(req.url())) req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(BOARD) }); else req.continue(); });
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/?demo=1&speed=2.4&lang=${LANG}`, { waitUntil: 'networkidle0' });
  await sleep(800);
  const raw = path.join(os.tmpdir(), 'promo-raw' + SUF + '.webm'), rec = await page.screencast({ path: raw }), t0 = Date.now(), marks = {}, mark = (k) => (marks[k] = (Date.now() - t0) / 1000);

  mark('call');                                              // 1. the call plays: orders, answers, shared screens
  await page.evaluate(() => { run(0); }); await sleep(13000);   // not awaited: run() only returns when the whole demo is over

  mark('status');                                            // 2. one status per agent, a hand raised
  await page.evaluate(() => { pause(); polling = true; S.live = true; recomputeStatus(48); S.idx = S.events.length - 1; paintStatus();
    const by = (n) => Object.keys(S.agents).find((k) => S.agents[k].name === n); const ids = Object.keys(S.agents).filter((k) => k !== 'user' && k !== 'main');
    S.run[ids[0]] = { ts: Date.now() - 42000, name: 'Edit', id: 'x' }; S.status[ids[0]] = 'working'; paintStates(); });
  await sleep(6500);

  mark('ctx');                                               // 3. context gauge
  await page.evaluate(() => { S.model.main = 'claude-opus-5-5'; S.ctx.main = 560000; renderCtx(); }); await sleep(1800);
  await page.evaluate(() => { S.ctx.main = 890000; for (const k in S.agents) if (k !== 'main' && k !== 'user') S.ctx[k] = 120000 + (k.length * 53000) % 400000; renderCtx(); }); await sleep(3200);

  if (process.env.DEBUG_PROMO) console.log('ctx check', JSON.stringify(await page.evaluate(() => ({ chip: $('#ctxp').textContent, ctx: S.ctx.main, model: S.model.main, playing: S.playing, token: S.token, idx: S.idx }))));
  mark('board');                                             // 4. every session at a glance
  await page.evaluate(() => setView('board')); await sleep(6000);

  mark('replay');                                            // 5. replay highlights
  await page.evaluate(() => { setView('call'); S.live = false; S.events.splice(30, 0, { kind: 'compact', agent: 'main', ts: S.events[30].ts, t: S.events[30].t }); S.idx = S.events.length - 1; recomputeStatus(S.idx); syncUI(); renderHighlights(); paintStatus(); });
  await sleep(5500);

  mark('end'); await sleep(3200); const total = (Date.now() - t0) / 1000;
  await rec.stop(); await browser.close(); server.close();

  // the screencast stretches time a little: measure the real length of the video and rescale the marks
  const plain = path.join(os.tmpdir(), 'promo-plain' + SUF + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', plain]);
  const vdur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', plain]).toString()), k = vdur / total;
  for (const m in marks) marks[m] *= k;
  // captions
  const cap = [
    ['call', 'status', T('My Claude Code sub-agents now have a video call', 'Mes sous-agents Claude Code ont maintenant une visio')],
    ['status', 'ctx', T('One status per agent - working, waiting, needs you, done', 'Un seul statut par agent - au travail, en attente, besoin de toi, terminé')],
    ['ctx', 'board', T('Context gauge before auto-compaction', 'Jauge de contexte avant le compactage')],
    ['board', 'replay', T('Every session at a glance', 'Toutes vos sessions en un coup d’œil')],
    ['replay', 'end', T('Replay highlights - first error, longest wait, loops', 'Moments clés au replay - première erreur, plus longue attente, boucles')],
    ['end', null, T('Free VS Code extension - Agent Standup', 'Extension VS Code gratuite - Agent Standup')],
  ];
  const font = '/System/Library/Fonts/Helvetica.ttc', filters = cap.map(([a, b, text]) =>
    `drawtext=fontfile=${font}:text='${text}':fontsize=${text.length > 52 ? 30 : 36}:fontcolor=white:box=1:boxcolor=0x000000B8:boxborderw=16:x=(w-text_w)/2:y=h-86:enable='between(t,${(marks[a] + 0.3).toFixed(1)},${(b ? marks[b] - 0.2 : vdur).toFixed(1)})'`).join(',');
  const script = path.join(os.tmpdir(), 'promo-filter' + SUF + '.txt'); fs.writeFileSync(script, `[0:v]${filters}[out]`);
  const wav = require('./promo-music.js')(path.join(os.tmpdir(), 'promo-music' + SUF + '.wav'), vdur + 0.4, [marks.status, marks.ctx, marks.board, marks.replay, marks.end].map((x) => x + 0.1));   // original music, a soft chime at each scene change
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', plain, '-i', wav, '-filter_complex_script', script, '-map', '[out]', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    '-af', `loudnorm=I=-16:TP=-1.5:LRA=9,afade=t=out:st=${(vdur - 2.5).toFixed(1)}:d=2.5`, '-shortest', '-movflags', '+faststart', path.join(out, 'promo' + SUF + '.mp4')]);
  console.log('video promo' + SUF + '.mp4', vdur.toFixed(1) + 's', JSON.stringify(marks));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
