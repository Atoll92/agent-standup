// The shop of Agent Standup: what the website needs to sell a character pack. Two functions use this file (the host turns each file of api/ into one; a name that starts with _ is not one):
//   POST /api/checkout  { pack }        → { url, code }   a Stripe Checkout page for that pack, and the code of that purchase
//   POST /api/pack      { pack, code }  → the pack (a zip of images), once Stripe says that purchase is paid and not refunded
//   GET  /api/download?pack=…&code=…    → the same zip as a download, for a person (the thank-you page, the shop)
// No dependency and no database: the code of a purchase (HW-7KQ2-9XPM, made here and kept in the payment's metadata, or Stripe's own cs_… and pi_… ids) is all there is,
// and whether it is paid is asked to Stripe each time. Nothing about a buyer is kept here, and a code is never written to the logs.
// Settings of the host (never in the repository):
//   STRIPE_SECRET_KEY       a restricted key is enough: Checkout Sessions (write), PaymentIntents (read), Charges (read)
//   PACK_HALLOWEEN_URL      where the zip of the pack is kept: an address nobody can guess, read by this function only
//   STRIPE_TAX=1            optional: let Stripe Tax compute the tax (needs Stripe Tax set up in the account)
//   SHOP_INVOICE=0          optional: no invoice (by default Stripe makes one, with the purchase code on it, and emails it when the account sends emails to customers)
// The price is the one of the product in the Stripe account whose price has the lookup key of the pack (agent-standup-halloween), so that sales show under that product and the price
// can be changed in the dashboard; with no such price, the name and amount below are used.
//   SHOP_SITE, STRIPE_API   optional, for tests: the address of the website and of Stripe
const PACKS = {
  halloween: { prefix: 'HW', lookup: 'agent-standup-halloween', name: 'Agent Standup: Halloween character pack', description: 'Hand-drawn characters for Agent Standup by Fabien Coupas, each in its own room. A zip of images, installed by the app.', amount: 200, currency: 'eur', file: () => process.env.PACK_HALLOWEEN_URL },
};
const site = () => (process.env.SHOP_SITE || 'https://agent-standup.com').replace(/\/+$/, '');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Stripe takes forms, with brackets for what is nested: { a: { b: [1] } } → a[b][0]=1
function form(o, pre = '', out = []) {
  for (const [k, v] of Object.entries(o)) { const key = pre ? `${pre}[${k}]` : k; if (v && typeof v === 'object') form(v, key, out); else if (v != null) out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v))); }
  return out;
}
async function stripe(method, path, params) {
  const key = process.env.STRIPE_SECRET_KEY; if (!key) throw Object.assign(new Error('no Stripe key'), { closed: true });
  const q = params ? form(params).join('&') : '', base = (process.env.STRIPE_API || 'https://api.stripe.com').replace(/\/+$/, '');
  const r = await fetch(base + path + (method === 'GET' && q ? '?' + q : ''), { method, headers: { authorization: 'Bearer ' + key, 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : q, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'Stripe answered ' + r.status), { status: r.status, code: j.error && j.error.code });
  return j;
}
// The host gives the body already read when it is JSON; a plain Node server (the tests, scripts/shop-dev.js) does not
async function body(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > 4096) throw new Error('too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const send = (res, code, o) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(o)); };
// One answer for everything that goes wrong, so that the app can say it in the person's language: { error: <word> }
async function handle(req, res, fn) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  let b; try { b = await body(req); } catch { return send(res, 400, { error: 'request' }); }
  const pack = String((b && b.pack) || ''); if (!own(PACKS, pack)) return send(res, 404, { error: 'pack' });
  try { await fn(pack, PACKS[pack], b); } catch (e) {
    if (e.closed) return send(res, 503, { error: 'closed' });
    if (e.code === 'resource_missing' || e.status === 404) return send(res, 404, { error: 'code' });
    console.error('shop:', e.status || '', e.code || '', String(e.message || e).replace(/\b(cs|pi)_[A-Za-z0-9_]+|\b[A-Z]{2}-\w{4}-\w{4}\b/g, '…')); send(res, 502, { error: 'shop' });
  }
}

const prices = {};   // lookup key → price id, kept while the function instance lives
async function priceOf(p) { if (!(p.lookup in prices)) { const l = await stripe('GET', '/v1/prices', { lookup_keys: [p.lookup], active: 'true' }); prices[p.lookup] = (l.data && l.data[0] && l.data[0].id) || ''; } return prices[p.lookup]; }
// The code of a purchase, for people: HW-7KQ2-9XPM (no 0, 1, I or O). It is made here before paying, so that Stripe can print it on the receipt and the invoice it emails;
// the app and the download find the purchase from it with Stripe's search. The ids Stripe gives (cs_…, pi_…) work as codes too.
const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', SHORT = /^[A-Z]{2}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/, CODE = /^(cs_(test|live)_[A-Za-z0-9]{8,200}|pi_[A-Za-z0-9]{8,100})$/;
const shortCode = (prefix) => { const b = require('crypto').randomBytes(8); let c = ''; for (let i = 0; i < 8; i++) c += ALPHA[b[i] % 32] + (i === 3 ? '-' : ''); return prefix + '-' + c; };
const INSTALL = 'In Agent Standup: Settings > Characters > Halloween pack > "I already bought it", then this code.';

async function checkout(req, res) {
  return handle(req, res, async (pack, p, b) => {
    const ref = String((b && b.ref) || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24), from = b && b.from === 'site' ? 'site' + (ref ? ':' + ref : '') : 'app';   // where the purchase started, for the sales page: the shop page says so, and anything else is the app (older versions send nothing)
    if (!p.file()) throw Object.assign(new Error('no file for ' + pack), { closed: true });   // nothing to deliver: nothing to sell
    const price = await priceOf(p), short = shortCode(p.prefix);
    const s = await stripe('POST', '/v1/checkout/sessions', {
      mode: 'payment', line_items: [price ? { quantity: 1, price } : { quantity: 1, price_data: { currency: p.currency, unit_amount: p.amount, product_data: { name: p.name, description: p.description } } }],
      success_url: site() + '/thanks/?code=' + short + '&s={CHECKOUT_SESSION_ID}', cancel_url: site() + '/shop/', metadata: { pack, code: short, from },
      payment_intent_data: { metadata: { pack, code: short, from }, description: `${p.name}. Purchase code ${short}` },   // the description is printed on the receipt Stripe emails
      invoice_creation: process.env.SHOP_INVOICE === '0' ? undefined : { enabled: 'true', invoice_data: { description: `${p.name}. ${INSTALL}`, custom_fields: [{ name: 'Purchase code', value: short }], metadata: { pack, code: short }, footer: 'Lost your code? It installs the pack on any computer: https://agent-standup.com/shop/ · Questions: contact.doublegeste@gmail.com' } },
      custom_text: { submit: { message: 'The pack is delivered as soon as you pay. By paying, you ask for this immediate delivery and give up the 14-day right of withdrawal, which ends with it. Terms of sale: https://agent-standup.com/terms/' } },
      automatic_tax: process.env.STRIPE_TAX === '1' ? { enabled: true } : undefined,
    });
    send(res, 200, { url: s.url, code: s.id, short });
  });
}

// Whether a code is a paid purchase of this pack, not refunded: { ok } or { status, error }
async function verify(name, raw) {
  const code = String(raw || '').trim(), up = code.toUpperCase(); let paid, meta, charge;
  if (SHORT.test(up)) {   // Stripe's search can take a minute to know a payment just made: the app asks with the cs_ id meanwhile
    const r = await stripe('GET', '/v1/payment_intents/search', { query: `metadata['code']:'${up}'`, expand: ['data.latest_charge'] }), pi = (r.data || []).find((x) => x.metadata && x.metadata.code === up);
    if (!pi) return { status: 404, error: 'code' }; paid = pi.status === 'succeeded'; meta = pi.metadata; charge = pi.latest_charge;
  } else if (!CODE.test(code)) return { status: 400, error: 'code' };
  else if (code.startsWith('cs_')) { const s = await stripe('GET', '/v1/checkout/sessions/' + code, { expand: ['payment_intent.latest_charge'] }); paid = s.status === 'complete' && s.payment_status === 'paid'; meta = s.metadata; charge = s.payment_intent && s.payment_intent.latest_charge; }
  else { const pi = await stripe('GET', '/v1/payment_intents/' + code, { expand: ['latest_charge'] }); paid = pi.status === 'succeeded'; meta = pi.metadata; charge = pi.latest_charge; }
  if (!meta || meta.pack !== name) return { status: 404, error: 'code' };   // a purchase of something else
  if (!paid) return { status: 402, error: 'unpaid' };
  if (charge && typeof charge === 'object' && (charge.refunded || charge.amount_refunded > 0 || charge.disputed)) return { status: 403, error: 'refunded' };
  return { ok: true };
}
async function zipOf(name, p) {
  const url = p.file(); if (!url) throw Object.assign(new Error('no file for ' + name), { closed: true });
  const f = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!f.ok) throw new Error('the pack file answered ' + f.status);
  return Buffer.from(await f.arrayBuffer());
}
// POST /api/pack { pack, code }: for the app, which installs the zip itself
async function pack(req, res) {
  return handle(req, res, async (name, p, b) => {
    const v = await verify(name, b.code); if (!v.ok) return send(res, v.status, { error: v.error });
    const zip = await zipOf(name, p);
    res.statusCode = 200; res.setHeader('content-type', 'application/zip'); res.setHeader('cache-control', 'no-store'); res.setHeader('content-length', zip.length); res.end(zip);
  });
}
// GET /api/download?pack=…&code=…: for a person, from the thank-you page or the shop. The file, or back to the shop with the reason
async function download(req, res) {
  const u = new URL(req.url, 'http://x'), name = u.searchParams.get('pack') || '', back = (why) => { res.statusCode = 303; res.setHeader('location', '/shop/?download=' + why + '#download'); res.setHeader('cache-control', 'no-store'); res.end(); };
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  if (!own(PACKS, name)) return back('pack');
  try {
    const v = await verify(name, u.searchParams.get('code')); if (!v.ok) return back(v.error);
    const zip = await zipOf(name, PACKS[name]);
    res.statusCode = 200; res.setHeader('content-type', 'application/zip'); res.setHeader('content-disposition', `attachment; filename="agent-standup-${name}.zip"`); res.setHeader('cache-control', 'no-store'); res.setHeader('content-length', zip.length); res.end(zip);
  } catch (e) { if (e.closed) return back('closed'); if (e.code === 'resource_missing' || e.status === 404) return back('code'); console.error('shop:', e.status || '', e.code || '', String(e.message || e).replace(/\b(cs|pi)_[A-Za-z0-9_]+|\b[A-Z]{2}-\w{4}-\w{4}\b/g, '…')); back('shop'); }
}
module.exports = { checkout, pack, download, PACKS, stripe };   // stripe: also for api/sales.js
