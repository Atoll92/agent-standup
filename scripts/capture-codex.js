// Records the short video for Codex users (about 40 s, captioned, with original synthesised music).
//   node scripts/capture-codex.js     → docs/media/promo-codex.mp4          (needs puppeteer-core, Chrome and ffmpeg, like capture-promo.js)
// What is on screen is the real app: a made-up Codex session is written in Codex's own file format into a temporary folder and read by the real server (core/sources/codex),
// then played as a call; then the board (made-up rows through a request interception); then a few seconds of the built-in fictional team; then the banner.
// Nothing here reads your real sessions or settings: every folder the server looks at is a temporary one, and the drawn characters are used.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const root = path.join(__dirname, '..'), out = path.join(root, 'docs/media'), PORT = 4796;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-codex-video-')), CX = path.join(tmp, 'codex');
for (const d of ['projects', 'characters']) fs.mkdirSync(path.join(tmp, d));
Object.assign(process.env, { AGENT_STANDUP_CODEX: CX, AGENT_STANDUP_PROJECTS: path.join(tmp, 'projects'), AGENT_STANDUP_CHARACTERS: path.join(tmp, 'characters'), AGENT_STANDUP_PREFS: path.join(tmp, 'prefs.json'), AGENT_STANDUP_KOKORO_DIR: path.join(tmp, 'kokoro') });

// ---- the made-up Codex session: a coupon bug, found with the tests, fixed, a question, a new test
const ID = '01c0de00-0000-7000-8000-00000000c0de', WORK = '/Users/dev/work/shop', T0 = Date.now() - 20 * 60e3; let clock = T0, ord = 0, n = 0;
const at = (s) => { clock = T0 + s * 1000; }, rec = (type, payload) => JSON.stringify({ timestamp: new Date(clock).toISOString(), ordinal: ++ord, type, payload });
const ev = (p) => rec('event_msg', p), item = (it, startedS) => ev({ type: 'item_completed', item: it, ...(startedS != null ? { started_at_ms: T0 + startedS * 1000 } : {}), completed_at_ms: clock });
const think = (text) => rec('response_item', { type: 'reasoning', id: 'rs_' + ++n, summary: [{ type: 'summary_text', text }] });
const you = (text) => item({ type: 'UserMessage', id: 'item-' + ++n, content: [{ type: 'text', text }] });
const says = (text, final) => item({ type: 'AgentMessage', id: 'msg_' + ++n, content: [{ type: 'text', text }], phase: final ? 'final_answer' : 'commentary' });
const cmd = (command, output, code, startedS) => item({ type: 'CommandExecution', id: 'call_' + String(++n).padStart(6, '0'), command: ['/bin/zsh', '-lc', command], cwd: WORK, status: code ? 'failed' : 'completed', aggregated_output: output, exit_code: code }, startedS);
const tokens = (input, cached, output) => ev({ type: 'token_count', info: { total_token_usage: { total_tokens: input + output + n }, last_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output }, model_context_window: 258400 } });
const CART = path.join(WORK, 'src/cart.js'), TEST = path.join(WORK, 'test/coupons.test.js');
const lines = [
  (at(0), rec('session_meta', { session_id: ID, id: ID, timestamp: new Date(T0).toISOString(), cwd: WORK, originator: 'Codex Desktop', cli_version: '0.158.0', source: 'vscode', thread_source: 'user' })),
  rec('turn_context', { turn_id: 't1', cwd: WORK, model: 'gpt-codex' }), ev({ type: 'task_started', turn_id: 't1' }),
  (at(1), you('The cart total is wrong when a coupon is applied. Can you find out why and fix it?')),
  (at(4), think('Reproduce first.\nThe cart tests should show the wrong total.')),
  (at(5), says('I will reproduce it with the cart tests first.')),
  (at(11), cmd('npm test -- cart', '> shop@2.4.0 test\n> vitest run cart\n\n ✓ adds items (3 ms)\n ✓ removes items (1 ms)\n ✗ applies a 10% coupon (4 ms)\n     expected 90.00, received 90.01\n\n Tests  1 failed | 2 passed', 1, 7)), tokens(18400, 12000, 310),
  (at(13), think('One cent too many.\nThe coupon must be applied after the total is rounded.')),
  (at(17), cmd("sed -n '12,24p' src/cart.js", 'export function total(cart) {\n  const sum = cart.items.reduce((s, i) => s + i.price * i.qty, 0);\n  const rounded = Math.round(sum * 100) / 100;\n  return rounded - rounded * (cart.coupon?.rate ?? 0);\n}', 0, 15)), tokens(21900, 18000, 280),
  (at(20), says('Found it: the coupon is subtracted after the total is rounded, so the cents drift.')),
  (at(25), item({ type: 'FileChange', id: 'call_' + String(++n).padStart(6, '0'), status: 'completed', changes: { [CART]: { type: 'update', move_path: null, unified_diff: '@@ -13,4 +13,4 @@\n   const sum = cart.items.reduce((s, i) => s + i.price * i.qty, 0);\n-  const rounded = Math.round(sum * 100) / 100;\n-  return rounded - rounded * (cart.coupon?.rate ?? 0);\n+  const discounted = sum * (1 - (cart.coupon?.rate ?? 0));\n+  return Math.round(discounted * 100) / 100;\n' } } }, 23)),
  (at(31), cmd('npm test -- cart', '> shop@2.4.0 test\n> vitest run cart\n\n ✓ adds items (3 ms)\n ✓ removes items (1 ms)\n ✓ applies a 10% coupon (2 ms)\n\n Tests  3 passed', 0, 27)), tokens(24800, 21000, 240),
  (at(33), says('The three cart tests pass now.')),
  (at(35), rec('response_item', { type: 'function_call', id: 'fc_1', name: 'request_user_input_async', arguments: JSON.stringify({ questions: [{ title: 'Two coupons at once are not tested. Add a test for that too?' }] }), call_id: 'call_ask_001' })),
  (at(44), rec('response_item', { type: 'function_call_output', call_id: 'call_ask_001', output: 'answered' })),
  (at(44), you('<send_user_message_question_reply>Yes, add it.</send_user_message_question_reply>')),
  (at(46), think('Two coupons: 10% then 5%.\n100.00 should come to 85.50.')),
  (at(51), item({ type: 'FileChange', id: 'call_' + String(++n).padStart(6, '0'), status: 'completed', changes: { [TEST]: { type: 'add', content: "import { total } from '../src/cart.js';\n\ntest('two coupons stack', () => {\n  const cart = { items: [{ price: 100, qty: 1 }], coupons: [0.10, 0.05] };\n  expect(total(cart)).toBe(85.5);\n});\n" } } }, 48)),
  (at(57), cmd('npm test', '> shop@2.4.0 test\n> vitest run\n\n ✓ cart (3 tests)\n ✓ coupons (1 test)\n ✓ checkout (9 tests)\n\n Tests  13 passed', 0, 53)), tokens(27600, 24000, 260),
  (at(60), says('Fixed. The coupon is applied before rounding, and there is a new test for two coupons. All 13 tests pass.', true)),
  ev({ type: 'task_complete', turn_id: 't1' }),
];
const file = path.join(CX, 'sessions', '2026', '10', '12', `rollout-2026-10-12T10-00-00-${ID}.jsonl`); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, lines.join('\n') + '\n');
fs.writeFileSync(path.join(CX, 'session_index.jsonl'), JSON.stringify({ id: ID, thread_name: 'Fix the cart total with a coupon' }) + '\n');

const now = Date.now(), BOARD = [   // the board scene: Codex and Claude Code sessions side by side
  { proj: '_codex', id: ID, title: 'Fix the cart total with a coupon', mtime: now - 4000, state: 'working', tool: '', ageMs: 4000, subActive: 0, subTotal: 0 },
  { proj: '-Users-dev-shop-api', id: 's1', title: 'Fix the slow login on the shop API', mtime: now - 9000, state: 'working', tool: 'Bash', ageMs: 9000, subActive: 3, subTotal: 4 },
  { proj: '_codex', id: 'c2', title: 'Rename the pricing helpers', mtime: now - 30000, state: 'turn', tool: '', ageMs: 30000, subActive: 0, subTotal: 0 },
  { proj: '-Users-dev-billing', id: 's2', title: 'Migrate billing to the new payments SDK', mtime: now - 42000, state: 'blocked', tool: 'Edit', ageMs: 42000, subActive: 0, subTotal: 2 },
  { proj: '-Users-dev-docs', id: 's3', title: 'Write the onboarding docs', mtime: now - 20000, state: 'waiting', tool: 'Agent', ageMs: 20000, subActive: 2, subTotal: 2 },
  { proj: '_codex', id: 'c3', title: 'Upgrade the test runner', mtime: now - 3 * 3600e3, state: 'idle', tool: '', ageMs: 3 * 3600e3, subActive: 0, subTotal: 0 },
];
const PREFS = JSON.stringify({ lang: 'en', voice: false, office: false, music: false, sfx: false, epi: false, vanish: true, view: 'call', langChosen: true, banter: true, roster: true, reactions: false, charPack: 'none' });
const mp4 = (raw, to) => { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', 'fps=30,scale=1280:720,setsar=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-an', to]); return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', to]).toString()); };

(async () => {
  const server = require('../server.js').start(PORT); await new Promise((r) => server.once('listening', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = await browser.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument((p) => { try { localStorage.setItem('cc.prefs', p); } catch {} }, PREFS);
  await page.setRequestInterception(true);
  page.on('request', (req) => { if (/\/api\/board/.test(req.url())) req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(BOARD) }); else req.continue(); });
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const clip = async (name, fn) => {   // one recording: fn gets mark(), the times come back scaled to the real length of the video
    const raw = path.join(tmp, name + '.webm'), to = path.join(tmp, name + '.mp4'), rec = await page.screencast({ path: raw }), t0 = Date.now(), marks = {};
    await fn((k) => { marks[k] = (Date.now() - t0) / 1000; }); const total = (Date.now() - t0) / 1000; await rec.stop();
    const dur = mp4(raw, to), k = dur / total; for (const m in marks) marks[m] *= k; return { file: to, dur, marks };
  };

  // 1. the Codex session as a call, then the board
  await page.goto(`http://localhost:${PORT}/?live=0&pin=${ID}&lang=en`, { waitUntil: 'load' }); await sleep(1800);
  await page.evaluate((v) => { $('#speed').value = v; }, process.env.CODEX_VIDEO_SPEED || '1.75');
  const a = await clip('a', async (mark) => {
    mark('call'); await page.evaluate(() => { run(0); });   // not awaited inside the page: run() only returns when the session is over
    const until = Date.now() + 60000; let shared = false;
    while (Date.now() < until) { const st = await page.evaluate(() => ({ playing: S.playing, idx: S.idx, n: S.events.length, tools: S.events.slice(0, S.idx + 1).some((e) => e.kind === 'tools') })); if (st.tools && !shared) { shared = true; mark('work'); } if (!st.playing && st.idx >= st.n - 1) break; await sleep(200); }
    await page.waitForFunction(() => document.querySelector('#recap').classList.contains('on'), { timeout: 8000 }).catch(() => {});   // the recap opens by itself when a replay ends
    mark('recap'); await sleep(4200); await page.evaluate(() => { document.querySelector('#recap').classList.remove('on'); });
    mark('board'); await page.evaluate(() => setView('board')); await sleep(5200);
  });
  // 2. a few seconds of the built-in fictional team (Claude Code sub-agents)
  await page.goto(`http://localhost:${PORT}/?demo=1&speed=2.4&lang=en`, { waitUntil: 'load' }); await sleep(1500); await page.evaluate(() => setView('call')); await sleep(400);   // the page remembers the board from the scene before
  const b = await clip('b', async (mark) => { mark('team'); await page.evaluate(() => { run(0); }); await sleep(8500); });
  await browser.close(); server.close(); require('../server.js').shutdown();
  if (errors.length) throw new Error('the page reported errors: ' + errors.join(' | '));

  // 3. the banner, then everything in a row with captions and music
  const END = 3.6, t = { call: a.marks.call, work: a.marks.work || a.dur * 0.3, recap: a.marks.recap, board: a.marks.board, team: a.dur + b.marks.team, end: a.dur + b.dur }, total = t.end + END;
  const cap = [
    ['call', 'work', 'My Codex sessions now have a video call'],
    ['work', 'recap', 'Real commands, real output, every edit as a diff'],
    ['recap', 'board', 'A recap at the end - commands, errors, tokens, files'],
    ['board', 'team', 'Codex and Claude Code sessions on one board'],
    ['team', 'end', 'With Claude Code, sub-agents join the call'],
    ['end', null, 'Free and open source · npx @double_geste/agent-standup --open'],
  ];
  const font = '/System/Library/Fonts/Helvetica.ttc', esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '’').replace(/%/g, '\\%');
  const text = cap.map(([from, to, s]) => `drawtext=fontfile=${font}:text='${esc(s)}':fontsize=${s.length > 50 ? 28 : 36}:fontcolor=white:box=1:boxcolor=0x000000B8:boxborderw=16:x=(w-text_w)/2:y=h-86:enable='between(t,${(t[from] + 0.3).toFixed(1)},${(to ? t[to] - 0.2 : total).toFixed(1)})'`).join(',');
  const script = path.join(tmp, 'filter.txt');
  fs.writeFileSync(script, `[2:v]scale=1280:-2,pad=1280:720:0:oh-ih:color=0x121a22,fps=30,setsar=1,format=yuv420p,fade=t=in:st=0:d=0.4[end];[0:v][1:v][end]concat=n=3:v=1:a=0,${text}[out]`);
  const wav = require('./promo-music-upbeat.js')(path.join(tmp, 'music.wav'), total + 0.4, [t.recap, t.board, t.team, t.end].map((x) => x + 0.1));
  fs.mkdirSync(out, { recursive: true }); const dest = path.join(out, 'promo-codex.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a.file, '-i', b.file, '-loop', '1', '-t', String(END), '-i', path.join(out, 'social.jpg'), '-i', wav, '-filter_complex_script', script, '-map', '[out]', '-map', '3:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-af', `loudnorm=I=-15:TP=-1.5:LRA=9,afade=t=out:st=${(total - 2.2).toFixed(1)}:d=2.2`, '-t', total.toFixed(2), '-movflags', '+faststart', dest]);
  console.log('video promo-codex.mp4', total.toFixed(1) + 's', JSON.stringify(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, +v.toFixed(1)]))));
  fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
