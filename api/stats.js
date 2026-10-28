// The growth of the project, live, for Double Geste only: everything `npm run stats` shows, on one page.   GET /api/stats/?k=<key>
// The page asks this function every 5 minutes; the function reads the public counters (api/_growth.js) and keeps the answer 5 minutes, so GitHub's hourly limit is never reached.
// Settings of the host (never in the repository):
//   STATS_KEY      the long random word in the page's address (16 characters or more), not the one of the sales page; without it the page does not exist (404), and a wrong word gets the same 404
//   VERCEL_TOKEN   optional, read by api/_growth.js: the website's visits and clicks
// It also shows the totals of the pack sales when the sales page can read Stripe (api/sales.js).
const crypto = require('crypto'), { growth } = require('./_growth.js');
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
let memo = null;   // { at, data }: one answer for 5 minutes, shared by the loads that reach this instance

async function sales() {
  const { rows } = require('./sales.js'), d = await rows(), live = d.rows.filter((r) => r.refunded < r.amount && !r.disputed);
  const left = (r) => (r.net != null ? r.net : r.amount) - r.refunded - (r.disputed ? r.amount - r.refunded : 0);
  return { sold: live.length, net: d.rows.reduce((s, r) => s + left(r), 0), fees: d.fees, live: d.live };
}

module.exports = async function stats(req, res) {
  const u = new URL(req.url, 'http://x'), want = process.env.STATS_KEY || '', k = u.searchParams.get('k') || '';
  res.setHeader('cache-control', 'no-store'); res.setHeader('x-robots-tag', 'noindex, nofollow'); res.setHeader('referrer-policy', 'no-referrer');
  if (req.method !== 'GET' || want.length < 16 || !crypto.timingSafeEqual(hash(k), hash(want))) { res.statusCode = 404; res.setHeader('content-type', 'text/plain'); return res.end('Not found'); }
  if (u.searchParams.has('json')) {
    try {
      if (!memo || Date.now() - memo.at > 5 * 60e3 || u.searchParams.has('fresh')) { const [g, s] = await Promise.all([growth(), sales().catch(() => null)]); memo = { at: Date.now(), data: { ...g, sales: s } }; }
      res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(memo.data));
    } catch (e) { console.error('stats:', e.message); res.statusCode = 502; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ error: 'read' })); }
  }
  res.statusCode = 200; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE);
};

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<title>Growth · Agent Standup</title>
<link rel="icon" href="/brand/favicon.svg">
<style>
  @font-face { font-family: Gabarito; src: url(/fonts/gabarito.woff2) format('woff2'); font-weight: 400 900; font-display: swap }
  @font-face { font-family: Figtree; src: url(/fonts/figtree.woff2) format('woff2'); font-weight: 300 900; font-display: swap }
  :root { --night:#0b1418; --night2:#10222a; --card:#132a30; --line:#2a4a52; --grid:rgba(168,195,200,.14); --ink:#f6f2ea; --dim:#a8c3c8; --mute:#7f9da3; --bar:#cc7a24; --bar-now:rgba(204,122,36,.45); --gold:#f5c04a; --green:#7fd1a4; --peach:#e8845f }
  * { box-sizing:border-box }
  html { -webkit-text-size-adjust:100%; background:var(--night) }
  body { margin:0; min-height:100vh; color:var(--ink); font:400 15px/1.5 Figtree, system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing:antialiased; overflow-x:hidden;
    background: radial-gradient(circle at 90% 4%, rgba(245,192,74,.14), transparent 30%), linear-gradient(180deg, var(--night2), var(--night) 60%) fixed }
  main { max-width:1100px; margin:0 auto; padding:24px 16px 56px }
  header { display:flex; align-items:center; gap:10px; font:700 18px Gabarito, sans-serif }
  header img { border-radius:8px }
  h1 { font:800 clamp(28px, 6vw, 40px)/1.1 Gabarito, sans-serif; margin:22px 0 4px } h1 span { color:var(--gold) }
  h2 { font:700 20px/1.2 Gabarito, sans-serif; margin:34px 0 4px } h2 + .note { margin-top:0 }
  .sub { color:var(--dim); margin:0 0 18px }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--green); margin-right:6px; vertical-align:1px; animation:pulse 2s ease-in-out infinite } .dot.off { background:var(--peach); animation:none }
  @keyframes pulse { 50% { opacity:.35 } }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:10px }
  .tile { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px 14px }
  .tile small { color:var(--dim); font-size:13px } .tile b { display:block; font:800 28px/1.15 Gabarito, sans-serif; font-variant-numeric:tabular-nums; margin-top:2px } .tile i { display:block; font-style:normal; color:var(--mute); font-size:12px }
  .tile.key { border-color:rgba(245,192,74,.5) } .tile.key b { color:var(--gold) }
  .note { color:var(--dim); font-size:13px; margin:6px 0 12px } .note.warn { color:var(--peach) }
  .charts { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:10px }
  .chart { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px 14px 10px; min-width:0 }
  .chart h3 { font:600 14px Figtree, sans-serif; margin:0 } .chart .hd { display:flex; align-items:baseline; gap:8px } .chart .hd em { margin-left:auto; font-style:normal; color:var(--dim); font-size:12px; white-space:nowrap }
  .chart .why { color:var(--mute); font-size:12px; margin:1px 0 6px }
  .chart svg { display:block; width:100%; height:auto; overflow:visible } .chart svg text { fill:var(--mute); font:11px Figtree, sans-serif; font-variant-numeric:tabular-nums }
  .chart .b { fill:var(--bar); pointer-events:none } .chart .b.now { fill:var(--bar-now) } .chart .hit { fill:transparent; cursor:default } .chart .hit:hover + .b, .chart .b.on { fill:var(--gold) }
  #tip { position:fixed; z-index:9; pointer-events:none; background:#0d1d22; border:1px solid var(--line); border-radius:8px; padding:6px 9px; font-size:12.5px; line-height:1.4; box-shadow:0 8px 24px rgba(0,0,0,.45); opacity:0; transition:opacity .1s } #tip.on { opacity:1 } #tip b { font-variant-numeric:tabular-nums }
  .wrap { background:var(--card); border:1px solid var(--line); border-radius:14px; overflow-x:auto }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; font-size:14px }
  th, td { padding:8px 12px; text-align:left; white-space:nowrap; border-bottom:1px solid var(--line) } th { color:var(--dim); font-weight:600; font-size:12.5px } tr:last-child td { border-bottom:0 }
  td.n, th.n { text-align:right } tr.mark td { border-top:2px solid rgba(245,192,74,.5) } td .m { color:var(--gold); font-size:12px; margin-left:6px } td.w { white-space:normal; color:var(--dim) }
  .two { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:10px }
  .list { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:10px 14px } .list h3 { font:600 14px Figtree, sans-serif; margin:0 0 6px } .list p { margin:2px 0; display:flex; gap:10px } .list p span:last-child { margin-left:auto; font-variant-numeric:tabular-nums; color:var(--dim) }
  a { color:var(--gold) }
  @media (max-width:560px) { .opt { display:none } th, td { padding:8px 8px } tr.mark td:first-child { white-space:normal; min-width:120px } tr.mark td .m { display:block; margin:2px 0 0 } }
  @media (prefers-reduced-motion: reduce) { .dot { animation:none } #tip { transition:none } }
</style>
</head>
<body>
<main>
  <header><img src="/brand/icon.png" alt="" width="30" height="30">Agent Standup</header>
  <h1>Growth <span>live</span></h1>
  <p class="sub" id="state"><span class="dot"></span>Loading…</p>
  <div class="tiles" id="tiles"></div>
  <h2>Day by day</h2>
  <p class="note">Each bar is one day, from 05:17 to 05:17 UTC (when the daily job records the counters); the last, lighter bar is today so far. Downloads (Open VSX, npm, GitHub files) are mostly automatic: compare days, not totals.</p>
  <div class="charts" id="charts"></div>
  <h2>People who opened the call</h2>
  <p class="note">Only those who said yes to “share usage”: one request a week each. A week runs from Monday (UTC).</p>
  <div class="wrap"><table><thead><tr><th>Week of</th><th class="n">People</th><th class="opt">From</th></tr></thead><tbody id="weeks"></tbody></table></div>
  <h2>Website</h2>
  <p class="note" id="webnote">agent-standup.com, from Vercel Web Analytics. Bounce: home visitors who saw only that page (clicking “Install” leaves the site and counts as a bounce). Install clicks: Install VS Code, Install Open VSX, Download and Copy command.</p>
  <div id="web"></div>
  <h2>YouTube</h2>
  <div class="wrap"><table><thead><tr><th>Video</th><th class="n">Views</th></tr></thead><tbody id="yt"></tbody></table></div>
  <h2>Elsewhere</h2>
  <div class="two" id="else"></div>
  <p class="note">The funnel of the Marketplace page (its views, then installs, per day) is only in the publisher account: <a href="https://marketplace.visualstudio.com/manage" rel="noopener">marketplace.visualstudio.com/manage</a>, Acquisition tab. The public install counter above lags it by a varying amount.</p>
</main>
<div id="tip" role="tooltip"></div>
<script>
  const key = new URLSearchParams(location.search).get('k') || '', $ = (id) => document.getElementById(id), L = 'en-GB';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const fmt = (n) => (n == null ? '–' : new Intl.NumberFormat(L).format(n)), money = (c) => new Intl.NumberFormat(L, { style: 'currency', currency: 'EUR' }).format((c || 0) / 100);
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–'), per100 = (a, b) => (a == null || !b ? '–' : ((100 * a) / b).toFixed(1));
  const dshort = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(L, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const tile = (label, v, sub, cls) => '<div class="tile ' + (cls || '') + '"><small>' + esc(label) + '</small><b>' + v + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>';

  // One bar chart: one series, bars from a common baseline, a hover (or tap) tooltip per bar
  function bars(title, why, pts, delta) {   /* delta: the bars are changes of a counter, written with a sign */
    const n = pts.length, W = 420, H = 104, step = W / Math.max(n, 10), w = Math.min(16, step - 4), top = 14, base = H - 18, max = Math.max(1, ...pts.map((p) => p.v || 0)), y = (v) => base - ((base - top) * v) / max;   /* one drawing width for every chart: text and bars keep one size whatever the number of days */
    let g = '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" stroke="var(--line)"/><line x1="0" x2="' + W + '" y1="' + top + '" y2="' + top + '" stroke="var(--grid)" stroke-dasharray="2 3"/><text x="0" y="' + (top - 4) + '">' + fmt(max) + '</text>';
    pts.forEach((p, i) => {
      const x = i * step + (step - w) / 2, v = Math.max(0, p.v || 0), yy = y(v), r = Math.min(4, (base - yy) / 2), tip = esc(dshort(p.d)) + (p.now ? ' (so far)' : '') + '<br><b>' + (p.v == null ? 'no record' : (delta && p.v > 0 ? '+' : '') + fmt(p.v)) + '</b>';
      g += '<rect class="hit" x="' + i * step + '" y="0" width="' + step + '" height="' + H + '" data-tip="' + tip.replace(/"/g, '&quot;') + '"/>';
      if (v > 0) g += '<path class="b' + (p.now ? ' now' : '') + '" d="M' + x + ',' + base + 'V' + (yy + r) + 'Q' + x + ',' + yy + ' ' + (x + r) + ',' + yy + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + yy + ' ' + (x + w) + ',' + (yy + r) + 'V' + base + 'Z"/>';
      else g += '<path class="b' + (p.now ? ' now' : '') + '" d="M' + x + ',' + base + 'h' + w + '"/>';
    });
    if (n) g += '<text x="0" y="' + (H - 3) + '">' + esc(dshort(pts[0].d)) + '</text>';
    if (n > 1) g += '<text x="' + Math.max(n * step, 130) + '" y="' + (H - 3) + '" text-anchor="end">' + esc(dshort(pts[n - 1].d)) + '</text>';
    const last = pts.filter((p) => !p.now && p.v != null).slice(-1)[0];
    return '<div class="chart"><div class="hd"><h3>' + esc(title) + '</h3><em>' + (last ? 'last full day ' + (delta && last.v > 0 ? '+' : '') + fmt(last.v) : '') + '</em></div><p class="why">' + esc(why) + '</p><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + ', per day">' + g + '</svg></div>';
  }
  // The daily change of a counter: the record of day d minus the record before it is the bar of the day before d; the live value minus the last record is "today so far"
  function series(hist, live, get) {
    const all = hist.concat([{ ...live, now: true }]), out = [];
    for (let i = 0; i + 1 < all.length; i++) { const a = get(all[i]), b = get(all[i + 1]); out.push({ d: all[i].d, v: typeof a === 'number' && typeof b === 'number' ? b - a : null, now: !!all[i + 1].now }); }
    return out.slice(-21);
  }
  const files = (x) => x.hub && x.hub.files ? Object.values(x.hub.files).reduce((s, n) => s + n, 0) : null;

  function render(D) {
    const h = (D.hub && D.hub.history) || [], live = { d: new Date().toISOString().slice(0, 10), mp: D.mp, ovsx: D.ovsx, npm: D.npm && D.npm.total, hub: D.hub };
    const hist = h, wk = weeks(h, live), thisWeek = wk.length ? wk[wk.length - 1] : null;
    $('tiles').innerHTML = [
      tile('People who opened the call this week', thisWeek ? fmt(thisWeek.n) : '–', thisWeek ? Object.entries(thisWeek.by).filter(([, v]) => v).map(([k, v]) => esc(k) + ' ' + fmt(v)).join(' · ') || 'opt-in, since Monday' : 'opt-in, since Monday', 'key'),
      tile('VS Code Marketplace installs', D.mp ? fmt(D.mp.installs) : '–', D.mp ? (D.mp.ratings ? D.mp.rating.toFixed(1) + '★ from ' + D.mp.ratings + ' ratings · ' : '') + 'v' + esc(D.mp.version) : 'no answer'),
      tile('GitHub stars', D.hub ? fmt(D.hub.stars) : '–', D.hub ? fmt(D.hub.forks) + ' forks · ' + fmt(D.hub.issues) + ' open issues & PRs' : 'no answer'),
      tile('Open VSX downloads', D.ovsx ? fmt(D.ovsx.downloads) : '–', D.ovsx ? (D.ovsx.reviews ? D.ovsx.rating.toFixed(1) + '★ from ' + D.ovsx.reviews + ' review' + (D.ovsx.reviews > 1 ? 's' : '') + ' · ' : '') + 'v' + esc(D.ovsx.version) : 'no answer'),
      tile('npm downloads, last year', D.npm ? fmt(D.npm.total) : '–', 'npx @double_geste/agent-standup'),
      tile('GitHub release files', D.hub ? fmt(files({ hub: D.hub })) : '–', D.hub ? 'Mac ' + fmt(D.hub.files.mac) + ' · Windows ' + fmt(D.hub.files.windows) + ' · Linux ' + fmt(D.hub.files.linux) + ' · vsix ' + fmt(D.hub.files.vsix) : ''),
      tile('YouTube subscribers', D.yt && D.yt.subs != null ? fmt(D.yt.subs) : '–', D.yt ? fmt(D.yt.views) + ' views in all' : 'no answer'),
      D.sales ? tile('Packs sold', fmt(D.sales.sold), money(D.sales.net) + ' net' + (D.sales.fees ? '' : ' (before fees)') + (D.sales.live ? '' : ' · test mode')) : '',
    ].join('');
    const npmDays = D.npm ? D.npm.days.slice(-21).map(([d, v]) => ({ d, v })) : [];
    $('charts').innerHTML = [
      bars('Marketplace installs', 'People installing from VS Code (public counter, it lags)', series(hist, live, (x) => x.mp && x.mp.installs), true),
      bars('Opt-in installs active', 'Installs that shared usage that day (once a day each)', series(hist, live, (x) => x.hub && x.hub.active), true),
      bars('GitHub stars', 'New stars', series(hist, live, (x) => x.hub && x.hub.stars), true),
      bars('GitHub release files', 'Desktop apps, vsix and command line downloaded', series(hist, live, files), true),
      bars('Open VSX downloads', 'Cursor, Windsurf and other editors (mostly automatic)', series(hist, live, (x) => x.ovsx && x.ovsx.downloads), true),
      bars('npm downloads', 'From npm’s own daily counts (mostly automatic)', npmDays),
    ].join('');
    $('weeks').innerHTML = wk.length ? wk.slice().reverse().map((w, i) => '<tr><td>' + esc(dshort(w.m)) + (i === 0 ? ' <span class="m" style="color:var(--dim)">so far</span>' : '') + '</td><td class="n">' + fmt(w.n) + '</td><td class="opt w">' + (Object.entries(w.by).filter(([, v]) => v).map(([k, v]) => esc(k) + ' ' + fmt(v)).join(' · ') || '–') + '</td></tr>').join('') : '<tr><td colspan="3">No record yet.</td></tr>';
    renderWeb(D.web);
    $('yt').innerHTML = D.yt && D.yt.videos.length ? D.yt.videos.slice().sort((a, b) => b.views - a.views).map((v) => '<tr><td class="w">' + (v.short ? '<span class="m" style="margin:0 6px 0 0">Short</span>' : '') + esc(v.title) + '</td><td class="n">' + fmt(v.views) + '</td></tr>').join('') : '<tr><td colspan="2">YouTube did not answer.</td></tr>';
    const land = D.hub ? Object.entries(D.hub.landing).filter(([, n]) => n).sort((a, b) => b[1] - a[1]) : [];
    $('else').innerHTML = '<div class="list"><h3>Old landing page, visits by source</h3>' + (land.map(([k, n]) => '<p><span>' + esc(k) + '</span><span>' + fmt(n) + '</span></p>').join('') || '<p>none</p>') + '<p style="color:var(--mute);font-size:12px">“direct” also counts robots</p></div>'
      + '<div class="list"><h3>Marketplace, all time</h3><p><span>Installs</span><span>' + (D.mp ? fmt(D.mp.installs) : '–') + '</span></p><p><span>Updates</span><span>' + (D.mp ? fmt(D.mp.updates) : '–') + '</span></p><p><span>Downloads (mostly automatic)</span><span>' + (D.mp ? fmt(D.mp.downloads) : '–') + '</span></p></div>';
    const holes = ['mp', 'ovsx', 'npm', 'hub', 'yt'].filter((k) => !D[k]);
    $('state').innerHTML = '<span class="dot' + (holes.length ? ' off' : '') + '"></span>Live · read at ' + new Date(D.at).toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit' }) + ' · refreshes every 5 minutes' + (holes.length ? ' · no answer from ' + holes.map((k) => ({ mp: 'the Marketplace', ovsx: 'Open VSX', npm: 'npm', hub: 'GitHub', yt: 'YouTube' })[k]).join(', ') : '');
  }
  // People who opened the call, week by week: the weekly counter at its last record of each week, minus the week before
  function weeks(hist, live) {
    const monday = (d) => { const t = Date.parse(d + 'T00:00:00Z'); return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); }, wk = [];
    const KINDS = [['VS Code', (x) => x.hub && x.hub.week], ['plugin', (x) => x.hub && x.hub.weeks && x.hub.weeks.plugin], ['command line', (x) => x.hub && x.hub.weeks && x.hub.weeks.cli], ['desktop app', (x) => x.hub && x.hub.weeks && x.hub.weeks.desktop]], byWeek = {};
    for (const [name, get] of KINDS) { const kw = []; for (const x of hist.filter((x) => x.d !== live.d).concat([live])) { const n = get(x); if (typeof n !== 'number') continue; const m = monday(x.d), w = kw[kw.length - 1]; if (w && w.m === m) w.n = n; else kw.push({ m, n, from: w ? w.n : 0 }); }
      for (const w of kw) (byWeek[w.m] = byWeek[w.m] || {})[name] = w.n - w.from; }   /* a counter's first week counts from zero: each started at zero */
    for (const m of Object.keys(byWeek).sort()) wk.push({ m, by: byWeek[m], n: Object.values(byWeek[m]).reduce((t, v) => t + v, 0) });
    return wk;
  }
  function renderWeb(w) {
    if (!w || w.missing || w.error) { $('web').innerHTML = '<p class="note warn">' + (w && w.missing ? 'Add VERCEL_TOKEN in the project settings on Vercel to see the visits and clicks here.' : 'Vercel did not answer.') + '</p>'; return; }
    const rows = w.perDay, pts = rows.map((x) => ({ d: x.d, v: x.home, now: x.d === new Date().toISOString().slice(0, 10) }));
    let html = '<div class="charts" style="margin-bottom:10px">' + bars('Home visitors', 'Visitors who saw a home page (any language)', pts) + bars('Install clicks', 'Install VS Code, Install Open VSX, Download, Copy command', rows.filter((x) => x.clicks != null).map((x) => ({ d: x.d, v: x.clicks, now: x.d === new Date().toISOString().slice(0, 10) }))) + '</div>';
    html += '<div class="wrap"><table><thead><tr><th>Day</th><th class="n opt">Page views</th><th class="n">Home visitors</th><th class="n">Bounce</th><th class="n">Install clicks</th><th class="n">per 100 home visitors</th></tr></thead><tbody>'
      + rows.slice().reverse().map((x) => '<tr' + (w.marks[x.d] ? ' class="mark"' : '') + '><td>' + esc(dshort(x.d)) + (w.marks[x.d] ? '<span class="m">← ' + esc(w.marks[x.d]) + '</span>' : '') + '</td><td class="n opt">' + fmt(x.views) + '</td><td class="n">' + fmt(x.home) + (x.capped ? '+' : '') + '</td><td class="n">' + pct(x.one, x.home) + '</td><td class="n">' + (x.clicks == null ? '–' : fmt(x.clicks)) + '</td><td class="n">' + per100(x.clicks, x.home) + '</td></tr>').join('') + '</tbody></table></div>';
    const cuts = Object.keys(w.marks).sort(), periods = []; let from = rows.length ? rows[0].d : '';
    for (const c of cuts.concat(['9999'])) { const p = rows.filter((x) => x.d >= from && x.d < c); if (p.length) periods.push(p); from = c; }
    if (periods.length > 1) html += '<div class="tiles" style="margin-top:10px">' + periods.map((p) => { const home = p.reduce((t, x) => t + x.home, 0), one = p.reduce((t, x) => t + x.one, 0), c = p.filter((x) => x.clicks != null), cl = c.reduce((t, x) => t + x.clicks, 0), ch = c.reduce((t, x) => t + x.home, 0);
      return tile(dshort(p[0].d) + ' to ' + dshort(p[p.length - 1].d) + (w.marks[p[0].d] ? ' · ' + w.marks[p[0].d] : ' · before'), 'bounce ' + pct(one, home), fmt(Math.round(home / p.length)) + ' home visitors a day' + (c.length ? ' · ' + per100(cl, ch) + ' install clicks per 100' : ''), w.marks[p[0].d] ? 'key' : ''); }).join('') + '</div>';
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => esc(k) + ' ' + fmt(n)).join(', ');
    html += '<h3 style="font:600 15px Figtree,sans-serif;margin:18px 0 6px">Clicks, last 7 days</h3>' + (w.events.length ? '<div class="wrap"><table><thead><tr><th>Button</th><th class="n">Clicks</th><th>Where on the page</th><th class="opt">Detail</th></tr></thead><tbody>' + w.events.map(([k, e]) => '<tr><td>' + esc(k) + '</td><td class="n">' + fmt(e.n) + '</td><td class="w">' + top(e.where) + '</td><td class="w opt">' + top(e.what) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="note">None yet (counted since ' + esc(dshort(w.clicksSince)) + ').</p>');
    const list = (t, l) => '<div class="list"><h3>' + t + '</h3>' + (l.map(([k, n]) => '<p><span>' + esc(k) + '</span><span>' + fmt(n) + '</span></p>').join('') || '<p>none</p>') + '</div>';
    html += '<div class="two" style="margin-top:10px">' + list('Page views by source, last 3 days', w.sources) + list('Page views by country, last 3 days', w.countries) + '</div>';
    $('web').innerHTML = html;
  }
  // The tooltip: on hover, or on a tap on a touch screen
  const tipEl = $('tip'); let tipOn = null;
  function showTip(el, x, y) { if (tipOn) tipOn.classList.remove('on'); tipOn = el.nextElementSibling; if (tipOn) tipOn.classList.add('on'); tipEl.innerHTML = el.getAttribute('data-tip'); tipEl.classList.add('on'); const r = tipEl.getBoundingClientRect(); tipEl.style.left = Math.max(8, Math.min(x - r.width / 2, innerWidth - r.width - 8)) + 'px'; tipEl.style.top = Math.max(8, y - r.height - 12) + 'px'; }
  function hideTip() { tipEl.classList.remove('on'); if (tipOn) tipOn.classList.remove('on'); tipOn = null; }
  document.addEventListener('pointermove', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); else if (e.pointerType === 'mouse') hideTip(); });
  document.addEventListener('pointerdown', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); else hideTip(); });
  addEventListener('scroll', hideTip, { passive: true });

  async function tick(fresh) {
    try { const r = await fetch('?k=' + encodeURIComponent(key) + '&json=1' + (fresh ? '&fresh=1' : ''), { cache: 'no-store' }), d = await r.json(); if (!r.ok) throw d; render(d); }
    catch (e) { $('state').innerHTML = '<span class="dot off"></span>Could not read the numbers; trying again in 5 minutes.'; }
    setTimeout(tick, 5 * 60e3);
  }
  tick();
</script>
</body>
</html>`;
