// The sales of the packs, live, for the two who share them: Double Geste and Fabien Coupas, who draws the Halloween characters.   GET /api/sales/?k=<key>
// A page that asks this function every 20 s, and this function asks Stripe: nothing is kept here. Nothing about a buyer is shown either: no name, no email, and no purchase code
// (a code installs the pack); only the time, the amount, the country and how it was paid.
// Settings of the host (never in the repository):
//   SALES_KEY      the long random word in the page's address (16 characters or more); without it the page does not exist (404), and a wrong word gets the same 404
//   SALES_SPLIT    optional: Fabien's part of what is left after Stripe's fees and the refunds, 0.5 by default
// It reads Stripe with the shop's STRIPE_SECRET_KEY: PaymentIntents and Charges (read). Stripe's fees need Balance (read) too; without it the page shows the amounts before fees and says so.
const crypto = require('crypto'), { stripe, PACKS } = require('./_shop.js');
const SINCE = Date.UTC(2026, 9, 1) / 1000;   // nothing was sold before October 2026: older payments of the account's other projects are not read
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();

// The account's payments since SINCE, newest first (all projects: the packs are picked out below). With fees, or without when the key may not read them (Stripe answers 403)
async function payments(fees) {
  const out = [];
  for (let after, i = 0; i < 30; i++) {
    const l = await stripe('GET', '/v1/payment_intents', { limit: 100, created: { gte: SINCE }, starting_after: after, expand: [fees ? 'data.latest_charge.balance_transaction' : 'data.latest_charge'] });
    out.push(...(l.data || [])); if (!l.has_more || !l.data.length) break; after = l.data[l.data.length - 1].id;
  }
  return out;
}
async function rows() {
  let fees = true, list;
  try { list = await payments(true); } catch (e) { if (e.status !== 403) throw e; fees = false; list = await payments(false); }
  const r = [];
  for (const pi of list) {
    if (pi.status !== 'succeeded' || !pi.metadata || !own(PACKS, pi.metadata.pack)) continue;
    const c = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : {}, bt = c.balance_transaction && typeof c.balance_transaction === 'object' ? c.balance_transaction : null, pm = c.payment_method_details || {};
    r.push({ at: pi.created, pack: pi.metadata.pack, amount: pi.amount_received || pi.amount, currency: pi.currency, fee: bt ? bt.fee : null, net: bt ? bt.net : null, refunded: c.amount_refunded || 0, disputed: !!c.disputed,
      country: (c.billing_details && c.billing_details.address && c.billing_details.address.country) || (pm.card && pm.card.country) || '', method: pm.type === 'card' ? (pm.card && pm.card.brand) || 'card' : pm.type || '', src: typeof pi.metadata.from === 'string' ? pi.metadata.from.slice(0, 30) : '', live: !!pi.livemode });   // src: where the purchase started (app, site, site:<link>); nothing before 17 Oct 2026
  }
  return { rows: r, fees, split: Math.min(1, Math.max(0, parseFloat(process.env.SALES_SPLIT || '0.5') || 0)), base: Object.fromEntries(Object.entries(PACKS).map(([k, p]) => [k, p.amount])), live: /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || ''), at: Date.now() };
}

module.exports = async function sales(req, res) {
  const u = new URL(req.url, 'http://x'), want = process.env.SALES_KEY || '', k = u.searchParams.get('k') || '';
  res.setHeader('cache-control', 'no-store'); res.setHeader('x-robots-tag', 'noindex, nofollow'); res.setHeader('referrer-policy', 'no-referrer');
  if (req.method !== 'GET' || want.length < 16 || !crypto.timingSafeEqual(hash(k), hash(want))) { res.statusCode = 404; res.setHeader('content-type', 'text/plain'); return res.end('Not found'); }
  if (u.searchParams.has('json')) {
    try { const d = await rows(); res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(d)); }
    catch (e) { console.error('sales:', e.status || '', e.code || ''); res.statusCode = 502; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ error: e.status === 401 || e.status === 403 ? 'key' : e.closed ? 'closed' : 'stripe' })); }
  }
  res.statusCode = 200; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE);
};
module.exports.rows = rows;   // the growth dashboard (api/stats.js) shows the totals too

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<title>Sales · Agent Standup</title>
<link rel="icon" href="/brand/favicon.svg">
<style>
  @font-face { font-family: Gabarito; src: url(/fonts/gabarito.woff2) format('woff2'); font-weight: 400 900; font-display: swap }
  @font-face { font-family: Figtree; src: url(/fonts/figtree.woff2) format('woff2'); font-weight: 300 900; font-display: swap }
  :root { --night:#0b1418; --night2:#10222a; --card:rgba(20,38,45,.86); --line:#2a4a52; --ink:#f6f2ea; --dim:#a8c3c8; --pumpkin:#f58a1f; --gold:#f5c04a; --peach:#e8845f; --green:#7fd1a4 }
  * { box-sizing:border-box }
  html { -webkit-text-size-adjust:100%; background:var(--night) }
  body { margin:0; min-height:100vh; color:var(--ink); font:400 16px/1.5 Figtree, system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing:antialiased; overflow-x:hidden;
    background: radial-gradient(circle at 90% 4%, rgba(245,192,74,.18), transparent 30%), linear-gradient(180deg, var(--night2), var(--night) 60%) fixed }
  main { max-width:900px; margin:0 auto; padding:24px 16px 56px }
  header { display:flex; align-items:center; gap:10px; font:700 18px Gabarito, sans-serif }
  header img { border-radius:8px }
  h1 { font:800 clamp(28px, 6vw, 40px)/1.1 Gabarito, sans-serif; margin:22px 0 4px }
  h1 span { color:var(--pumpkin) }
  .sub { color:var(--dim); margin:0 0 18px; display:flex; flex-wrap:wrap; gap:6px 14px; align-items:center }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--green); margin-right:6px; vertical-align:1px; animation:pulse 2s ease-in-out infinite }
  .dot.off { background:var(--peach); animation:none }
  @keyframes pulse { 50% { opacity:.35 } }
  .badge { font:700 12px Figtree, sans-serif; letter-spacing:.06em; text-transform:uppercase; padding:3px 8px; border-radius:6px; background:var(--gold); color:#1d1a10 }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px; margin-bottom:12px }
  .tile { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px 14px }
  .tile b { display:block; font:800 26px/1.15 Gabarito, sans-serif; font-variant-numeric:tabular-nums; margin-top:2px }
  .tile small { color:var(--dim); font-size:13px } .tile i { display:block; font-style:normal; color:var(--dim); font-size:12px }
  .tile.share { border-color:rgba(245,138,31,.55) } .tile.share b { color:var(--gold) }
  .note { color:var(--dim); font-size:13px; margin:0 0 22px }
  .note.warn { color:var(--peach) }
  .wrap { background:var(--card); border:1px solid var(--line); border-radius:14px; overflow-x:auto }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; font-size:15px }
  th, td { padding:9px 12px; text-align:left; white-space:nowrap; border-bottom:1px solid var(--line) }
  th { color:var(--dim); font-weight:600; font-size:13px }
  tr:last-child td { border-bottom:0 }
  td.n, th.n { text-align:right }
  .tip { color:var(--gold); font-size:12px; margin-left:4px }
  .refund { color:var(--peach) }
  tr.new td { animation:flash 3s ease-out }
  @keyframes flash { from { background:rgba(245,192,74,.35) } }
  .empty { padding:28px 14px; text-align:center; color:var(--dim) }
  @media (max-width: 560px) { .opt { display:none } th, td { padding:9px 8px } }   /* on a phone: when, paid, net, from */
  @media (prefers-reduced-motion: reduce) { .dot, tr.new td { animation:none } }
</style>
</head>
<body>
<main>
  <header><img src="/brand/icon.png" alt="" width="30" height="30">Agent Standup</header>
  <h1 data-k="title">Halloween pack <span>sales</span></h1>
  <p class="sub"><span id="state"><span class="dot"></span><span data-k="loading">Loading…</span></span><span id="mode"></span></p>
  <div class="tiles" id="tiles"></div>
  <p class="note" id="note"></p>
  <div class="wrap"><table><thead><tr><th data-k="when">When</th><th class="n" data-k="paid">Paid</th><th class="n opt" data-k="fee">Stripe fee</th><th class="n" data-k="net">Net</th><th data-k="from">From</th><th class="opt" data-k="how">Paid with</th><th data-k="src">Started in</th></tr></thead><tbody id="rows"></tbody></table></div>
</main>
<script>
  const FR = (navigator.language || '').toLowerCase().startsWith('fr'), L = FR ? 'fr-FR' : 'en-GB';
  const T = FR ? { title: 'Ventes du pack <span>Halloween</span>', loading: 'Chargement…', when: 'Quand', paid: 'Payé', fee: 'Frais Stripe', net: 'Net', from: 'Pays', how: 'Moyen', src: 'Depuis', app: 'l’app', siteW: 'le site',
      sales: 'ventes', gross: 'encaissé', tips: 'dont pourboires', fees: 'frais Stripe', refunds: 'remboursé', netT: 'net à partager', share: 'part de', live: 'En direct', updated: 'mis à jour à', offline: 'Hors ligne, nouvel essai dans 20 s', keyErr: 'La clé Stripe ne peut pas lire les paiements', none: 'Aucune vente pour l’instant.', test: 'Mode test', refunded: 'remboursé', disputed: 'contesté',
      noFees: 'Les frais Stripe ne sont pas lus (la clé n’a pas le droit « Balance, lecture ») : le net est donc avant frais.', vat: 'Montants TTC. La TVA éventuelle n’est pas déduite ici. Rafraîchi toutes les 20 s.' }
    : { title: 'Halloween pack <span>sales</span>', loading: 'Loading…', when: 'When', paid: 'Paid', fee: 'Stripe fee', net: 'Net', from: 'From', how: 'Paid with', src: 'Started in', app: 'the app', siteW: 'the website',
      sales: 'sales', gross: 'taken in', tips: 'of which tips', fees: 'Stripe fees', refunds: 'refunded', netT: 'net to share', share: 'share of', live: 'Live', updated: 'updated at', offline: 'Offline, trying again in 20 s', keyErr: 'The Stripe key cannot read payments', none: 'No sales yet.', test: 'Test mode', refunded: 'refunded', disputed: 'disputed',
      noFees: 'Stripe fees are not read (the key lacks “Balance, read”): the net is before fees.', vat: 'Amounts include taxes; any VAT owed is not taken out here. Refreshed every 20 s.' };
  if (FR) { document.documentElement.lang = 'fr'; document.title = 'Ventes · Agent Standup'; }
  for (const el of document.querySelectorAll('[data-k]')) if (T[el.dataset.k]) el.innerHTML = T[el.dataset.k];
  const key = new URLSearchParams(location.search).get('k') || '', $ = (id) => document.getElementById(id);
  const money = (c) => new Intl.NumberFormat(L, { style: 'currency', currency: 'EUR' }).format((c || 0) / 100);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const flag = (cc) => /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65)) + ' ' + cc : '';
  let seen = null;
  // What is left of a sale: Stripe's net (or the amount, without fees), minus what was refunded, minus a disputed amount not refunded
  const left = (r) => (r.net != null ? r.net : r.amount) - r.refunded - (r.disputed ? r.amount - r.refunded : 0);
  function render(d) {
    const rows = d.rows, sold = rows.filter((r) => r.refunded < r.amount && !r.disputed);
    const gross = rows.reduce((s, r) => s + r.amount, 0), tips = rows.reduce((s, r) => s + Math.max(0, r.amount - (d.base[r.pack] || r.amount)), 0);
    const fees = rows.reduce((s, r) => s + (r.fee || 0), 0), refunds = rows.reduce((s, r) => s + r.refunded + (r.disputed ? r.amount - r.refunded : 0), 0), net = rows.reduce((s, r) => s + left(r), 0);
    const tile = (v, label, cls, sub) => '<div class="tile ' + (cls || '') + '"><small>' + label + '</small><b>' + v + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>';
    $('tiles').innerHTML = tile(sold.length, T.sales) + tile(money(gross), T.gross, '', tips ? T.tips + ' ' + money(tips) : '') + (d.fees ? tile('− ' + money(fees), T.fees) : '') + (refunds ? tile('− ' + money(refunds), T.refunds) : '')
      + tile(money(net), T.netT) + tile(money(Math.round(net * d.split)), T.share + ' Fabien Coupas', 'share', Math.round(d.split * 100) + ' %') + tile(money(net - Math.round(net * d.split)), T.share + ' Double Geste', 'share', Math.round((1 - d.split) * 100) + ' %');
    $('note').className = 'note' + (d.fees ? '' : ' warn'); $('note').textContent = (d.fees ? '' : T.noFees + ' ') + T.vat;
    $('mode').innerHTML = d.live ? '' : '<span class="badge">' + T.test + '</span>';
    const rowId = (r) => r.at + ":" + r.amount + ":" + r.country, fresh = seen ? rows.filter((r) => !seen.has(rowId(r))) : [];
    $('rows').innerHTML = rows.length ? rows.map((r) => {
      const extra = r.amount - (d.base[r.pack] || r.amount), status = r.disputed ? ' <span class="refund">' + T.disputed + '</span>' : r.refunded ? ' <span class="refund">' + T.refunded + (r.refunded < r.amount ? ' ' + money(r.refunded) : '') + '</span>' : '';
      return '<tr' + (fresh.includes(r) ? ' class="new"' : '') + '><td>' + new Date(r.at * 1000).toLocaleString(L, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</td><td class="n">' + money(r.amount) + (extra > 0 ? '<span class="tip">+' + money(extra) + '</span>' : '') + status
        + '</td><td class="n opt">' + (r.fee != null ? money(r.fee) : '–') + '</td><td class="n">' + money(left(r)) + '</td><td>' + esc(flag(r.country)) + '</td><td class="opt">' + esc(r.method) + '</td><td>' + esc(r.src === 'app' ? T.app : /^site/.test(r.src) ? T.siteW + (r.src.length > 5 ? ' · ' + r.src.slice(5) : '') : '–') + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">' + T.none + '</td></tr>';
    if (fresh.length && document.hidden) document.title = '(+' + fresh.length + ') ' + document.title.replace(/^\\(\\+\\d+\\) /, '');
    seen = new Set(rows.map(rowId));
    $('state').innerHTML = '<span class="dot"></span>' + T.live + ' · ' + T.updated + ' ' + new Date(d.at).toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  async function tick() {
    try { const r = await fetch('?k=' + encodeURIComponent(key) + '&json=1', { cache: 'no-store' }), d = await r.json(); if (!r.ok) throw d; render(d); }
    catch (e) { $('state').innerHTML = '<span class="dot off"></span>' + (e && e.error === 'key' ? T.keyErr : T.offline); }
    setTimeout(tick, 20000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = document.title.replace(/^\\(\\+\\d+\\) /, ''); });
  tick();
</script>
</body>
</html>`;
