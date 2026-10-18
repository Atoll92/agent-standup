// Records the short launch video (about 35 s, 1080p, captioned for muted feeds, with original synthesised music) from the built-in fictional demo.
//   npm i --no-save puppeteer-core     (and have Chrome + ffmpeg installed)
//   CAPTURE_LANG=fr node scripts/capture-promo.js     → docs/media/promo-fr.mp4   (default: en → promo.mp4)
//   PROMO_OUT=<file>                                   writes there instead
// The order is the one people stop scrolling for: the call in motion first, then what it tells you (who is stuck, who waits on whom, what each agent costs),
// every session of every tool, the sub-agent tree, and a last card with the command to try it.
// Nothing here reads your real sessions: the Sessions board is fed with made-up rows through a request interception.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require(path.join(process.env.PUPPETEER_DIR || '/tmp/as/pp', 'node_modules/puppeteer-core')); }
const root = path.join(__dirname, '..'), out = path.join(root, 'docs/media'), PORT = 4795;
const LANG = process.env.CAPTURE_LANG === 'fr' ? 'fr' : 'en', SUF = LANG === 'fr' ? '-fr' : '';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const T = (en, fr) => (LANG === 'fr' ? fr : en);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Nothing here reads your real sessions or settings: every folder the server looks at is a temporary one, and the drawn characters are used.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-capture-')); for (const d of ['projects', 'characters']) fs.mkdirSync(path.join(tmp, d));
Object.assign(process.env, { AGENT_STANDUP_PROJECTS: path.join(tmp, 'projects'), AGENT_STANDUP_CHARACTERS: path.join(tmp, 'characters'), AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_KOKORO_DIR: path.join(tmp, 'kokoro'), AGENT_STANDUP_CODEX: 'off', AGENT_STANDUP_VIBE: 'off' });
fs.mkdirSync(out, { recursive: true });

const now = Date.now();
const BOARD = [   // one row per tool, so the board shows Claude Code, Codex and Mistral Vibe side by side
  { proj: '-Users-dev-shop-api', id: 's1', title: T('Fix the slow login on the shop API', 'Corriger le login lent de l’API boutique'), mtime: now - 3000, state: 'working', tool: 'Bash', ageMs: 3000, subActive: 3, subTotal: 4 },
  { proj: '_codex', id: 'c1', title: T('Migrate billing to the new payments SDK', 'Migrer la facturation vers le nouveau SDK de paiement'), mtime: now - 42000, state: 'blocked', tool: 'Edit', ageMs: 42000, subActive: 0, subTotal: 0 },
  { proj: '-Users-dev-docs', id: 'v1', title: T('Write the onboarding docs', 'Écrire la doc d’onboarding'), mtime: now - 20000, state: 'waiting', tool: 'Agent', ageMs: 20000, subActive: 2, subTotal: 2 },
  { proj: '_vibe', id: 's4', title: T('Refactor the search filters', 'Refactorer les filtres de recherche'), mtime: now - 150000, state: 'turn', tool: '', ageMs: 150000, subActive: 0, subTotal: 0 },
  { proj: '_codex', id: 'c2', title: T('Upgrade dependencies', 'Mettre à jour les dépendances'), mtime: now - 3 * 3600e3, state: 'idle', tool: '', ageMs: 3 * 3600e3, subActive: 0, subTotal: 0 },
];

// the demo is paused for the scenes after the call: the word "Paused" in the header would contradict them
const HIDE_PAUSED = () => { for (const el of document.querySelectorAll('body *')) if (!el.children.length && /^(paused|en pause)$/i.test(el.textContent.trim())) el.style.visibility = 'hidden'; };
(async () => {
  const server = require('../server.js').start(PORT); await new Promise((r) => server.once('listening', r));
  // 1280 x 720 css pixels drawn at 1.5: a 1920 x 1080 video with the layout people know (the flag is what makes the recorder take the whole frame)
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--force-device-scale-factor=1.5'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((p) => { try { localStorage.setItem('cc.prefs', p); } catch {} }, JSON.stringify({ lang: LANG, charYou: 'cast', voice: false, office: false, music: false, epi: false, vanish: true, view: 'call', langChosen: true, banter: true, roster: true, reactions: false }));
  await page.setRequestInterception(true);
  page.on('request', (req) => { if (/\/api\/board/.test(req.url())) req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(BOARD) }); else req.continue(); });
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
  await page.goto(`http://localhost:${PORT}/?demo=1&speed=2.4&lang=${LANG}`, { waitUntil: 'networkidle0' });
  await sleep(800);
  await page.evaluate(() => { run(0); }); await sleep(5200);     // off camera: the team has joined and the first screens are shared when the video starts (run() only returns at the end of the demo)
  const raw = path.join(os.tmpdir(), 'promo-raw' + SUF + '.webm'), rec = await page.screencast({ path: raw }), t0 = Date.now(), marks = {}, mark = (k) => (marks[k] = (Date.now() - t0) / 1000);

  mark('call');                                              // 1. the call in motion: orders, agents joining, a shared screen
  await sleep(4300);
  mark('screens'); await sleep(4700);

  mark('status');                                            // 2. who is stuck, who waits on whom
  await page.evaluate(() => { pause(); polling = true; S.live = true; recomputeStatus(48); S.idx = S.events.length - 1; paintStatus();
    const ids = Object.keys(S.agents).filter((k) => k !== 'user' && k !== 'main');
    S.run[ids[0]] = { ts: Date.now() - 42000, name: 'Edit', id: 'x' }; S.status[ids[0]] = 'working'; paintStates(); });
  await page.evaluate(HIDE_PAUSED);
  await sleep(4800);

  mark('tokens'); await sleep(3800);                         // 3. tokens per agent: the ⚡ on every tile and in the list

  mark('board');                                             // 4. every session of every tool
  await page.evaluate(() => { setView('board'); const b = document.getElementById('boardv') || document.getElementById('board'); if (b) b.style.zoom = 1.3; });
  await page.evaluate(HIDE_PAUSED); await sleep(5200);   // bigger cards: at this width the board fills only a third of the frame

  mark('tree');                                              // 5. the sub-agent tree
  await page.evaluate(() => { const b = document.getElementById('boardv') || document.getElementById('board'); if (b) b.style.zoom = ''; setView('tree'); const t = document.getElementById('tree'); if (t) t.style.zoom = 1.75; });
  await page.evaluate(HIDE_PAUSED); await sleep(4300);   // the tree sits in a corner at its own size

  mark('end'); await page.evaluate(() => { const t = document.getElementById('tree'); if (t) t.style.zoom = ''; setView('call'); }); await sleep(4600); const total = (Date.now() - t0) / 1000;
  await rec.stop(); await browser.close(); server.close();

  // the screencast stretches time a little: measure the real length of the video and rescale the marks
  const plain = path.join(os.tmpdir(), 'promo-plain' + SUF + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', plain]);
  const vdur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', plain]).toString()), k = vdur / total;
  for (const m in marks) marks[m] *= k;
  // captions: short lines, big, near the bottom (over the timeline), for people who watch with the sound off. Each text goes through a file: no escaping of quotes or colons
  const bold = fs.existsSync('/System/Library/Fonts/Supplemental/Arial Bold.ttf') ? '/System/Library/Fonts/Supplemental/Arial Bold.ttf' : '/System/Library/Fonts/Helvetica.ttc', mono = '/System/Library/Fonts/Menlo.ttc';
  const cap = [
    ['call', 'screens', T('Your Claude Code sub-agents, in a live call', 'Vos sous-agents Claude Code, en visio')],
    ['screens', 'status', T('Real commands and diffs, on their screens', 'Les vraies commandes et les diffs, à l’écran')],
    ['status', 'tokens', T('Who is working, who is stuck, who waits on whom', 'Qui travaille, qui bloque, qui attend qui')],
    ['tokens', 'board', T('Tokens per agent: spot the expensive one', 'Les tokens par agent : repérez le plus coûteux')],
    ['board', 'tree', T('Every session: Claude Code, Codex, Mistral Vibe', 'Toutes vos sessions : Claude Code, Codex, Mistral Vibe')],
    ['tree', 'end', T('The whole sub-agent tree, live or in replay', 'Tout l’arbre des sous-agents, en direct ou en replay')],
  ];
  let n = 0; const txt = (s) => { const f = path.join(tmp, `cap${n++}.txt`); fs.writeFileSync(f, s); return f; };
  const at = (a, b) => `enable='between(t,${(marks[a] + 0.15).toFixed(2)},${(b ? marks[b] - 0.1 : vdur).toFixed(2)})'`;
  const filters = cap.map(([a, b, text]) => `drawtext=fontfile=${bold}:textfile=${txt(text)}:fontsize=54:fontcolor=white:box=1:boxcolor=0x0b0d14E6:boxborderw=24:x=(w-text_w)/2:y=h-178:${at(a, b)}`);
  // the last card: the call dimmed, the name, what it is, the command, where it runs
  const e = `enable='gte(t,${(marks.end + 0.1).toFixed(2)})'`;
  filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0x0b0d14@0.82:t=fill:${e}`,
    `drawtext=fontfile=${bold}:textfile=${txt('Agent Standup')}:fontsize=118:fontcolor=white:x=(w-text_w)/2:y=300:${e}`,
    `drawtext=fontfile=${bold}:textfile=${txt(T('Free  ·  runs locally  ·  zero tokens', 'Gratuit  ·  en local  ·  zéro token'))}:fontsize=50:fontcolor=0xf5c04a:x=(w-text_w)/2:y=460:${e}`,
    `drawtext=fontfile=${mono}:textfile=${txt('npx @double_geste/agent-standup --open')}:fontsize=44:fontcolor=white:box=1:boxcolor=0x1d2130:boxborderw=26:x=(w-text_w)/2:y=600:${e}`,
    `drawtext=fontfile=${bold}:textfile=${txt(T('VS Code  ·  Cursor  ·  terminal  ·  desktop app', 'VS Code  ·  Cursor  ·  terminal  ·  application'))}:fontsize=40:fontcolor=0xc3c6d4:x=(w-text_w)/2:y=740:${e}`);
  const script = path.join(os.tmpdir(), 'promo-filter' + SUF + '.txt'); fs.writeFileSync(script, `[0:v]${filters.join(',')}[out]`);
  const wav = require('./promo-music-upbeat.js')(path.join(os.tmpdir(), 'promo-music' + SUF + '.wav'), vdur + 0.4, [marks.status, marks.board, marks.end].map((x) => x + 0.05));   // original music, a lift at each big change
  const dest = process.env.PROMO_OUT || path.join(out, 'promo' + SUF + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', plain, '-i', wav, '-filter_complex_script', script, '-map', '[out]', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-preset', 'slow', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    '-af', `loudnorm=I=-16:TP=-1.5:LRA=9,afade=t=out:st=${(vdur - 2.5).toFixed(1)}:d=2.5`, '-shortest', '-movflags', '+faststart', dest]);
  console.log('video ' + path.basename(dest), vdur.toFixed(1) + 's', JSON.stringify(Object.fromEntries(Object.entries(marks).map(([a, v]) => [a, +v.toFixed(2)]))));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
