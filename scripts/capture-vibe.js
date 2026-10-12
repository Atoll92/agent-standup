// Records the short video for Mistral Vibe users (about 40 s, captioned, with original synthesised music).
//   node scripts/capture-vibe.js                    → docs/media/promo-vibe.mp4       (needs puppeteer-core, Chrome and ffmpeg, like capture-promo.js)
//   CAPTURE_LANG=fr node scripts/capture-vibe.js    → docs/media/promo-vibe-fr.mp4
// What is on screen is the real app: a made-up Vibe session is written in Vibe's own format (the one its default engine keeps in unified/<id>/) into a temporary folder
// and read by the real server (vibe.js), then played as a call with its sub-agent; then the board (made-up rows through a request interception); then a few seconds of
// the built-in fictional team; then the banner.
// Nothing here reads your real sessions or settings: every folder the server looks at is a temporary one, and the drawn characters are used.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { execFileSync } = require('child_process');
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require(path.join(process.env.PUPPETEER_DIR || '/tmp/as/pp', 'node_modules/puppeteer-core')); }
const root = path.join(__dirname, '..'), out = path.join(root, 'docs/media'), PORT = 4797;
const LANG = process.env.CAPTURE_LANG === 'fr' ? 'fr' : 'en', SUF = LANG === 'fr' ? '-fr' : '', T = (en, fr) => (LANG === 'fr' ? fr : en);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-vibe-video-')), VB = path.join(tmp, 'vibe');
for (const d of ['projects', 'characters']) fs.mkdirSync(path.join(tmp, d));
Object.assign(process.env, { AGENT_STANDUP_VIBE: VB, AGENT_STANDUP_CODEX: 'off', AGENT_STANDUP_PROJECTS: path.join(tmp, 'projects'), AGENT_STANDUP_CHARACTERS: path.join(tmp, 'characters'), AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_KOKORO_DIR: path.join(tmp, 'kokoro') });

// ---- the made-up Vibe session: a coupon bug, found with the tests and a scout, fixed, checked
const ID = '0v1be000-0000-4000-8000-00000000v1be'.replace(/v/g, 'b'), WORK = '/Users/dev/work/shop', T0 = Date.now() - 20 * 60e3, TURN = 'turn-1', GEN = '0000000000000042'; let n = 0;
const base = (s, e) => ({ createdAt: T0 + s * 1000, updatedAt: T0 + (e == null ? s : e) * 1000, generationStatus: 'completed', sessionId: ID, turnId: TURN });
const msg = (s, role, text) => ({ id: role + '-' + ++n, type: 'message', role, content: [{ type: 'text', text }], source: role === 'user' ? 'turn_start' : 'harness', ...base(s) });
const think = (s, text) => ({ id: 'reasoning-' + ++n, type: 'reasoning', text, summary: [], ...base(s) });
const ok = (structured_content, more = {}) => ({ status: 'completed', outputText: '', output: { type: 'success', content: [], structured_content, ...more } });
const tool = (s, e, toolName, input, state, detail = {}) => ({ id: 'effect-' + ++n, type: 'effect', title: toolName, detail: { toolName, kind: 'tool', input, display: { message: toolName }, ...detail }, state, ...base(s, e) });
const sh = (s, e, command, stdout, returncode = 0) => tool(s, e, 'file_system.bash', { command }, ok({ command, returncode, stdout, stderr: '', was_truncated: false }));
const scout = { kind: 'subagent', agentName: 'scout-1', childSessionId: 'child-5c0u7' };
const CART = path.join(WORK, 'src/cart.js'), BEFORE = '  return sum;   // the coupon is never used', AFTER = '  return coupon ? sum * (1 - coupon.percent / 100) : sum;';
const history = [
  msg(0, 'user', T('The cart total is wrong when a coupon is applied. Find out why and fix it.', 'Le total du panier est faux quand un coupon est appliqué. Trouve pourquoi et corrige-le.')),
  think(2, T('The total is computed in src/cart.js.\nI should run the coupon tests first, and have a scout look for every place the discount is applied.', 'Le total est calculé dans src/cart.js.\nJe lance d’abord les tests des coupons, et un éclaireur cherchera tous les endroits où la remise est appliquée.')),
  msg(2, 'assistant', T('I’ll run the coupon tests and send a scout to find where the discount is applied.', 'Je lance les tests des coupons et j’envoie un éclaireur chercher où la remise est appliquée.')),
  sh(2.2, 6, 'npm test -- coupons', ' FAIL  test/coupons.test.js\n  ✓ keeps the total without a coupon (2 ms)\n  ✕ applies a 10% coupon to the total (4 ms)\n      Expected: 90\n      Received: 100\n\nTests: 1 failed, 3 passed, 4 total', 1),
  tool(6.5, 6.6, 'subagent.spawn', { agent: 'generic', task: T('Find every place where a coupon discount is applied to the cart total. Report the files and the lines.', 'Trouve tous les endroits où la remise d’un coupon est appliquée au total du panier. Donne les fichiers et les lignes.') }, ok({ type: 'success' }, { _meta: { 'mistral.vibe.subagent': { agentName: scout.agentName, agentType: null, childSessionId: scout.childSessionId, generation: 1 } } }), scout),
  tool(7, 7.4, 'file_system.read_file', { path: CART }, ok({ path: CART, content: 'function total(items, coupon) {\n  const sum = items.reduce((s, i) => s + i.price * i.qty, 0);\n' + BEFORE + '\n}\n\nmodule.exports = { total };\n', lines_read: 6, offset: 0, was_truncated: false })),
  tool(8, 15, 'subagent.wait', { agentName: scout.agentName, timeoutMs: 120000 }, ok({ type: 'success', value: T('Two places. src/cart.js computes the total and ignores the coupon. src/checkout.js applies the discount on the receipt only.', 'Deux endroits. src/cart.js calcule le total et ignore le coupon. src/checkout.js n’applique la remise que sur le reçu.') })),
  msg(16, 'assistant', T('The scout confirms it: total() ignores the coupon. I’ll apply the discount there.', 'L’éclaireur confirme : total() ignore le coupon. J’applique la remise à cet endroit.')),
  tool(16.3, 16.6, 'file_system.search_replace', { file_path: CART, content: [{ old_str: BEFORE, new_str: AFTER, replace_all: false }] }, ok({ file: CART, lines_changed: 1, warnings: [] })),
  tool(17, 17.1, 'subagent.send_message', { agentName: scout.agentName, message: T('Thanks. Check that the receipt does not apply the discount twice now.', 'Merci. Vérifie que le reçu n’applique pas la remise deux fois maintenant.') }, ok({ type: 'success' }), { agentName: scout.agentName }),
  tool(17.5, 22, 'subagent.wait', { agentName: scout.agentName, timeoutMs: 120000 }, ok({ type: 'success', value: T('Checked: the receipt reads the total as it is. Nothing is applied twice.', 'Vérifié : le reçu reprend le total tel quel. Rien n’est appliqué deux fois.') })),
  sh(22.5, 26, 'npm test -- coupons', ' PASS  test/coupons.test.js\n  ✓ keeps the total without a coupon (2 ms)\n  ✓ applies a 10% coupon to the total (3 ms)\n\nTests: 4 passed, 4 total'),
  tool(26.2, 26.3, 'subagent.stop', { agentName: scout.agentName }, ok({ type: 'success' }), { agentName: scout.agentName }),
  msg(28, 'assistant', T('Fixed: the cart total now applies the coupon, and the four coupon tests pass.', 'Corrigé : le total du panier applique maintenant le coupon, et les quatre tests des coupons passent.')),
];
const TITLE = T('Fix the cart total with a coupon', 'Corriger le total du panier avec un coupon');
{
  const dir = path.join(VB, 'logs', 'session', 'unified', ID), g = path.join(dir, 'generations', GEN), sha = crypto.createHash('sha256').update(JSON.stringify(history)).digest('hex');
  for (const d of [g, path.join(dir, 'chunks'), path.join(dir, 'journal')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(dir, 'chunks', sha + '.json'), JSON.stringify(history));
  fs.writeFileSync(path.join(g, 'manifest.json'), JSON.stringify({ manifest_version: 1, generation: GEN, snapshot_sequence: 42, session_id: ID, execution_state: 'quiescent', projection_state: { path: 'projection-state.json', chunks: [sha] }, recovery_journal_segment: { first_sequence: 43, path: 'journal/0000000000000043.jsonl' } }));
  fs.writeFileSync(path.join(g, 'projection-state.json'), JSON.stringify({ projection_state_version: 1, session_id: ID, snapshot_sequence: 42, snapshot: { format: 'harness.public-session-state/v1', activeCallbacks: [], history: { entries: [], range: 'latest' }, turnQueue: { items: [] },
    latestTurn: { id: TURN, status: 'completed', startedAt: T0, completedAt: T0 + 28000 },
    session: { id: ID, rootSessionId: ID, parentSessionId: null, title: TITLE, titleSource: 'auto', preview: TITLE, status: { type: 'idle' }, createdAt: T0, updatedAt: T0 + 28000, tokenUsage: { inputTokens: 48200, cachedInputTokens: 39800, outputTokens: 1650, totalTokens: 49850 }, contextUsage: { inputTokens: 12400, cachedInputTokens: 9800, outputTokens: 120, totalTokens: 12520 } } } }));
  fs.writeFileSync(path.join(g, 'runtime-state.json'), JSON.stringify({ session_metadata: { active_model: 'devstral', cwd: WORK } }));
  fs.writeFileSync(path.join(dir, 'journal', '0000000000000043.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ session_id: ID, parent_session_id: null, start_time: new Date(T0).toISOString(), end_time: new Date(T0 + 28000).toISOString(), environment: { working_directory: WORK }, origin_directory: WORK, username: 'dev', child_sessions: [], title: TITLE, title_source: 'auto' }));
  fs.writeFileSync(path.join(dir, 'CURRENT'), JSON.stringify({ generation: GEN, snapshot_sequence: 42, session_id: ID, store_format: 'mistral.vibe.unified-session-store/v1', store_format_minor: 8 }));
}

const now = Date.now(), BOARD = [   // the board scene: Vibe, Codex and Claude Code sessions side by side
  { proj: '_vibe', id: ID, title: TITLE, mtime: now - 4000, state: 'working', tool: '', ageMs: 4000, subActive: 1, subTotal: 1 },
  { proj: '-Users-dev-shop-api', id: 's1', title: T('Fix the slow login on the shop API', 'Corriger le login lent de l’API boutique'), mtime: now - 9000, state: 'working', tool: 'Bash', ageMs: 9000, subActive: 3, subTotal: 4 },
  { proj: '_codex', id: 'c2', title: T('Rename the pricing helpers', 'Renommer les fonctions de prix'), mtime: now - 30000, state: 'turn', tool: '', ageMs: 30000, subActive: 0, subTotal: 0 },
  { proj: '-Users-dev-billing', id: 's2', title: T('Migrate billing to the new payments SDK', 'Migrer la facturation vers le nouveau SDK de paiement'), mtime: now - 42000, state: 'blocked', tool: 'Edit', ageMs: 42000, subActive: 0, subTotal: 2 },
  { proj: '_vibe', id: 'v2', title: T('Write the onboarding docs', 'Écrire la doc d’onboarding'), mtime: now - 20000, state: 'waiting', tool: '', ageMs: 20000, subActive: 2, subTotal: 2 },
  { proj: '_codex', id: 'c3', title: T('Upgrade the test runner', 'Mettre à jour le lanceur de tests'), mtime: now - 3 * 3600e3, state: 'idle', tool: '', ageMs: 3 * 3600e3, subActive: 0, subTotal: 0 },
];
const PREFS = JSON.stringify({ lang: LANG, voice: false, office: false, music: false, sfx: false, epi: false, vanish: true, view: 'call', langChosen: true, banter: true, roster: true, reactions: false, charPack: 'none' });
const mp4 = (raw, to) => { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', 'fps=30,scale=1280:720,setsar=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-an', to]); return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', to]).toString()); };

(async () => {
  const server = require('../server.js').start(PORT); await new Promise((r) => server.once('listening', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = await browser.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument((p) => { try { localStorage.setItem('cc.prefs', p); } catch {} }, PREFS);
  await page.setRequestInterception(true);
  page.on('request', (req) => { if (/\/api\/board/.test(req.url())) req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(BOARD) }); else if (/\/api\/warm/.test(req.url())) req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); else if (/\/api\/translate/.test(req.url())) { let texts = []; try { texts = JSON.parse(req.postData() || '{}').texts || []; } catch {} req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ texts, ok: true }) }); } else req.continue(); });   // the session is written in the language of the video: a text is its own translation, and no translation helper is started
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const clip = async (name, fn) => {   // one recording: fn gets mark(), the times come back scaled to the real length of the video
    const raw = path.join(tmp, name + '.webm'), to = path.join(tmp, name + '.mp4'), rec = await page.screencast({ path: raw }), t0 = Date.now(), marks = {};
    await fn((k) => { marks[k] = (Date.now() - t0) / 1000; }); const total = (Date.now() - t0) / 1000; await rec.stop();
    const dur = mp4(raw, to), k = dur / total; for (const m in marks) marks[m] *= k; return { file: to, dur, marks };
  };

  // 1. the Vibe session as a call, then the board
  await page.goto(`http://localhost:${PORT}/?live=0&pin=${ID}&proj=_vibe&lang=${LANG}`, { waitUntil: 'load' }); await sleep(1800);
  await page.evaluate((v) => { $('#speed').value = v; S.events.forEach((e) => { if (e.text) trMem.set(baseText(e), e.text); }); }, process.env.VIBE_VIDEO_SPEED || '1.75');   // each line is its own translation
  const a = await clip('a', async (mark) => {
    mark('call'); await page.evaluate(() => { run(0); });   // not awaited inside the page: run() only returns when the session is over
    const until = Date.now() + 70000; let worked = false, joined = false;
    while (Date.now() < until) {
      const st = await page.evaluate(() => ({ playing: S.playing, idx: S.idx, n: S.events.length, tools: S.events.slice(0, S.idx + 1).some((e) => e.kind === 'tools'), sub: S.events.slice(0, S.idx + 1).some((e) => e.agent !== 'main' && e.agent !== 'user' && (e.kind === 'say' || e.kind === 'report')) }));   // the sub-agent's first words
      if (st.tools && !worked) { worked = true; mark('work'); } if (st.sub && !joined) { joined = true; mark('sub'); } if (!st.playing && st.idx >= st.n - 1) break; await sleep(200);
    }
    await page.waitForFunction(() => document.querySelector('#recap').classList.contains('on'), { timeout: 8000 }).catch(() => {});   // the recap opens by itself when a replay ends
    mark('recap'); await sleep(4200); await page.evaluate(() => { document.querySelector('#recap').classList.remove('on'); });
    mark('board'); await page.evaluate(() => setView('board')); await sleep(5200);
  });
  // 2. a few seconds of the built-in fictional team
  await page.goto(`http://localhost:${PORT}/?demo=1&speed=2.4&lang=${LANG}`, { waitUntil: 'load' }); await sleep(1500); await page.evaluate(() => setView('call')); await sleep(400);   // the page remembers the board from the scene before
  const b = await clip('b', async (mark) => { mark('team'); await page.evaluate(() => { run(0); }); await sleep(7500); });
  await browser.close(); server.close(); require('../server.js').shutdown();
  if (errors.length) throw new Error('the page reported errors: ' + errors.join(' | '));

  // 3. the banner, then everything in a row with captions and music
  const END = 3.6, t = { call: a.marks.call, work: a.marks.work || a.dur * 0.2, sub: a.marks.sub || a.dur * 0.4, recap: a.marks.recap, board: a.marks.board, team: a.dur + b.marks.team, end: a.dur + b.dur }, total = t.end + END;
  const cap = [
    ['call', 'work', T('My Mistral Vibe sessions now have a video call', 'Mes sessions Mistral Vibe ont leur appel vidéo')],
    ['work', 'sub', T('Real commands, real output, every edit as a diff', 'Les vraies commandes, leur sortie, chaque modification')],
    ['sub', 'recap', T('Sub-agents join the call, with their orders and answers', 'Les sous-agents rejoignent l’appel, consignes et réponses')],
    ['recap', 'board', T('A recap at the end - commands, errors, tokens, files', 'Un récapitulatif à la fin - commandes, erreurs, jetons')],
    ['board', 'team', T('Vibe, Codex and Claude Code sessions on one board', 'Sessions Vibe, Codex et Claude Code sur un seul tableau')],
    ['team', 'end', T('Works with Claude Code and Codex too', 'Fonctionne aussi avec Claude Code et Codex')],
    ['end', null, T('Free and open source · npx @double_geste/agent-standup --open', 'Gratuit et open source · npx @double_geste/agent-standup --open')],
  ];
  const font = '/System/Library/Fonts/Helvetica.ttc', esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '’').replace(/%/g, '\\%');
  const text = cap.map(([from, to, s]) => `drawtext=fontfile=${font}:text='${esc(s)}':fontsize=${s.length > 50 ? 28 : 36}:fontcolor=white:box=1:boxcolor=0x000000B8:boxborderw=16:x=(w-text_w)/2:y=h-86:enable='between(t,${(t[from] + 0.3).toFixed(1)},${(to ? t[to] - 0.2 : total).toFixed(1)})'`).join(',');
  const script = path.join(tmp, 'filter.txt');
  fs.writeFileSync(script, `[2:v]scale=1280:-2,pad=1280:720:0:oh-ih:color=0x121a22,fps=30,setsar=1,format=yuv420p,fade=t=in:st=0:d=0.4[end];[0:v][1:v][end]concat=n=3:v=1:a=0,${text}[out]`);
  const wav = require('./promo-music-upbeat.js')(path.join(tmp, 'music.wav'), total + 0.4, [t.sub, t.recap, t.board, t.team, t.end].map((x) => x + 0.1));
  fs.mkdirSync(out, { recursive: true }); const dest = path.join(out, 'promo-vibe' + SUF + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a.file, '-i', b.file, '-loop', '1', '-t', String(END), '-i', path.join(out, 'social.jpg'), '-i', wav, '-filter_complex_script', script, '-map', '[out]', '-map', '3:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-af', `loudnorm=I=-15:TP=-1.5:LRA=9,afade=t=out:st=${(total - 2.2).toFixed(1)}:d=2.2`, '-t', total.toFixed(2), '-movflags', '+faststart', dest]);
  console.log('video promo-vibe' + SUF + '.mp4', total.toFixed(1) + 's', JSON.stringify(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, +v.toFixed(1)]))));
  fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
