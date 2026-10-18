// What the project can see about itself, read live for the growth dashboard (api/stats.js): the same public counters as `npm run stats` (scripts/stats.js),
// read with fetch instead of the gh and vercel command lines. Nothing is kept here; nothing about a person is read.
// The opt-in counters of the "stats" release (app-active.gif, app-week.gif, pixel-*.gif) are only read as GitHub's download counts: fetching one would count a visit.
// Settings of the host (never in the repository):
//   VERCEL_TOKEN   optional: a Vercel access token of the DG_TEAM team, to read the website's visits and clicks (Web Analytics). Without it that part says so.
//   GITHUB_TOKEN   optional: raises GitHub's limit of 60 requests an hour; the dashboard makes two a load and keeps the answer 5 minutes.
const REPO = 'Atoll92/agent-standup', EXT = 'DoubleGeste.agent-standup', PKG = '@double_geste/agent-standup';
const TEAM = process.env.VERCEL_TEAM || 'team_jz9SDQBcNGP3p0ylwU1PcxNN', PROJECT = process.env.VERCEL_PROJECT || 'prj_gi6WoJ9EOm5BOdnoZkhh9hxURRVe';
// The website's numbers start when Vercel Web Analytics did; clicks are counted since WEB_CLICKS_SINCE. A day of WEB_MARKS splits the summary (to compare a change of the home page).
const WEB_SINCE = '2026-10-13', WEB_CLICKS_SINCE = '2026-10-17', WEB_MARKS = { '2026-10-17': 'new hero "Stop checking on your agents."' };
const INSTALL_CLICKS = /^(Install VS Code|Install Open VSX|Download|Copy command)$/, HOME = /^\/([a-z]{2}(-[a-z]{2,4})?\/?)?$/i;

const json = async (url, init = {}) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) }); if (!r.ok) { const e = new Error(url.split('?')[0] + ' ' + r.status); e.status = r.status; throw e; } return r.json(); };
const soft = async (fn) => { try { return await fn(); } catch (e) { console.error('growth:', e.message); return null; } };   // one source that does not answer leaves a hole, not a failed page
const ghHeaders = () => ({ accept: 'application/vnd.github+json', 'user-agent': 'agent-standup-stats', ...(process.env.GITHUB_TOKEN ? { authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}) });
const lines = (t) => String(t || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const day = (t) => new Date(t).toISOString().slice(0, 10), next = (d) => day(Date.parse(d) + 864e5);
const pool = async (jobs, n) => { const out = []; let k = 0; await Promise.all(Array.from({ length: n }, async () => { while (k < jobs.length) { const m = k++; out[m] = await jobs[m](); } })); return out; };

async function marketplace() {
  const j = await json('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json;api-version=3.0-preview.1' }, body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: EXT }] }], flags: 914 }) });
  const e = j.results[0].extensions[0], s = Object.fromEntries(e.statistics.map((x) => [x.statisticName, +x.value]));
  return { installs: s.install || 0, downloads: s.downloadCount || 0, updates: s.updateCount || 0, ratings: s.ratingcount || 0, rating: s.averagerating || 0, version: (e.versions && e.versions[0] && e.versions[0].version) || '' };
}
async function openVsx() { const j = await json('https://open-vsx.org/api/' + EXT.replace('.', '/')); return { downloads: j.downloadCount || 0, reviews: j.reviewCount || 0, rating: j.averageRating || 0, version: j.version || '' }; }
async function npm() {
  const [total, month] = await Promise.all([json('https://api.npmjs.org/downloads/point/last-year/' + PKG), json('https://api.npmjs.org/downloads/range/last-month/' + PKG)]);
  return { total: total.downloads, days: (month.downloads || []).map((x) => [x.day, x.downloads]) };
}
// The repository, the files of every release, the opt-in counters, and the history file the daily job writes (.github/workflows/stats.yml)
async function github() {
  const [r, rels] = await Promise.all([json('https://api.github.com/repos/' + REPO, { headers: ghHeaders() }), json('https://api.github.com/repos/' + REPO + '/releases?per_page=100', { headers: ghHeaders() })]);
  const files = { vsix: 0, mac: 0, windows: 0, linux: 0, cli: 0 }, landing = {}; let active = 0, week = 0, hist = '';
  for (const rel of rels) for (const a of rel.assets) {
    if (rel.tag_name === 'stats') { if (a.name === 'app-active.gif') active = a.download_count; else if (a.name === 'app-week.gif') week = a.download_count; else if (/^pixel-.*\.gif$/.test(a.name)) landing[a.name.slice(6, -4)] = a.download_count; else if (a.name === 'history.jsonl') hist = a.browser_download_url; continue; }
    files[/\.vsix$/.test(a.name) ? 'vsix' : /mac/.test(a.name) ? 'mac' : /windows/.test(a.name) ? 'windows' : /linux/.test(a.name) ? 'linux' : 'cli'] += a.download_count;
  }
  const history = hist ? await soft(async () => { const t = await fetch(hist, { signal: AbortSignal.timeout(15000) }); if (!t.ok) throw new Error('history ' + t.status); return lines(await t.text()); }) : null;
  return { stars: r.stargazers_count, forks: r.forks_count, issues: r.open_issues_count, files, active, week, landing, history: history || [] };
}
// The channel's public counts, read from its own pages (the consent cookie skips the EU consent page)
async function youtube() {
  const get = async (tab) => { const r = await fetch('https://www.youtube.com/@Agent_Standup/' + tab, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'accept-language': 'en-US,en;q=0.9', cookie: 'SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg; CONSENT=YES+cb' }, signal: AbortSignal.timeout(15000) }); const m = (await r.text()).match(/var ytInitialData = (\{.*?\});<\/script>/s); return m ? JSON.parse(m[1]) : null; };
  const num = (t) => { const m = /([\d.,]+)\s*([KM])?/.exec(String(t || '')); return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * (m[2] === 'K' ? 1e3 : m[2] === 'M' ? 1e6 : 1)) : 0; };
  const videos = [], walk = (o) => { if (!o || typeof o !== 'object') return;
    if (o.lockupViewModel) { const t = o.lockupViewModel.metadata && o.lockupViewModel.metadata.lockupMetadataViewModel, parts = JSON.stringify((t && t.metadata) || {}).match(/"content":"([^"]*)"/g) || []; if (t) videos.push({ title: t.title && t.title.content, views: num((parts[0] || '').slice(11, -1)) }); }
    if (o.videoRenderer && o.videoRenderer.title) { const v = o.videoRenderer, t = (v.title.runs && v.title.runs[0] && v.title.runs[0].text) || v.title.simpleText; if (t) videos.push({ title: t, views: num((v.viewCountText && (v.viewCountText.simpleText || (v.viewCountText.runs || []).map((x) => x.text).join(''))) || '') }); }   /* the older layout of the videos page, still served at times */
    if (o.shortsLockupViewModel) { const m = o.shortsLockupViewModel.overlayMetadata || {}; videos.push({ title: m.primaryText && m.primaryText.content, views: num(m.secondaryText && m.secondaryText.content), short: true }); }
    for (const k in o) walk(o[k]); };
  const [v, sh] = await Promise.all([get('videos'), get('shorts')]); if (!v && !sh) throw new Error('youtube: no page data'); walk(v); walk(sh);
  const subs = /"(\d[\d.,]*[KM]?) subscribers?"/.exec(JSON.stringify(v || sh)); return { subs: subs ? num(subs[1]) : null, views: videos.reduce((n, x) => n + x.views, 0), videos };
}
// The website, from Vercel Web Analytics (the API the `vercel metrics` command uses). Per UTC day: page views, the visitors who saw a home page (any language), how many of them
// saw only that page (bounce: Vercel's visitor id lasts a day), and the clicks on the install buttons. Then the clicks by button, the sources and the countries.
async function website() {
  const token = process.env.VERCEL_TOKEN; if (!token) return { missing: 'VERCEL_TOKEN' };
  const q = async (metric, start, end, extra = {}) => { const x = await json('https://api.vercel.com/metrics/v1?teamId=' + TEAM, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ scope: { ownerId: TEAM, projectIds: [PROJECT] }, timeRange: { start: start + 'T00:00:00.000Z', end: end + 'T00:00:00.000Z' }, bucketSeconds: 86400, filter: 'environment:production', metrics: { value: { metric, aggregation: 'count' } }, outputs: ['value'], ...extra }) });
    return (x.series || []).filter((s) => s.values && s.values.value > 0); };
  const group = (dims, limit) => ({ groupBy: dims, seriesSelection: { limit, mode: 'exact', rankBy: [{ metric: 'value', direction: 'desc' }] } });
  const PV = 'vercel.analytics.page_view.count', EV = 'vercel.analytics.event.count', today = day(Date.now()), tomorrow = next(today), days = [];
  for (let d = day(Date.now() - 13 * 864e5); d <= today; d = next(d)) if (d >= WEB_SINCE) days.push(d);
  const homeDay = async (d) => { const rows = await q(PV, d, next(d), group(['visitorId', 'requestPath'], 500)), V = {};
    for (const r of rows) { const v = (V[r.dimensions.visitorId] = V[r.dimensions.visitorId] || { n: 0, home: false }); v.n += r.values.value; if (HOME.test(r.dimensions.requestPath || '')) v.home = true; }
    const h = Object.values(V).filter((v) => v.home); return { d, views: rows.reduce((t, r) => t + r.values.value, 0), home: h.length, one: h.filter((v) => v.n === 1).length, capped: rows.length >= 500 }; };
  const three = day(Date.now() - 2 * 864e5), week = day(Date.now() - 6 * 864e5);
  const [perDay, evDay, evAll, src, ctry] = await Promise.all([pool(days.map((d) => () => homeDay(d)), 5), q(EV, days[0], tomorrow, group(['eventName'], 50)), q(EV, week, tomorrow, group(['eventName', 'eventData'], 200)), q(PV, three, tomorrow, group(['referrerHostname'], 20)), q(PV, three, tomorrow, group(['country'], 20))]);
  const clicks = {}; for (const r of evDay) if (INSTALL_CLICKS.test(r.dimensions.eventName || '')) clicks[r.timestamp.slice(0, 10)] = (clicks[r.timestamp.slice(0, 10)] || 0) + r.values.value;
  const ev = {}; for (const r of evAll) { let dt = r.dimensions.eventData; try { if (typeof dt === 'string') dt = JSON.parse(dt); } catch { dt = {}; } const e = (ev[r.dimensions.eventName] = ev[r.dimensions.eventName] || { n: 0, where: {}, what: {} }); e.n += r.values.value; if (dt && dt.where) e.where[dt.where] = (e.where[dt.where] || 0) + r.values.value; if (dt && dt.what) e.what[dt.what] = (e.what[dt.what] || 0) + r.values.value; }
  const sum = (rows, dim) => { const by = {}; for (const r of rows) { const k = r.dimensions[dim] || '(direct)'; by[k] = (by[k] || 0) + r.values.value; } return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8); };
  return { perDay: perDay.map((x) => ({ ...x, clicks: x.d >= WEB_CLICKS_SINCE ? clicks[x.d] || 0 : null })), marks: WEB_MARKS, clicksSince: WEB_CLICKS_SINCE, events: Object.entries(ev).sort((a, b) => b[1].n - a[1].n), sources: sum(src, 'referrerHostname'), countries: sum(ctry, 'country') };
}

async function growth() {
  const [mp, ovsx, np, hub, yt, web] = await Promise.all([soft(marketplace), soft(openVsx), soft(npm), soft(github), soft(youtube), soft(website)]);
  return { at: Date.now(), mp, ovsx, npm: np, hub, yt, web: web || { error: true } };
}
module.exports = { growth };
