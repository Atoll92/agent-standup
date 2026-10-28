// npm run stats — what the project can see about itself: the public counters of the stores and of GitHub (no server, no tracking of people).
//   npm run stats                        today's figures, what moved since you last looked, and the trend day by day
//   node scripts/stats.js --record FILE  adds today's line to the history FILE (one JSON line per day; a second run the same day replaces the line)
//   STATS_NO_RANK=1 skips the VS Code search ranks (about 40 searches), STATS_NO_WEBSITE=1 the website
// The history is the file history.jsonl of the "stats" release on GitHub, beside the counters of the landing page. .github/workflows/stats.yml adds a line every day.
// What each number is worth: Marketplace "installs" are people (installed from inside VS Code); the "downloads" of the Marketplace, of Open VSX and of npm
// are fetches of the package, and every published version brings a burst of automatic ones (mirrors, scanners). Compare days, not totals.
const { execFileSync, execFile } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const repo = 'Atoll92/agent-standup', ext = 'DoubleGeste.agent-standup', pkg = '@double_geste/agent-standup', snap = path.join(os.homedir(), '.agent-standup-stats.json');
const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const soft = async (fn) => { try { return await fn(); } catch { return null; } };   // one source that does not answer leaves a hole in the line, not a failed run
const json = async (url, init) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); };

async function collect() {
  const mp = await soft(async () => {
    const j = await json('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json;api-version=3.0-preview.1' }, body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: ext }] }], flags: 914 }) });
    const s = Object.fromEntries(j.results[0].extensions[0].statistics.map((x) => [x.statisticName, +x.value]));
    return { installs: s.install || 0, downloads: s.downloadCount || 0, updates: s.updateCount || 0, ratings: s.ratingcount || 0 };
  });
  const ovsx = await soft(async () => { const j = await json('https://open-vsx.org/api/' + ext.replace('.', '/')); return { downloads: j.downloadCount || 0, reviews: j.reviewCount || 0 }; });
  const npm = await soft(async () => (await json('https://api.npmjs.org/downloads/point/last-year/' + pkg)).downloads);   // a year back: the whole life of the package for a long while
  const hub = await soft(async () => {
    const r = gh(['api', `repos/${repo}`]), files = { vsix: 0, mac: 0, windows: 0, linux: 0, cli: 0 }, landing = {}, weeks = {}; let active = 0, week = 0;
    for (const rel of gh(['api', `repos/${repo}/releases`, '--paginate'])) for (const a of rel.assets) {
      if (rel.tag_name === 'stats') { if (a.name === 'app-active.gif') active = a.download_count; else if (a.name === 'app-week.gif') week = a.download_count; else if (/^(plugin|cli|desktop)-week\.gif$/.test(a.name)) weeks[a.name.split('-')[0]] = a.download_count; else if (/^pixel-.*\.gif$/.test(a.name)) landing[a.name.slice(6, -4)] = a.download_count; continue; }   // the history file sits there too and is not a counter
      files[/\.vsix$/.test(a.name) ? 'vsix' : /mac/.test(a.name) ? 'mac' : /windows/.test(a.name) ? 'windows' : /linux/.test(a.name) ? 'linux' : 'cli'] += a.download_count;
    }
    return { stars: r.stargazers_count, forks: r.forks_count, files, active, week, weeks, landing };   // week: the VS Code extension; weeks: the plugin, the command line and the desktop app (server.js, usageWeek)
  });
  const yt = await soft(youtube), rank = process.env.STATS_NO_RANK ? null : await soft(ranks);
  return { d: new Date().toISOString().slice(0, 10), mp, ovsx, npm, hub, ...(yt ? { yt } : {}), ...(rank ? { rank } : {}) };
}
// Where the extension comes in VS Code's own search (the Extensions view asks the same gallery, and ranks mostly on the words of the name), for phrases people type.
// 0: not in the first RANK_DEPTH results. RANK_BEFORE: the ranks of 20 October 2026, before the name became "Agent Standup: Claude Code & Codex Agent Monitor" (1.40.0); 0 there: past the 100th.
const RANK_PHRASES = ['agent standup', 'claude code agent monitor', 'claude code monitor', 'claude code dashboard', 'claude code subagents', 'claude code agents', 'claude code sessions', 'claude code usage', 'agent monitor', 'agent dashboard', 'subagents', 'sub-agents', 'codex monitor', 'mistral vibe', 'standup', 'codex', 'claude code'], RANK_DEPTH = 500;
const RANK_BEFORE = { 'agent standup': 1, 'claude code monitor': 179, 'claude code dashboard': 0, 'claude code subagents': 44, 'claude code agents': 0, 'claude code sessions': 0, 'claude code usage': 0, 'agent monitor': 17, 'agent dashboard': 13, subagents: 40, 'sub-agents': 5, 'mistral vibe': 3, standup: 2, codex: 0, 'claude code': 0 };
async function ranks() {
  const page = async (q, n) => (((await json('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json;api-version=3.0-preview.1' }, body: JSON.stringify({ filters: [{ criteria: [{ filterType: 8, value: 'Microsoft.VisualStudio.Code' }, { filterType: 10, value: q }, { filterType: 12, value: '4096' }], pageNumber: n, pageSize: 100, sortBy: 0, sortOrder: 0 }], flags: 0x200 | 0x100 | 0x2 }) })).results[0] || {}).extensions || []);
  const one = async (q) => { for (let n = 1, seen = 0; seen < RANK_DEPTH; n++) { const ex = await page(q, n), i = ex.findIndex((e) => e.publisher.publisherName + '.' + e.extensionName === ext); if (i >= 0) return seen + i + 1; if (ex.length < 100) break; seen += ex.length; } return 0; };
  const out = {}; let k = 0; await Promise.all(Array.from({ length: 4 }, async () => { while (k < RANK_PHRASES.length) { const q = RANK_PHRASES[k++]; out[q] = await one(q); } }));   // four searches at a time
  return Object.fromEntries(RANK_PHRASES.map((q) => [q, out[q]]));
}
function printRanks(now, was, hist) {
  const r = (n) => (n ? '#' + n : '>' + RANK_DEPTH), first = hist.find((x) => x.rank && x.d < new Date().toISOString().slice(0, 10));   // the first day the daily job recorded them
  console.log(`\nVS Code search rank (the Extensions view; lower is better; >${RANK_DEPTH}: not in the first ${RANK_DEPTH}):`);
  console.log('  ' + 'search'.padEnd(28) + 'now'.padEnd(8) + 'since you looked'.padEnd(18) + (first ? ('on ' + first.d.slice(5)).padEnd(10) : '') + 'before the rename (10-20)');
  for (const q of RANK_PHRASES) { const n = now[q], p = was && was[q], b = RANK_BEFORE[q], moved = typeof p === 'number' && p !== n ? (p && n ? (n < p ? '▲ ' : '▼ ') + Math.abs(p - n) : r(p) + ' → ' + r(n)) : '';
    console.log('  ' + q.padEnd(28) + r(n).padEnd(8) + moved.padEnd(18) + (first ? (first.rank[q] == null ? '-' : r(first.rank[q])).padEnd(10) : '') + (b == null ? '-' : b ? '#' + b : '>100')); }
}
// The YouTube channel's public counts: subscribers, and the views of each video and Short, read from the channel's own pages (the consent cookie skips the EU consent page)
async function youtube() {
  const get = async (tab) => { const r = await fetch('https://www.youtube.com/@Agent_Standup/' + tab, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'accept-language': 'en-US,en;q=0.9', cookie: 'SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg; CONSENT=YES+cb' }, signal: AbortSignal.timeout(20000) }); const m = (await r.text()).match(/var ytInitialData = (\{.*?\});<\/script>/s); return m ? JSON.parse(m[1]) : null; };
  const num = (t) => { const m = /([\d.,]+)\s*([KM])?/.exec(String(t || '')); return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * (m[2] === 'K' ? 1e3 : m[2] === 'M' ? 1e6 : 1)) : 0; };
  const videos = [], walk = (o, short) => { if (!o || typeof o !== 'object') return;
    if (o.lockupViewModel) { const t = o.lockupViewModel.metadata && o.lockupViewModel.metadata.lockupMetadataViewModel, parts = JSON.stringify((t && t.metadata) || {}).match(/"content":"([^"]*)"/g) || []; if (t) videos.push({ title: t.title && t.title.content, views: num((parts[0] || '').slice(11, -1)) }); }
    if (o.videoRenderer && o.videoRenderer.title) { const v = o.videoRenderer, t = (v.title.runs && v.title.runs[0] && v.title.runs[0].text) || v.title.simpleText; if (t) videos.push({ title: t, views: num((v.viewCountText && (v.viewCountText.simpleText || (v.viewCountText.runs || []).map((x) => x.text).join(''))) || '') }); }   /* the older layout of the videos page, still served at times */
    if (o.shortsLockupViewModel) { const m = o.shortsLockupViewModel.overlayMetadata || {}; videos.push({ title: m.primaryText && m.primaryText.content, views: num(m.secondaryText && m.secondaryText.content), short: 1 }); }
    for (const k in o) walk(o[k], short); };
  const v = await get('videos'), sh = await get('shorts'); if (!v && !sh) return null; walk(v); walk(sh);
  const subs = /"(\d[\d.,]*[KM]?) subscribers?"/.exec(JSON.stringify(v || sh)); return { subs: subs ? num(subs[1]) : null, views: videos.reduce((n, x) => n + x.views, 0), videos };
}
// The website, from Vercel Web Analytics through the Vercel command line (needs `npx vercel login` on this computer; the daily job on GitHub has no login and skips it).
// Per UTC day: page views, the visitors who saw a home page (any language), how many of them saw only that one page (bounce: Vercel's visitor id lasts a day),
// and the clicks on the install buttons (counted since WEB_CLICKS_SINCE). The days of WEB_MARKS split the summary, to compare a change of the home page with what came before.
const WEB_SINCE = '2026-10-13', WEB_CLICKS_SINCE = '2026-10-17', WEB_MARKS = { '2026-10-17': 'new hero "Stop checking on your agents."', '2026-10-19': 'hero: the "Stop babysitting" video' };
const INSTALL_CLICKS = /^(Install VS Code|Install Open VSX|Download|Copy command)$/, HOME = /^\/([a-z]{2}(-[a-z]{2,4})?\/?)?$/i;
async function website() {
  const run = (metric, ...a) => new Promise((ok, no) => execFile('npx', ['-y', 'vercel@latest', 'metrics', metric, '--scope', 'dg-team-fe3d9cf0', '-p', 'agent-standup', '--prod', '--json', ...a], { encoding: 'utf8', timeout: 180000, maxBuffer: 64e6 }, (err, out) => {
    try { const x = JSON.parse(String(out).slice(String(out).indexOf('{'))); if (x.error) throw new Error(x.error.message); ok(x); } catch (e) { no(err || e); } }));
  const PV = 'vercel.analytics.page_view.count', EV = 'vercel.analytics.event.count', num = (r) => Object.values(r).find((v) => typeof v === 'number') || 0;
  const pool = async (jobs, n = 4) => { const out = []; let k = 0; await Promise.all(Array.from({ length: n }, async () => { while (k < jobs.length) { const m = k++; out[m] = await jobs[m](); } })); return out; };
  const nDays = +process.env.STATS_WEB_DAYS || 14, today = Date.now(), days = Array.from({ length: nDays }, (_, x) => new Date(today - (nDays - 1 - x) * 864e5).toISOString().slice(0, 10)).filter((d) => d >= WEB_SINCE);
  const next = (d) => new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10), since = days[0] + 'T00:00:00Z';
  const homeDay = async (d) => { const x = await run(PV, '--since', d + 'T00:00:00Z', '--until', next(d) + 'T00:00:00Z', '-g', '1d', '--group-by', 'visitorId', '--group-by', 'requestPath', '-l', '500'), rows = (x.data || []).filter((r) => r.timestamp.startsWith(d) && num(r) > 0), V = {};
    for (const r of rows) { const v = (V[r.visitorId] = V[r.visitorId] || { n: 0, home: false }); v.n += num(r); if (HOME.test(r.requestPath || '')) v.home = true; }
    const h = Object.values(V).filter((v) => v.home); return { d, views: rows.reduce((t, r) => t + num(r), 0), home: h.length, one: h.filter((v) => v.n === 1).length, capped: (x.data || []).length >= 500 }; };
  const top = async (dim) => { const x = await run(PV, '--since', '3d', '--group-by', dim, '-l', '6'), by = {}; for (const r of x.data || []) by[r[dim] || '(direct)'] = (by[r[dim] || '(direct)'] || 0) + num(r); return Object.entries(by).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 6); };
  const [perDay, sources, countries, evDay, evAll] = await Promise.all([pool(days.map((d) => () => homeDay(d))), top('referrerHostname'), top('country'),
    run(EV, '--since', since, '-g', '1d', '--group-by', 'eventName', '-l', '50').catch(() => ({ data: [] })), run(EV, '--since', '7d', '--group-by', 'eventName', '--group-by', 'eventData', '-l', '200').catch(() => ({ data: [] }))]);
  const clicks = {}; for (const r of evDay.data || []) if (INSTALL_CLICKS.test(r.eventName || '')) clicks[r.timestamp.slice(0, 10)] = (clicks[r.timestamp.slice(0, 10)] || 0) + num(r);
  const ev = {}; for (const r of evAll.data || []) { if (!r.eventName || !num(r)) continue; let dt = r.eventData; const key = typeof dt === 'string' && !/^\s*\{/.test(dt) ? dt : null; if (key && key !== 'where') continue; if (key) dt = {}; else try { if (typeof dt === 'string') dt = JSON.parse(dt); } catch { dt = {}; } const e = (ev[r.eventName] = ev[r.eventName] || { n: 0, where: {}, what: {} }); e.n += num(r); if (dt && dt.where) e.where[dt.where] = (e.where[dt.where] || 0) + num(r); if (dt && dt.what) e.what[dt.what] = (e.what[dt.what] || 0) + num(r); }
  return { perDay: perDay.map((x) => ({ ...x, clicks: x.d >= WEB_CLICKS_SINCE ? clicks[x.d] || 0 : null })), sources, countries, events: Object.entries(ev).sort((a, b) => b[1].n - a[1].n) };
}
function printWebsite(w) {
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–'), per100 = (a, b) => (a == null || !b ? '–' : ((100 * a) / b).toFixed(1));
  console.log('\nWebsite agent-standup.com (Vercel Web Analytics; UTC days; bounce = home visitors who saw only that page; install clicks = Install VS Code, Install Open VSX, Download, Copy command):');
  console.log('  day     views   home visitors   bounce   install clicks   per 100 home visitors');
  for (const x of w.perDay) console.log('  ' + x.d.slice(5) + String(x.views).padStart(8) + String(x.home + (x.capped ? '+' : '')).padStart(16) + pct(x.one, x.home).padStart(9) + String(x.clicks == null ? '–' : x.clicks).padStart(17) + per100(x.clicks, x.home).padStart(24) + (WEB_MARKS[x.d] ? '   ← ' + WEB_MARKS[x.d] : ''));
  const cuts = Object.keys(WEB_MARKS).sort(), periods = []; let from = w.perDay.length ? w.perDay[0].d : '';
  for (const c of cuts.concat('9999')) { const p = w.perDay.filter((x) => x.d >= from && x.d < c); if (p.length) periods.push(p); from = c; }
  if (periods.length > 1) for (const p of periods) { const home = p.reduce((t, x) => t + x.home, 0), one = p.reduce((t, x) => t + x.one, 0), c = p.filter((x) => x.clicks != null), cl = c.reduce((t, x) => t + x.clicks, 0), ch = c.reduce((t, x) => t + x.home, 0);
    console.log('  ' + p[0].d.slice(5) + ' to ' + p[p.length - 1].d.slice(5) + ' (' + p.length + ' day' + (p.length > 1 ? 's' : '') + (WEB_MARKS[p[0].d] ? ', ' + WEB_MARKS[p[0].d] : '') + '): ' + Math.round(home / p.length) + ' home visitors a day, bounce ' + pct(one, home) + (c.length ? ', ' + per100(cl, ch) + ' install clicks per 100 home visitors' : '')); }
  console.log('  last 3 days, by source: ' + w.sources.map(([k, n]) => k + ' ' + n).join(', ') + '\n  last 3 days, by country: ' + w.countries.map(([k, n]) => k + ' ' + n).join(', '));
  const top3 = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => k + ' ' + n).join(', ');
  console.log('  clicks, last 7 days' + (w.events.length ? ':\n' + w.events.map(([k, e]) => '    ' + k.padEnd(18) + String(e.n).padStart(5) + (Object.keys(e.where).length ? '   where: ' + top3(e.where) : '') + (Object.keys(e.what).length ? '   · ' + top3(e.what) : '')).join('\n') : ': none yet (counted since ' + WEB_CLICKS_SINCE + ')'));
}
const flat = (x) => ({ 'Marketplace installs': x.mp && x.mp.installs, 'Marketplace downloads': x.mp && x.mp.downloads, 'Marketplace updates': x.mp && x.mp.updates, 'Marketplace ratings': x.mp && x.mp.ratings,
  'Open VSX downloads': x.ovsx && x.ovsx.downloads, 'Open VSX reviews': x.ovsx && x.ovsx.reviews, 'npm downloads': x.npm, 'GitHub stars': x.hub && x.hub.stars, 'GitHub forks': x.hub && x.hub.forks,
  'GitHub: extension files': x.hub && x.hub.files && x.hub.files.vsix, 'GitHub: desktop app (Mac / Windows / Linux)': x.hub && x.hub.files && [x.hub.files.mac, x.hub.files.windows, x.hub.files.linux].join(' / '), 'GitHub: command line file': x.hub && x.hub.files && x.hub.files.cli,
  'Opt-in active installs (1 request a day each)': x.hub && x.hub.active, 'Opt-in people who opened the call (1 request a week each)': x.hub && x.hub.week, 'the same from the plugin / command line / desktop app': x.hub && x.hub.weeks ? ['plugin', 'cli', 'desktop'].map((k) => x.hub.weeks[k] || 0).join(' / ') : null, 'YouTube subscribers': x.yt && x.yt.subs, 'YouTube views (all videos)': x.yt && x.yt.views });
const lines = (text) => text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && x.d);

(async () => {
  const at = process.argv.indexOf('--record');
  if (at >= 0) {   // one line per day, the days in order
    const file = process.argv[at + 1]; if (!file) { console.error('--record needs a file'); process.exit(2); }
    const now = await collect(), all = (fs.existsSync(file) ? lines(fs.readFileSync(file, 'utf8')) : []).filter((x) => x.d !== now.d).concat(now).sort((a, b) => (a.d < b.d ? -1 : 1));
    if (!now.mp && !now.ovsx && !now.hub) { console.error('nothing answered: the history is left as it is'); process.exit(1); }
    fs.writeFileSync(file, all.map((x) => JSON.stringify(x)).join('\n') + '\n'); console.log(`recorded ${now.d} (${all.length} days in ${file})`); return;
  }
  const now = await collect(), f = flat(now), prev = fs.existsSync(snap) ? JSON.parse(fs.readFileSync(snap, 'utf8')) : {}, was = prev.f || null;   // (a snapshot written before this version has no `f`: no "since" the first time)
  console.log(was ? `Now, and what moved since ${prev.at}:\n` : 'Now:\n');
  for (const [k, v] of Object.entries(f)) { const p = was && was[k], dlt = typeof v === 'number' && typeof p === 'number' && v !== p ? `  (${v > p ? '+' : ''}${v - p})` : ''; console.log('  ' + k.padEnd(46), v == null ? 'no answer' : v, dlt); }
  if (now.hub) console.log('  ' + 'Landing visits by source'.padEnd(46), Object.entries(now.hub.landing).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'none', '\n  (the "direct" counter also counts robots)');
  const traffic = (p) => { try { return gh(['api', `repos/${repo}/traffic/${p}`]); } catch { return null; } }, v = traffic('views'), c = traffic('clones'), ref = traffic('popular/referrers');
  if (v) console.log('\nRepository, last 14 days:', v.count, 'views by', v.uniques, 'people;', c ? `${c.count} clones by ${c.uniques}` : '', ref && ref.length ? '\n  from: ' + ref.map((r) => `${r.referrer} ${r.uniques}`).join(', ') : '');
  let hist = process.env.STATS_HISTORY ? fs.readFileSync(process.env.STATS_HISTORY, 'utf8') : ''; if (!hist) try { hist = execFileSync('gh', ['release', 'download', 'stats', '--repo', repo, '-p', 'history.jsonl', '-O', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
  const days = lines(hist).filter((x) => x.d !== now.d).concat(now).slice(-21), col = [['Marketplace installs', (x) => x.mp && x.mp.installs], ['Open VSX dl', (x) => x.ovsx && x.ovsx.downloads], ['npm dl', (x) => x.npm], ['GitHub files', (x) => x.hub && x.hub.files && x.hub.files.vsix + x.hub.files.mac + x.hub.files.windows + x.hub.files.linux + x.hub.files.cli], ['stars', (x) => x.hub && x.hub.stars]];
  console.log(`\nDay by day (${days.length} day${days.length > 1 ? 's' : ''}; the change from the day before in brackets):\n`); console.log('  ' + 'day'.padEnd(12) + col.map(([n]) => n.padEnd(24)).join(''));
  days.forEach((x, i) => console.log('  ' + x.d.padEnd(12) + col.map(([, get]) => { const a = get(x), b = i ? get(days[i - 1]) : null; return (a == null ? '-' : a + (typeof b === 'number' && typeof a === 'number' ? ` (${a >= b ? '+' : ''}${a - b})` : '')).padEnd(24); }).join('') + (x.note ? ' ' + x.note : '')));
  // The number to follow: how many people opened the call, week by week (only those who said yes to "share usage"). A week runs from Monday (UTC); the daily job reads the counter early
  // in the morning, so the first hours of a Monday are counted in the week before.
  const monday = (d) => { const t = Date.parse(d + 'T00:00:00Z'); return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); }, wk = [];
  // Each kind has its counter (VS Code since 1.34, the plugin, the command line and the desktop app since 1.39): a week is the last count of the week minus the last count of the week before;
  // a counter's first week counts from zero, since each started at zero.
  const KINDS = [['VS Code', (x) => x.hub && x.hub.week], ['plugin', (x) => x.hub && x.hub.weeks && x.hub.weeks.plugin], ['command line', (x) => x.hub && x.hub.weeks && x.hub.weeks.cli], ['desktop app', (x) => x.hub && x.hub.weeks && x.hub.weeks.desktop]], byWeek = {};
  for (const [name, get] of KINDS) { const kw = []; for (const x of lines(hist).filter((x) => x.d !== now.d).concat(now)) { const n = get(x); if (typeof n !== 'number') continue; const m = monday(x.d), w = kw[kw.length - 1]; if (w && w.m === m) w.n = n; else kw.push({ m, n, from: w ? w.n : 0 }); }
    for (const w of kw) (byWeek[w.m] = byWeek[w.m] || {})[name] = w.n - w.from; }
  for (const m of Object.keys(byWeek).sort()) wk.push({ m, by: byWeek[m], n: Object.values(byWeek[m]).reduce((t, v) => t + v, 0) });
  if (wk.length) console.log('\nPeople who opened the call, week by week (opt-in):\n' + wk.map((w, i) => `  week of ${w.m}  ${w.n}${i === wk.length - 1 ? ' so far' : ''}  (${Object.entries(w.by).filter(([, v]) => v).map(([k, v]) => k + ' ' + v).join(', ') || 'none'})`).join('\n'));
  if (days.length < 3) console.log('\n  The daily job on GitHub adds one line a day: the trend is worth reading after a week or two.');
  if (now.rank) printRanks(now.rank, prev.r || null, lines(hist));
  if (now.yt && now.yt.videos.length) console.log('\nYouTube (public counts):\n' + now.yt.videos.map((x) => '  ' + String(x.views).padStart(6) + '  ' + (x.short ? '[Short] ' : '') + x.title).join('\n'));
  if (!process.env.STATS_NO_WEBSITE) { try { printWebsite(await website()); } catch { console.log('\nWebsite: not read (the Vercel command line needs `npx vercel login` on this computer)'); } }
  console.log('\nThe funnel of the Marketplace page (views, then installs, per day) is only in your publisher account: https://marketplace.visualstudio.com/manage (Acquisition tab).');
  fs.writeFileSync(snap, JSON.stringify({ at: new Date().toISOString().slice(0, 16).replace('T', ' '), f, ...(now.rank ? { r: now.rank } : prev.r ? { r: prev.r } : {}) }));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
