/* Agent Standup: the cast drawn as a two-ink print (riso). Loaded by the page only with ?cast=2; the same file draws the previews in Node.
 * The whole cast in "Two-ink print" (Margot v3's style), drawn from the same traits the app draws today:
 * a persona's hash still picks the shirt colour (now a riso ink), the shape (now a hairstyle, or the robot), the headwear,
 * the eyes, the glasses, the room and the prop. A second hash of the id adds what humans need: skin, hair colour, top, key ink.
 * Each character is printed in its own inks: INK (the shirt's), KEY (the dark plate: lines, desk, night skies) and ACC
 * (the accent: headwear, sun, sparkles). Where INK and KEY overlap: DARK. Margot is the case INK coral, KEY teal, ACC gold,
 * In the call (?cast=2) each tile holds one live drawing: room, body and hair once, a layer per face and per arm pose; the page
 * shows the ones its state asks for (CSS in index.html, under "the riso cast"), and its clocks blink the eyes and move the mouth.
 */
(function (root) {
'use strict';
// ---------- inks
const PAPER = '#f4ead6', CORAL = '#ff6a50', TEAL = '#1c5b78', GOLD = '#f7b733';
const mul = (a, b) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * parseInt(b.slice(i, i + 2), 16) / 255).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => '#' + [1, 3, 5].map((i) => { const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16); return Math.round(x + (y - x) * t).toString(16).padStart(2, '0'); }).join('');
const DARK = mul(CORAL, TEAL);
const SKIN = mix(mix(PAPER, CORAL, 0.2), GOLD, 0.1), SKIN2 = mix(mix(PAPER, CORAL, 0.34), GOLD, 0.08);   // a light even tint of the coral ink, and its shade
const FRECK = mix(CORAL, DARK, 0.18);
const S = [0.62, -0.36], H = [S[0] / 2, S[1] / 2], Z = [0, 0];   // the coral and gold plates' offset; the overlap's

// ---------- numbers and seeds
const f1 = (v) => { const r = Math.round(v * 10) / 10; return (Object.is(r, -0) ? 0 : r).toString().replace(/^(-?)0\./, '$1.'); };
const pt = (p) => { const x = f1(p[0]), y = f1(p[1]); return x + (y[0] === '-' ? '' : ' ') + y; };
const poly = (pts, close = true) => {   // the first point absolute, the rest as steps from the one before (taken between rounded points: no drift)
  const r = pts.map(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]); let d = 'M' + pt([r[0][0] / 10, r[0][1] / 10]) + 'l';
  for (let i = 1; i < r.length; i++) { const dx = r[i][0] - r[i - 1][0], dy = r[i][1] - r[i - 1][1]; if (!dx && !dy) continue; d += (i > 1 ? ' ' : '') + pt([dx / 10, dy / 10]); }
  return (d + (close ? 'Z' : '')).replace(/ -/g, '-').replace(/l-/, 'l-');
};
const hashStr = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const off = (pts, o) => pts.map(([x, y]) => [x + o[0], y + o[1]]);
const rot = (pts, cx, cy, deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]); };

// ---------- curves
function cr(pts, closed, n = 10) {
  const out = [], N = pts.length, at = (i) => (closed ? pts[(i + N) % N] : pts[Math.max(0, Math.min(N - 1, i))]);
  for (let i = 0; i < (closed ? N : N - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))); }
  }
  if (!closed) out.push(pts[N - 1]);
  return out;
}
function resample(s, step, closed) {   // points every `step` along a dense polyline
  const L = [0]; for (let i = 1; i < s.length; i++) L.push(L[i - 1] + Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]));
  let tot = L[L.length - 1]; if (closed) tot += Math.hypot(s[0][0] - s[s.length - 1][0], s[0][1] - s[s.length - 1][1]);
  const n = Math.max(closed ? 6 : 2, Math.round(tot / step)), out = []; let j = 0;
  for (let k = 0; k < (closed ? n : n + 1); k++) {
    const d = (k / n) * tot; while (j < s.length - 2 && L[j + 1] < d) j++;
    const a = s[j], b = s[Math.min(j + 1, s.length - 1)], seg = (L[j + 1] ?? tot) - L[j] || 1, t = Math.min(1, Math.max(0, (d - L[j]) / seg));
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
const noiseFn = (name, n, knots, closed) => {   // a smooth seeded wobble along a contour: knots of random values, cosine-blended
  const r = rng(hashStr(name)), kv = Array.from({ length: knots + 1 }, () => r() * 2 - 1); if (closed) kv[knots] = kv[0];
  const hi = Array.from({ length: n }, () => r() * 2 - 1);
  return (i) => { const x = (i / n) * knots, k = Math.min(knots - 1, Math.floor(x)), f = x - k, t = (1 - Math.cos(f * Math.PI)) / 2; return 0.8 * (kv[k] * (1 - t) + kv[k + 1] * t) + 0.2 * hi[i]; };
};
// a cut-paper / printed edge: a smooth closed shape through the points, resampled, nudged along its normal by a seeded wobble
function rough(pts, name, o = {}) {
  const { amp = 0.13, step = 1, at = Z, smooth = true } = o;
  const dense = smooth ? cr(pts, true, 10) : pts.flatMap((p, i) => { const q = pts[(i + 1) % pts.length]; return Array.from({ length: 8 }, (_, k) => [p[0] + ((q[0] - p[0]) * k) / 8, p[1] + ((q[1] - p[1]) * k) / 8]); });
  const s = resample(dense, step, true), n = s.length, nz = noiseFn(name, n, Math.max(3, Math.round(n / 4)), true);
  const out = s.map((p, i) => { const a = s[(i - 1 + n) % n], b = s[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1; const w = amp * nz(i); return [p[0] - (dy / m) * w + at[0], p[1] + (dx / m) * w + at[1]]; });
  return poly(out);
}
// a brush stroke: a filled outline that swells and tapers, its width wobbling a little (seeded)
function brush(pts, w, name, o = {}) {
  const { t0 = true, t1 = true, min = 0.25, ease = 0.32, at = Z, step = 0.7, closed = false, wob = 0.12 } = o;
  const s = resample(cr(pts, closed, 10), step, closed), N = s.length, nz = noiseFn(name, N, Math.max(2, Math.round(N / 5)), closed);
  const left = [], right = [];
  for (let i = 0; i < N; i++) {
    const a = s[Math.max(0, i - 1)], b = s[Math.min(N - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1, nx = -dy / m, ny = dx / m, t = i / (N - 1);
    let f = 1;
    if (!closed) { if (t0) f = Math.min(f, Math.pow(Math.min(1, t / ease), 0.6)); if (t1) f = Math.min(f, Math.pow(Math.min(1, (1 - t) / ease), 0.6)); f = Math.max(min, f); }
    const hw = (w / 2) * f * (1 + wob * nz(i));
    left.push([s[i][0] + nx * hw + at[0], s[i][1] + ny * hw + at[1]]); right.push([s[i][0] - nx * hw + at[0], s[i][1] - ny * hw + at[1]]);
  }
  return closed ? poly(left) + poly(right.reverse()) : poly(left.concat(right.reverse()));
}
const ellPts = (cx, cy, rx, ry, n = 14, deg = 0) => rot(Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((i / n) * Math.PI * 2), cy + ry * Math.sin((i / n) * Math.PI * 2)]), cx, cy, deg);
const circ = (x, y, r, at = Z) => `M${f1(x - r + at[0])} ${f1(y + at[1])}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`.replace(/ -/g, '-');
const ellD = (cx, cy, rx, ry, at = Z) => `M${f1(cx - rx + at[0])} ${f1(cy + at[1])}a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(2 * rx)} 0a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(-2 * rx)} 0Z`.replace(/ -/g, '-');
const P = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;

// ---------- weights: the silhouette heaviest, contours next, inner details lightest
const W = { sil: 1.25, contour: 0.95, detail: 0.55, fine: 0.42 };

// ---------- states
const EXPR = {
  listening: { brow: [0, 0], lid: 0.12, look: [0, 0], mouth: 'smile', tilt: 2.5 },
  speaking: { brow: [-6, 0.9], lid: 0, look: [0.3, -0.2], mouth: 'open', tilt: -2, talk: true },
  focused: { brow: [20, -1.1], lid: 0.58, look: [0, 0.9], mouth: 'short', tilt: 0 },
  done: { happy: true, brow: [-7, 1.1], mouth: 'grin', tilt: 3.5, sparkle: true },
  needs: { brow: [-9, 1.9], lid: 0, look: [0, -0.7], mouth: 'o', tilt: -3, wide: true, alert: true },
  stuck: { brow: [-17, 0.6], lid: 0.22, look: [-0.9, 0.6], mouth: 'wobble', tilt: -3.5, sweat: true, coil: true },
  waiting: { brow: [5, 0], browR: 1.1, lid: 0.42, look: [-2.1, 0.15], mouth: 'flat', tilt: -6, turn: -1.4 },
};
const ARMS = {   // sleeve centre line (shoulder → wrist), the hand, its angle, its size
  idle: { l: { p: [[27, 56], [28.4, 60.4], [32.4, 61.4]], hand: 'rest', h: [35, 60.6] }, r: { p: [[73, 56], [71.6, 60.4], [67.6, 61.4]], hand: 'rest', h: [65, 60.6] } },
  gesture: { l: { p: [[27, 56], [28.4, 60.4], [32.4, 61.4]], hand: 'rest', h: [35, 60.6] }, r: { p: [[73.5, 57.5], [79.4, 55], [80, 49.6]], hand: 'palm', h: [80.1, 46.8], ang: 7, k: 0.8 } },
  working: { l: { p: [[27, 56], [28.8, 59.8], [33.4, 60.2]], hand: 'rest', h: [36, 59.6] }, r: { p: [[73, 56], [71.2, 59.8], [66.6, 60.2]], hand: 'rest', h: [64, 59.6] } },
  handUp: { l: { p: [[27, 56], [28.4, 60.4], [32.4, 61.4]], hand: 'rest', h: [35, 60.6] }, r: { p: [[73.5, 57.5], [80.8, 52], [82.2, 37.6]], hand: 'palm', h: [82.3, 33.6], ang: 3, k: 1.12 } },
  waiting: { l: { p: [[26.8, 57], [28, 62.2], [33.6, 57], [38.4, 50.6]], hand: 'fist', h: [40.4, 47.2], ang: -26 }, r: { p: [[73, 56], [71.6, 60.4], [67.6, 61.4]], hand: 'rest', h: [65.4, 60.8] } },
};

const lum = (c) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const hue = (c) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };

const L = { SKIN, SKIN2 };
// ---------- inks
const INKS = { coral: '#ff6a50', orange: '#ff8a2a', sun: '#ffc43d', green: '#17a57a', aqua: '#25a0d6', blue: '#4a63de', purple: '#8a5bd1', pink: '#ff5a9e', periwinkle: '#7d88d8', gold: '#f7b733' };
const PAL_INK = ['coral', 'orange', 'sun', 'green', 'aqua', 'blue', 'purple', 'pink'];   // the app's PAL, in the same order
const KEYS = { teal: '#1c5b78', federal: '#263f86', hunter: '#22584a', plum: '#55306e', burgundy: '#7a2946', slate: '#2c3550' };
const SKINS = [[L.SKIN, L.SKIN2], ['#f3c6a0', '#e5ab82'], ['#d6976a', '#c07e52'], ['#a5643f', '#8c5132'], ['#6d402b', '#583222']];
const warm = (c) => { const h = hue(c); return h < 36 || h > 318; };
const yellowish = (c) => { const h = hue(c); return h >= 36 && h <= 56; };

// ---------- hairstyles: back (behind the face), front (over it), where the top of the head is, whether the ears show
const seg = (pts, n = 6) => pts.flatMap((p, i) => i === pts.length - 1 ? [p] : Array.from({ length: n }, (_, k) => [p[0] + ((pts[i + 1][0] - p[0]) * k) / n, p[1] + ((pts[i + 1][1] - p[1]) * k) / n]));
const mirror = (pts) => pts.map(([x, y]) => [100 - x, y]).reverse();
const HAIR = {
  bob: {
    back: [[[33.6, 44.6], [32.6, 36], [32.8, 26], [35.4, 17], [41, 11], [50, 8.8], [59, 11], [64.6, 17], [67.2, 26], [67.4, 36], [66.4, 44.6], [63, 45.6], [60, 42.4], [50, 43], [40, 42.4], [37, 45.6]]],
    front: (() => { const lock = [[36.8, 24], [38.8, 26.4], [40, 33], [39.8, 40], [38.8, 45], [35.6, 45.8], [34.4, 40], [34.6, 30]]; return [[[36.6, 27.4], [36, 20], [39.4, 14], [45, 11], [50, 10.4], [55, 11], [60.6, 14], [64, 20], [63.4, 27.4], [61.2, 25.2], [57, 24.4], [52, 24.6], [50, 24], [48, 24.6], [43, 24.4], [38.8, 25.2]], lock, mirror(lock)]; })(),
    glints: [[[40.4, 16.4], [44.6, 13.4], [50.6, 12.6]], [[36.6, 30], [37.2, 36], [36.8, 41.6]], [[63.4, 30], [62.8, 36], [63.2, 41.6]]],
    top: 8.8, ears: false,
  },
  bun: {
    back: [ellPts(50, 7.8, 6.2, 5.6, 14), ellPts(50, 24, 14.6, 14.4, 18)],
    front: [[[36.4, 27], [36, 19], [40, 12.6], [46, 10], [50, 9.6], [54, 10], [60, 12.6], [64, 19], [63.6, 27], [62.4, 23.6], [59.6, 20.2], [55, 18.6], [50, 18.2], [45, 18.6], [40.4, 20.2], [37.6, 23.6]]],
    glints: [[[41.8, 19], [43.6, 14.2], [47, 11.2]], [[58.2, 19], [56.4, 14.2], [53, 11.2]], [[46.4, 6.6], [50, 4], [53.6, 6.6]]],
    tie: [[45, 10.7], [50, 9.4], [55, 10.7]],
    top: 2.2, ears: true,
  },
  crop: {
    back: [[[37, 33], [36, 25], [36.4, 17.6], [39, 12], [44, 8.6], [50, 7.4], [56.4, 8], [61.6, 11.4], [64, 17.6], [64.2, 25], [63, 33], [62.4, 27], [37.6, 27]]],
    front: [[[37, 26.4], [37.2, 19.6], [39.6, 21.4], [41.6, 18.2], [44.4, 20.6], [47, 17.4], [50, 20], [53, 17.2], [55.8, 19.8], [58.6, 17.6], [60.8, 20.6], [62.8, 19.6], [63, 26.4], [64.2, 17], [61.6, 11.4], [56.4, 8], [50, 7.4], [44, 8.6], [39, 12], [36.2, 17]]],
    glints: [[[41.4, 13], [46.4, 10.4], [52.6, 10.6]], [[44.6, 15.6], [50.4, 13.8], [56.6, 14.6]]],
    top: 7.4, ears: true, beardOk: true,
  },
  long: {
    back: [[[31.4, 61], [31.6, 44], [32.4, 30], [34.6, 19], [40.4, 11.4], [50, 8.6], [59.6, 11.4], [65.4, 19], [67.6, 30], [68.4, 44], [68.6, 61], [62.4, 61.4], [61, 48], [58.6, 44], [50, 44], [41.4, 44], [39, 48], [37.6, 61.4]]],
    front: (() => { const c = [[50, 11.6], [44.6, 12.6], [39.6, 16.6], [36.8, 23.4], [35.8, 32], [35.6, 42], [35, 52], [34.6, 60], [38.8, 60.6], [39.6, 52], [39.2, 42], [39.4, 33], [40.8, 25.4], [44.4, 18.6], [49.6, 15.6]]; return [c, mirror(c)]; })(),
    glints: [[[38.6, 22], [37.6, 32], [37.4, 44]], [[61.4, 22], [62.4, 32], [62.6, 44]], [[50, 10.4], [50, 15]]],
    top: 8.6, ears: false,
  },
  puff: {
    back: [ellPts(50, 22.4, 23.6, 19.8, 30)], backAmp: 0.3,
    front: [[[37.2, 27.4], [37, 21], [40.4, 16.8], [45.6, 14.6], [50, 14.2], [54.4, 14.6], [59.6, 16.8], [63, 21], [62.8, 27.4], [61.4, 23.4], [57.4, 21], [50, 20.2], [42.6, 21], [38.6, 23.4]]],
    texture: true, top: 0.6, ears: true,
  },
  buzz: {
    back: [ellPts(50, 25, 14, 14.4, 18)],
    front: [[[37.3, 26], [37, 19.4], [40.4, 13.8], [45.4, 11], [50, 10.6], [54.6, 11], [59.6, 13.8], [63, 19.4], [62.7, 26], [61.6, 22.6], [58.6, 19.6], [54.4, 18.2], [50, 18], [45.6, 18.2], [41.4, 19.6], [38.4, 22.6]]],
    stubble: true, top: 10.6, ears: true, beardOk: true,
  },
};
const STYLES = ['bob', 'long', 'bun', 'crop', 'puff', 'bob', 'crop', 'buzz'];   // shape (0..3) × a bit → a style; shape 4 is the robot
const HEADWEAR = ['sprig', 'headset', 'beanie', 'cap', 'bow', 'boppers'];          // the app's ACC, in the same order
const PROPS = ['plant', 'mug', 'books'];

// ---------- a persona of the app → a riso character
const hash = hashStr;
function fromPersona(id, kind) {
  const h = hash(id), h2 = hash(id + '#riso'), pick = (n, sh) => (h2 >>> sh) % n;
  if (kind === 'lead' || kind === 'fork') return { id, name: kind, ink: INKS.coral, key: KEYS.teal, acc: INKS.gold, hair: 'dark', style: 'curls', skin: 0, top: 'stripes', eye: 'round', lashes: true, freckles: true, head: 'headset', boom: true, pencil: true, scene: kind === 'lead' ? 6 : (h >>> 18) % 6, prop: 'mug', glasses: kind === 'fork' };
  if (kind === 'user') return { id, name: 'you', ink: INKS.periwinkle, key: KEYS.plum, acc: INKS.coral, hair: 'dark', style: 'crop', skin: 2, top: 'hoodie', eye: 'dot', lashes: false, freckles: false, head: 'beanie', scene: 7, prop: 'mug', glasses: false };
  const shape = (h >>> 3) % 5, inkName = PAL_INK[(h >>> 6) % 8], ink = INKS[inkName];
  let acc = INKS[PAL_INK[(h >>> 24) % 8]]; if (acc === ink) acc = inkName === 'sun' ? INKS.coral : INKS.gold;
  const keys = Object.values(KEYS); let key = keys[pick(6, 0)];
  for (let k = 1; Math.min(Math.abs(hue(key) - hue(ink)), 360 - Math.abs(hue(key) - hue(ink))) < 45 && k < 6; k++) key = keys[(pick(6, 0) + k) % 6];   // never a key ink of the shirt's own hue
  const style = shape === 4 ? 'robot' : STYLES[shape * 2 + pick(2, 3)], skin = 1 + pick(4, 5), hairR = pick(20, 8);
  let hair = hairR < 8 ? 'dark' : hairR < 12 ? 'key' : hairR < 15 ? 'warm' : hairR < 18 ? 'blonde' : 'silver'; if (style === 'puff' && hair === 'blonde') hair = 'dark'; if (hair === 'key' && (key === KEYS.hunter || key === KEYS.teal)) hair = 'dark';
  return { id, name: id, ink, key, acc, hair, style, skin, top: ['stripes', 'crew', 'hoodie', 'collar', 'turtle'][pick(5, 13)], eye: ['round', 'dot', 'tall'][(h >>> 12) % 3], lashes: !!pick(2, 17), freckles: skin <= 2 && pick(4, 19) === 0,
           beard: !!HAIR[style]?.beardOk && pick(5, 22) < 2, head: HEADWEAR[(h >>> 9) % 6], scene: (h >>> 18) % 6, prop: PROPS[(h >>> 21) % 3], glasses: ((h >>> 15) % 4) === 0 };
}

// =====================================================================
function character(C) {
  const INK = C.ink, KEY = C.key, ACC = C.acc, DARK = mul(INK, KEY), [SKIN, SKIN2] = SKINS[C.skin || 0];
  const BLUSH = warm(INK) ? INK : warm(ACC) ? ACC : INKS.coral, FRECK = mix(BLUSH, DARK, 0.18), NOSE = (C.skin || 0) <= 1 ? BLUSH : mix(SKIN2, '#3a1a10', 0.3);
  const MARK = lum(INK) > 0.7 ? mix(INK, KEY, 0.42) : INK, robot = C.style === 'robot';
  const tr = (at) => (at[0] || at[1] ? ` transform="translate(${f1(at[0])} ${f1(at[1])})"` : '');
  const U = (id, fill, at = Z, extra = '') => `<use href="#${id}" fill="${fill}"${tr(at)}${extra}/>`;
  const HALO = (w) => ` stroke="${PAPER}" stroke-width="${w}" stroke-linejoin="round"`;
  const staticDefs = [], extraDefs = [];
  // hair colours: how a hair shape is printed, and the colour of the strokes on it
  const ginger = warm(INK) ? mix(INK, INKS.orange, 0.5) : INKS.orange, blond = yellowish(ACC) ? ACC : INKS.gold;
  const HAIRINK = {
    dark: { paint: (id) => U(id, KEY) + U(id, INK, S) + U(id, DARK, H), front: (id) => U(id, DARK, H), glint: KEY, stub: DARK },
    key: { paint: (id) => U(id, KEY, H), glint: mix(KEY, PAPER, 0.42), stub: KEY },
    warm: { paint: (id) => U(id, mix(ginger, DARK, 0.1), S), glint: mix(ginger, DARK, 0.5), stub: mix(ginger, DARK, 0.3) },
    blonde: { paint: (id) => U(id, blond, S), glint: mix(blond, '#9a5a14', 0.55), stub: mix(blond, '#9a5a14', 0.4) },
    silver: { paint: (id) => U(id, mix(PAPER, KEY, 0.24)), glint: mix(PAPER, KEY, 0.55), stub: mix(PAPER, KEY, 0.6) },
  }[C.hair || 'dark'];

  // ---------- the room
  const R = {};
  function sceneMargot() {   // v3's window on the night city
    const g = [];
    const win = [[6.5, -4], [93.5, -4], [93.5, 37.6], [6.5, 37.6]];
    g.push(P(rough(win, 'win', { smooth: false, amp: 0.12, step: 4.5 }), KEY));
    g.push(P([[14, 6, 0.42], [23, 13, 0.32], [31, 4, 0.36], [66, 3.5, 0.3], [75, 17, 0.38], [80, 4, 0.32], [11, 17, 0.3], [90, 24, 0.3]].map(([x, y, r]) => circ(x, y, r, H)).join(''), PAPER));
    g.push(P(circ(85.4, 13, 4.4, H), PAPER), P(circ(85.4, 13, 4.4, S), 'url(#mgMoon)'), P(circ(88.4, 11.3, 3.9), KEY));
    const towers = [[6.5, 22], [14, 26], [19.5, 18], [26.5, 30], [62, 31], [65, 24], [71, 19], [79.5, 27], [85.5, 21]], wd = [7.5, 6, 7, 5, 4, 6, 8.5, 6, 8];
    const top = (x) => { let y = 37.6; towers.forEach(([tx, ty], i) => { if (x >= tx && x <= tx + wd[i]) y = Math.min(y, ty); }); if (x >= 17 && x <= 24) y = Math.min(y, 14.5 + Math.abs(x - 20.5) * 0.9); return y; };
    const sky = [[6.5, 37.6]]; let last = null;
    for (let x = 6.5; x <= 93.5; x += 0.5) { const y = top(x); if (last !== null && y !== last) sky.push([x, last]); sky.push([x, y]); last = y; }
    sky.push([93.5, 37.6]);
    const simp = sky.filter((p, i) => i === 0 || i === sky.length - 1 || !(sky[i - 1][1] === p[1] && sky[i + 1][1] === p[1]));
    R.city = `<path id="mgCity" d="${poly(simp)}"/>`;
    g.push(U('mgCity', DARK, H));
    const r = rng(hashStr('lit')); let litC = '', litG = '';
    towers.forEach(([tx, ty], i) => { for (let yy = ty + 2; yy < 35.6; yy += 3.1) for (let xx = tx + 1.2; xx < tx + wd[i] - 1.4; xx += 2.3) { const v = r(); if (v < 0.34 && xx > 7.5 && xx < 92) litC += `M${f1(xx)} ${f1(yy)}h1.1v1.5h-1.1Z`; else if (v > 0.95 && xx > 7.5 && xx < 92) litG += `M${f1(xx + S[0])} ${f1(yy + S[1])}h1.1v1.5h-1.1Z`; } });
    g.push(P(litC, INK), P(litG, ACC));
    g.push(P(`M${f1(36.3 + H[0])} -4h1.6V37.6h-1.6ZM${f1(62.1 + H[0])} -4h1.6V37.6h-1.6ZM5.2 ${f1(36.4 + H[1])}H94.8v2.4H5.2Z`, PAPER));
    g.push(P('M5.6 38.8H94.4L94 40.2H6Z', 'url(#mgWall)'));
    return g;
  }
  const wall = (fill) => P('M0 0H100V63H0Z', fill);
  const leaf = (x, y, len, wdt, deg, nm, fill, at = Z) => P(rough(rot([[x, y], [x + len * 0.3, y - wdt], [x + len * 0.75, y - wdt * 0.7], [x + len, y], [x + len * 0.7, y + wdt * 0.55], [x + len * 0.3, y + wdt * 0.7]], x, y, deg), nm, { amp: 0.05, step: 0.5, at }), fill, ` stroke="${PAPER}" stroke-width="1.1" stroke-linejoin="round" paint-order="stroke"`);
  const star4 = (x, y, s, at = Z) => { x += at[0]; y += at[1]; return `M${f1(x)} ${f1(y - s)}Q${f1(x + s * 0.16)} ${f1(y - s * 0.16)} ${f1(x + s)} ${f1(y)}Q${f1(x + s * 0.16)} ${f1(y + s * 0.16)} ${f1(x)} ${f1(y + s)}Q${f1(x - s * 0.16)} ${f1(y + s * 0.16)} ${f1(x - s)} ${f1(y)}Q${f1(x - s * 0.16)} ${f1(y - s * 0.16)} ${f1(x)} ${f1(y - s)}Z`; };
  const SCENES = [
    () => [   // 0 dusk: a sky tinted with the shirt ink, the sun in the accent, two rows of hills
      wall(mix(PAPER, INK, 0.3)), P(circ(81.5, 20, 8.4, S), ACC),
      P(rough([[-2, 46], [14, 38.4], [30, 41.6], [50, 35], [70, 39.4], [86, 34.4], [102, 38], [102, 64], [-2, 64]], 'hill1', { amp: 0.2, step: 1.4 }), mix(INK, DARK, 0.25)),
      P(rough([[-2, 53], [20, 45.4], [42, 50.4], [64, 44.4], [84, 49], [102, 46], [102, 64], [-2, 64]], 'hill2', { amp: 0.2, step: 1.4 }), KEY),
      P(brush([[11, 15], [13, 13.4], [15, 15]], 0.6, 'bird1') + brush([[17, 10.6], [19.4, 8.8], [21.8, 10.6]], 0.7, 'bird2'), KEY),
    ],
    () => {   // 1 rooftops at night: a full moon in a dot screen, chimneys, a string of lights
      const g = [wall(KEY)];
      g.push(P([[8, 30, 0.4], [33, 6, 0.32], [42, 3, 0.3], [62, 4, 0.36], [72, 12, 0.3], [91, 8, 0.4], [96, 18, 0.3], [4, 12, 0.32]].map(([x, y, r]) => circ(x, y, r, H)).join(''), PAPER));
      g.push(P(circ(17.6, 16.4, 7.2, H), PAPER), P(circ(17.6, 16.4, 7.2, S), 'url(#mgMoon)'));
      g.push(P(poly([[-1, 46], [7, 46], [7, 40.4], [15.4, 33.4], [23.8, 40.4], [23.8, 44], [28.6, 44], [28.6, 37.6], [31.6, 37.6], [31.6, 44], [68.4, 44], [68.4, 38], [76.6, 31], [84.8, 38], [84.8, 41.6], [90.6, 41.6], [90.6, 35.6], [93.6, 35.6], [93.6, 41.6], [101, 41.6], [101, 64], [-1, 64]].map(([x, y]) => [x + H[0], y + H[1]])), DARK));
      g.push(P([[11, 44.4], [14.2, 41.2], [19.6, 44.4], [73.6, 39.6], [78.6, 42], [96.4, 45]].map(([x, y]) => `M${f1(x)} ${f1(y)}h1.3v1.7h-1.3Z`).join(''), INK));
      const sag = (t) => [66 + t * 35, 21 + 6 * Math.sin(t * Math.PI)];
      g.push(P(brush(Array.from({ length: 8 }, (_, i) => sag(i / 7)), 0.3, 'wire', { t0: false, t1: false, min: 1, wob: 0 }), DARK));
      g.push(P(Array.from({ length: 9 }, (_, i) => { const [x, y] = sag((i + 0.5) / 9); return circ(x, y + 0.9, 0.62, S); }).join(''), ACC));
      return g;
    },
    () => {   // 2 a room by day: a window, a shelf of books
      const g = [wall(PAPER)];
      g.push(P(rough([[8, 7], [38, 7], [38, 38], [8, 38]], 'win2', { smooth: false, amp: 0.1, step: 3 }), mix(PAPER, KEY, 0.34)));
      g.push(P(ellD(17, 15.6, 4.6, 1.9) + ellD(21, 14.2, 3.2, 1.7) + ellD(31, 27, 3.4, 1.4), PAPER));
      g.push(P(`M${f1(22.2 + H[0])} 7h1.6V38h-1.6ZM8 ${f1(21.6 + H[1])}H38v1.6H8Z`, PAPER));
      g.push(P(brush(seg([[8, 38], [8, 7], [38, 7], [38, 38], [8, 38], [8, 37]]), W.contour, 'win2c', { t0: false, t1: false, min: 1, step: 0.8 }), KEY), P('M6.4 38.4H39.6V40.4H6.4Z', KEY), P('M7 40.6H39L38.6 42H7.4Z', 'url(#mgWall)'));
      const books = [[63, 11.6, 3.4, INK, S], [66.8, 9.6, 3.8, ACC, S], [71, 12.4, 3, KEY, Z], [74.4, 10.4, 3.6, DARK, H], [78.4, 12, 3.2, INK, S]];
      for (const [i, [x, hgt, w, c, at]] of books.entries()) g.push(P(rough([[x, 22 - hgt], [x + w, 22 - hgt], [x + w, 22], [x, 22]], 'bk' + i, { smooth: false, amp: 0.05, step: 1, at }), c));
      g.push(P(brush(rot([[84.2, 21.8], [84.2, 10.6]], 84.2, 21.8, 18), 3.2, 'bkl', { t0: false, t1: false, min: 1, wob: 0.02, at: S }), ACC));
      g.push(P('M61 22H95V23.8H61ZM61 40H95V41.8H61Z', KEY), P('M61.4 24H94.6L94.2 25.4H61.8ZM61.4 42H94.6L94.2 43.4H61.8Z', 'url(#mgWall)'));
      g.push(P(rough([[66, 34], [72, 34], [71.2, 40], [66.8, 40]], 'pot2', { smooth: false, amp: 0.05, at: S }), INK), leaf(69, 34, 7, 2, -120, 'l2a', KEY), leaf(69, 34, 6.4, 1.8, -60, 'l2b', KEY), leaf(69, 34, 5.6, 1.7, -160, 'l2c', KEY));
      return g;
    },
    () => {   // 3 a meadow: hills, clouds, a tree, flowers
      const g = [wall(mix(PAPER, KEY, 0.2))];
      g.push(P(ellD(17, 14, 6.4, 2.4) + ellD(22.6, 12.2, 4.4, 2.6) + ellD(80, 9, 5.4, 2) + ellD(84.4, 7.6, 3.6, 2), PAPER));
      g.push(P(rough([[-2, 48], [25, 38.4], [52, 46], [78, 40], [102, 44], [102, 64], [-2, 64]], 'mhill1', { amp: 0.2, step: 1.4, at: S }), INK));
      g.push(P(rough([[-2, 55], [30, 47.4], [64, 55], [102, 50], [102, 64], [-2, 64]], 'mhill2', { amp: 0.2, step: 1.4 }), KEY));
      g.push(P(rough([[80.2, 24], [82.6, 24], [82.8, 46], [80, 46]], 'trunk', { smooth: false, amp: 0.06, at: H }), DARK));
      g.push(P(rough(ellPts(81.4, 24, 8.4, 7.4, 16), 'crown', { amp: 0.25, step: 1 }), KEY), P(rough(ellPts(76.2, 29.4, 4.6, 4, 12), 'crown2', { amp: 0.2, step: 1 }), KEY));
      g.push(P([[78.4, 21.4], [84.4, 24.6], [80.6, 27.4]].map(([x, y]) => circ(x, y, 0.9, S)).join(''), INK));
      g.push(P([[12, 56.6], [22, 58.6], [33, 55], [46, 58]].map(([x, y]) => circ(x, y, 0.95, S)).join(''), ACC), P([[17, 59.6], [28, 57.6], [40, 59.4]].map(([x, y]) => circ(x, y, 0.8, H)).join(''), PAPER));
      return g;
    },
    () => {   // 4 the sea: a striped sun, waves, a sailboat
      const g = [wall(PAPER)];
      g.push(P(circ(18.4, 24, 8, S), ACC), P(`M9 25.6H28v1.2H9ZM9 28.4H28v1.4H9ZM9 31.2H28V33H9Z`, PAPER));
      g.push(P(rough([[-2, 41.6], [102, 41.6], [102, 64], [-2, 64]], 'sea', { smooth: false, amp: 0.08, step: 2 }), KEY), P('M-1 40.8H101V42H-1Z', mix(INK, DARK, 0.2)));
      g.push(P([[6, 46], [22, 49], [36, 45.4], [64, 47], [80, 50], [92, 45.6], [12, 54], [44, 53], [70, 55], [88, 57]].map(([x, y], i) => brush([[x, y], [x + 2, y - 0.8], [x + 4, y]], 0.55, 'wv' + i)).join(''), mix(PAPER, KEY, 0.35)));
      g.push(P(rough([[70.6, 38.6], [85, 38.6], [82.6, 42], [73, 42]], 'hull', { smooth: false, amp: 0.06, at: S }), INK));
      g.push(P(`M${f1(78.4 + H[0])} ${f1(38.8)}V20.4`, 'none', ` stroke="${DARK}" stroke-width=".6"`));
      const sail = [[79, 21.4], [79, 37.4], [88.2, 37.4]];
      g.push(P(poly(sail), PAPER), P(brush(seg([...sail, sail[0], sail[1]]), 0.6, 'sail', { t0: false, t1: false, min: 1, step: 0.6 }), KEY), P(poly(off([[78.4, 20.4], [82, 21.4], [78.4, 22.6]], S)), ACC));
      return g;
    },
    () => {   // 5 space: a ringed planet, a cratered moon, stars
      const g = [wall(KEY)];
      g.push(P(Array.from({ length: 18 }, (_, i) => circ((i * 53) % 97 + 2, (i * 29) % 52 + 3, i % 3 ? 0.3 : 0.45, H)).join(''), PAPER));
      g.push(P(circ(21, 25, 9.6, S), INK), P(`M${f1(21 + S[0])} ${f1(15.4 + S[1])}a9.6 9.6 0 0 1 0 19.2a12 12 0 0 0 0-19.2Z`, mix(INK, DARK, 0.4)));
      g.push(P(brush(ellPts(21, 25, 16.6, 3.6, 28, -16).concat([ellPts(21, 25, 16.6, 3.6, 28, -16)[0]]), 1.4, 'ring', { t0: false, t1: false, min: 1, wob: 0.05, step: 1, at: S }), ACC));
      g.push(P(circ(83, 19, 5, H), PAPER), P(circ(81.4, 17.6, 1.1) + circ(84.8, 20.6, 0.8) + circ(82.4, 21.6, 0.6), mix(PAPER, KEY, 0.4)));
      g.push(P(star4(64, 10, 2.4, S) + star4(92, 36, 1.8, S) + star4(8, 44, 1.6, S), ACC));
      return g;
    },
    sceneMargot,
    () => {   // 7 your room: a warm wall, a lamp and its halo in a dot screen, a picture
      const g = [wall(mix(PAPER, INK, 0.2))];
      g.push(P(circ(82, 30, 21), 'url(#mgGlow1)'), P(circ(82, 30, 12.6), 'url(#mgGlow2)'));
      g.push(P(rough([[10, 9], [34, 9], [34, 28], [10, 28]], 'frame', { smooth: false, amp: 0.06, step: 2 }), KEY), P(rough([[11.8, 10.8], [32.2, 10.8], [32.2, 26.2], [11.8, 26.2]], 'pic', { smooth: false, amp: 0.05, step: 2, at: H }), PAPER));
      g.push(P(circ(26.6, 15.4, 2.6, S), ACC), P(rough([[11.8, 26.2], [11.8, 21], [17.6, 15.6], [22.4, 20.6], [25.6, 18.4], [32.2, 24], [32.2, 26.2]], 'picm', { smooth: false, amp: 0.05, at: S }), INK));
      g.push(P(`M${f1(81.6 + H[0])} 31H${f1(82.6 + H[0])}V62.6H${f1(81.6 + H[0])}Z`, DARK), P(rough([[77.6, 31.4], [86.6, 31.4], [84.2, 22.4], [80, 22.4]], 'shade', { smooth: false, amp: 0.06, at: S }), ACC), P(brush([[77.6, 31.4], [86.6, 31.4]], 0.7, 'shadeb', { t0: false, t1: false, min: 1 }), mix(ACC, DARK, 0.45)));
      return g;
    },
  ];
  function roomLayer() { return `<g class="room">${SCENES[C.scene]().join('')}</g>`; }

  // ---------- the body: neck, top
  const bodyPts = robot ? [[23.6, 77], [24.4, 60], [27, 54.6], [34, 52], [66, 52], [73, 54.6], [75.6, 60], [76.4, 77]] : [[20.5, 77], [22, 61], [26.5, 54.6], [33.5, 51.4], [41, 50.3], [50, 52.6], [59, 50.3], [66.5, 51.4], [73.5, 54.6], [78, 61], [79.5, 77]];
  function bodyLayer() {
    const g = [], top = C.top;
    if (robot) g.push(P(rough([[46, 44], [54, 44], [54, 53], [46, 53]], 'rneck', { smooth: false, amp: 0.05, at: H }), DARK), P('M46.4 46.6H53.6V47.4H46.4ZM46.4 49.2H53.6V50H46.4Z', mix(PAPER, KEY, 0.45)));
    else if (top !== 'turtle') g.push(P(poly(off([[45.2, 42.5], [54.8, 42.5], [54.8, 53.6], [45.2, 53.6]], S)), SKIN), P(`M${f1(45.2 + S[0])} ${f1(42.5 + S[1])}H${f1(54.8 + S[0])}V${f1(47 + S[1])}Q${f1(50 + S[0])} ${f1(49.2 + S[1])} ${f1(45.2 + S[0])} ${f1(47 + S[1])}Z`, SKIN2));
    const body = rough(bodyPts, robot ? 'rbody' : 'body', { step: 1.1 });
    g.push(U('mgBodyP', INK, S));
    let inner = '';
    if (top === 'stripes' && !robot) { let st = ''; for (let y = 55; y < 77; y += 3.5) st += `M15 ${f1(y)}H85V${f1(y + 1.45)}H15Z`; inner += P(st, DARK); }
    inner += P(rough([[58, 51], [72, 54], [78, 62], [79.5, 77], [64, 77], [69, 63]], 'shade'), 'url(#mgShirt)');
    g.push(`<g clip-path="url(#mgBody)">${inner}</g>`);
    if (robot) {
      g.push(P(rough([[42.4, 55], [57.6, 55], [57.6, 63], [42.4, 63]], 'panel', { smooth: false, amp: 0.05, step: 1 }), PAPER), P(brush(seg([[42.4, 63], [42.4, 55], [57.6, 55], [57.6, 63]]), W.detail, 'panelc', { t0: false, t1: false, min: 1, step: 0.6 }), KEY));
      g.push(P(circ(46, 58.4, 1.2, S), INK), P(circ(50, 58.4, 1.2, S), ACC), P(circ(54, 58.4, 1.2, H), DARK));
    } else if (top === 'turtle') {
      g.push(P(rough([[44.4, 42.6], [55.6, 42.6], [56.6, 53.6], [43.4, 53.6]], 'turtle', { smooth: false, amp: 0.06, at: S }), INK));
      g.push(P([45.6, 48.6, 51.6, 54.4].map((x, i) => brush([[x, 44], [x + (x - 50) * 0.05, 52.6]], 0.42, 'trib' + i, { ease: 0.3 })).join(''), mix(INK, DARK, 0.55)));
      g.push(P(brush([[41.6, 53.2], [50, 54.4], [58.4, 53.2]], W.contour, 'tneck', { at: H }), DARK));
    } else if (top === 'hoodie') {
      g.push(P(rough([[37.6, 51], [43.6, 49], [50, 53.6], [56.4, 49], [62.4, 51], [64.4, 53.8], [58, 56], [50, 57.6], [42, 56], [35.6, 53.8]], 'hood', { amp: 0.08, at: H }), mix(INK, DARK, 0.42)));
      g.push(P(brush([[46.6, 56], [46.2, 61.6]], 0.85, 'str1', { t0: false, t1: false, min: 1 }) + brush([[53.4, 56], [53.8, 61.6]], 0.85, 'str2', { t0: false, t1: false, min: 1 }), PAPER), P(`M45.6 61.2h1.3v1.8h-1.3ZM53.2 61.2h1.3v1.8h-1.3Z`, ACC));
    } else if (top === 'collar') {
      g.push(P(brush([[50, 53.6], [50, 63]], 0.55, 'placket', { t0: false, t1: false, min: 1 }), DARK), P(circ(51.2, 57, 0.55, H) + circ(51.2, 60.4, 0.55, H), PAPER));
      const cl = [[50, 53.4], [42.6, 50], [40.8, 51.4], [45.2, 57]];
      for (const [i, c] of [cl, mirror(cl)].entries()) g.push(P(rough(c, 'col' + i, { smooth: false, amp: 0.04, step: 0.8 }), PAPER), P(brush(seg([...c, c[0], c[1]]), 0.6, 'colc' + i, { t0: false, t1: false, min: 1, step: 0.5 }), KEY));
    } else if (top === 'crew') {
      g.push(P(brush([[41, 50.6], [50, 53.6], [59, 50.6]], W.contour, 'neckline', { at: H }), DARK), P(brush([[42.4, 51.8], [50, 54.8], [57.6, 51.8]], 0.4, 'neckrib', { at: H }), mix(INK, DARK, 0.5)));
      g.push(P(brush(seg([[57.6, 62.6], [57.6, 56.2], [63.6, 56.2], [63.6, 62.6]]), 0.55, 'pocket', { t0: false, t1: false, min: 1, step: 0.6 }), DARK), P(brush([[60.4, 56.6], [61.2, 52.6]], 1, 'pen', { t0: false, t1: false, min: 1, at: S }), ACC));
    }
    if (top === 'stripes' && !robot) g.push(P(brush([[40.6, 50.6], [50, 53.2], [59.4, 50.6]], W.contour, 'neckline', { at: H }), DARK));
    return { svg: `<g class="body">${g.join('')}</g>`, clip: `<path id="mgBodyP" d="${body}"/><clipPath id="mgBody"><use href="#mgBodyP"${tr(S)}/></clipPath>` };
  }

  // ---------- hair
  function curls() {   // Margot's: v3 as is
    const hairPts = (() => { const out = [], HB = 17; for (let i = 0; i < HB; i++) { for (const [j, R, ry] of [[0, 22.2, 19.6], [0.5, 24.8, 21.8]]) { const a = ((i + j) / HB) * Math.PI * 2 - Math.PI / 2, k = 1 + 0.05 * Math.sin(3 * a + 1.2) - 0.04 * Math.cos(a) + (j && i % 3 === 1 ? 0.03 : 0); out.push([50 + R * k * Math.cos(a), 25.5 + ry * k * Math.sin(a)]); } } return out; })();
    const hairOutline = (() => { const dense = []; for (let i = 0; i < hairPts.length; i += 2) { const a = hairPts[i], c = hairPts[i + 1], e = hairPts[(i + 2) % hairPts.length]; const q = [c[0] * 2 - (a[0] + e[0]) / 2, c[1] * 2 - (a[1] + e[1]) / 2]; for (let k = 0; k < 8; k++) { const t = k / 8; dense.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * q[0] + t * t * e[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * q[1] + t * t * e[1]]); } } return dense; })();
    const fringe = (() => {
      const bumps = [[36.2, 26.8], [41.2, 25.6], [46.2, 24.4], [51.4, 23.6], [57, 24.2], [63.6, 27.4]], pts = [[36, 14], [64.6, 13], [64.6, 27.4]];
      for (let i = bumps.length - 1; i > 0; i--) { const a = bumps[i], b = bumps[i - 1], c = [(a[0] + b[0]) / 2 + 0.6, Math.max(a[1], b[1]) + 2.3]; for (let k = 1; k <= 6; k++) { const t = k / 6; pts.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]); } }
      return pts;
    })();
    const g = [];
    g.push(U('mgHair', PAPER, Z, HALO(2.3)));
    g.push(HAIRINK.paint('mgHair'));
    const cl = [[31, 15, 0.3], [36.5, 8.5, 0.9], [44, 5.2, 1.4], [53, 5, 1.8], [61, 7.6, 2.4], [67.5, 13, 2.9], [70.5, 21, 3.3], [69.5, 31, 3.9], [30, 23, -0.2], [29.4, 32, -0.6], [40, 12, 1], [48.5, 11.4, 1.6], [57.5, 13, 2.1], [34, 21, 0.4]];
    g.push(P(cl.map(([x, y, a], i) => brush([0, 0.7, 1.4, 2.1].map((t) => [x + 1.9 * Math.cos(a + t + 2.4), y + 1.9 * Math.sin(a + t + 2.4)]), W.detail * 1.5, 'curl' + i, { step: 0.6 })).join(''), HAIRINK.glint));
    if (C.pencil) {
      const pen = rot([[63.5, 9.8], [77.2, 9.8]], 63.5, 9.8, -28);
      g.push(P(brush(pen, 2.1, 'pencil', { t0: false, t1: false, min: 1, at: S, wob: 0.04 }), ACC));
      const tip = rot([[77.2, 8.75], [79.4, 9.8], [77.2, 10.85]], 63.5, 9.8, -28), lead = rot([[78.6, 9.42], [79.4, 9.8], [78.6, 10.18]], 63.5, 9.8, -28);
      g.push(P(poly(off(tip, S)), SKIN), P(poly(off(lead, H)), DARK), P(brush(rot([[64.6, 9.8], [76.2, 9.8]], 63.5, 9.8, -28), 0.32, 'penline', { t0: false, t1: false, min: 1, wob: 0 }), mix(ACC, INK, 0.6)));
    }
    return {
      defs: `<path id="mgHair" d="${rough(hairOutline, 'hair', { amp: 0.12, step: 0.85, smooth: false })}"/>`, frontDefs: `<path id="mgFringe" d="${rough(fringe, 'fringe', { at: H, smooth: false, amp: 0.1, step: 0.8 })}"/>`,
      back: `<g class="hair">${g.join('')}</g>`, front: `<g class="hair front">${U('mgFringe', DARK)}${P(brush([[47, 17.4], [49.5, 20.6], [52.8, 21.2]], 0.75, 'fr1'), HAIRINK.glint)}${P(brush([[39, 19.6], [41.6, 22.6], [44.2, 22.8]], 0.7, 'fr2'), HAIRINK.glint)}</g>`,
      top: 4, ears: true,
    };
  }
  function hairStyle() {
    if (C.style === 'curls') return curls();
    const st = HAIR[C.style], gl = HAIRINK.glint;
    const back = st.back.map((pts, i) => `<path d="${rough(pts, C.style + 'b' + i, { amp: st.backAmp || 0.12, step: 0.9 })}"/>`).join('');
    const front = st.front.map((pts, i) => `<path d="${rough(pts, C.style + 'f' + i, { amp: 0.1, step: 0.8 })}"/>`).join('');
    const paint = (id) => (st.stubble ? U(id, SKIN, S) + U(id, 'url(#mgStub)', H) : HAIRINK.paint(id));
    if (st.stubble) staticDefs.push(`<pattern id="mgStub" patternUnits="userSpaceOnUse" width=".78" height=".78" patternTransform="rotate(20)"><circle cx=".39" cy=".39" r=".3" fill="${HAIRINK.stub}"/></pattern>`);
    let deco = '';
    if (st.glints) deco += P(st.glints.map((p, i) => brush(p, 0.62, C.style + 'gl' + i, { ease: 0.45 })).join(''), gl);
    if (st.texture) {   // a puff: little curls all over, away from the face
      const r = rng(hashStr('puff' + C.id)), arcs = [];
      for (let y = 4.6; y < 42; y += 4.2) for (let x = 28; x < 73; x += 4.4) { const jx = x + (r() - 0.5) * 2 + ((y / 4.2) % 2) * 2.2, jy = y + (r() - 0.5) * 1.6; if (((jx - 50) / 21) ** 2 + ((jy - 22.4) / 17.4) ** 2 > 1) continue; if (((jx - 50) / 14.6) ** 2 + ((jy - 32.4) / 13.2) ** 2 < 1) continue; const a = r() * 6.28; arcs.push(brush([0, 0.8, 1.6, 2.4].map((t) => [jx + 1.5 * Math.cos(a + t), jy + 1.5 * Math.sin(a + t)]), 0.62, 'pa' + arcs.length, { step: 0.5 })); }
      deco += P(arcs.join(''), gl);
    }
    const tie = st.tie ? P(brush(st.tie, 1.5, 'tie', { t0: false, t1: false, min: 1, at: S }), ACC) : '';
    return {
      defs: `<g id="mgHair">${back}</g>`, frontDefs: `<g id="mgFringe">${front}</g>`,
      back: `<g class="hair">${U('mgHair', PAPER, Z, HALO(2.3))}${paint('mgHair')}${tie}</g>`,
      front: `<g class="hair front">${st.stubble ? paint('mgFringe') : (HAIRINK.front || HAIRINK.paint)('mgFringe')}${deco}</g>`,
      top: st.top, ears: st.ears,
    };
  }
  const HS = robot ? null : hairStyle();
  const hatClip = ['beanie', 'cap'].includes(C.head) && !robot;

  function earsLayer() {
    if (robot || !HS.ears || C.head === 'headset') return '';
    const e = [[37.8, 28.4], [35.6, 27.6], [34.2, 29.6], [34.5, 33.2], [36.1, 35.6], [38, 35.4]], g = [];
    for (const [i, pts] of [e, mirror(e)].entries()) {
      g.push(P(rough(pts, 'ear' + i, { amp: 0.04, step: 0.5, at: S }), SKIN));
      const s = i ? -1 : 1, x0 = i ? 100 - 37.4 : 37.4;
      g.push(P(brush(i ? mirror(e).slice(0, 5) : e.slice(1), W.detail * 1.3, 'earc' + i, { ease: 0.2 }), KEY), P(brush([[x0 - s * 1.6, 30.2], [x0 - s * 2.4, 31.4], [x0 - s * 1.7, 33.2]], W.fine, 'eari' + i, { ease: 0.4 }), mix(SKIN2, KEY, 0.4)));
    }
    return `<g class="ears">${g.join('')}</g>`;
  }

  // ---------- headwear
  function headwear() {
    const top = robot ? 15 : HS.top, g = [];
    const sign = (d, fill) => `<path d="${d}" fill="${PAPER}" stroke="${PAPER}" stroke-width="1.6" stroke-linejoin="round"/>` + P(d, fill);
    switch (robot && !['bow', 'sprig'].includes(C.head) ? 'none' : C.head) {
      case 'headset': {
        const band = [[35.4, 28], [36.4, 15.4], [50, 9.4], [63.6, 15.4], [64.6, 28]];
        g.push(P(brush(band, 3.4, 'band', { t0: false, t1: false, min: 1, wob: 0.05, step: 1.5 }), KEY), P(brush(band, 1.9, 'bandg', { t0: false, t1: false, min: 1, at: S, wob: 0.05, step: 1.5 }), ACC));
        for (const [i, cx] of [35.6, 64.4].entries()) {
          const rr = (x, y, w, h, r) => `M${f1(x + r)} ${f1(y)}h${f1(w - 2 * r)}a${f1(r)} ${f1(r)} 0 0 1 ${f1(r)} ${f1(r)}v${f1(h - 2 * r)}a${f1(r)} ${f1(r)} 0 0 1 ${f1(-r)} ${f1(r)}h${f1(2 * r - w)}a${f1(r)} ${f1(r)} 0 0 1 ${f1(-r)} ${f1(-r)}v${f1(2 * r - h)}a${f1(r)} ${f1(r)} 0 0 1 ${f1(r)} ${f1(-r)}Z`.replace(/ -/g, '-');
          g.push(P(rr(cx - 3.6, 25.4, 7.2, 12.6, 3.5), KEY), P(rr(cx - 2.6 + S[0], 26.4 + S[1], 5.2, 10.6, 2.5), ACC));
          const ex = cx < 50 ? cx + 1.4 : cx - 2.5;
          g.push(P(poly(off([[ex, 27.6], [ex + 1.1, 27.6], [ex + 1.1, 35.8], [ex, 35.8]], H)), DARK), P(poly(off([[cx - (cx < 50 ? 1.7 : -0.7), 27.8], [cx - (cx < 50 ? 0.8 : -1.6), 27.8], [cx - (cx < 50 ? 0.8 : -1.6), 32.6], [cx - (cx < 50 ? 1.7 : -0.7), 32.6]], H)), PAPER));
        }
        if (C.boom) g.push(P(brush([[34.6, 37.6], [35.4, 42.2], [39.2, 44], [43, 43.4]], 1.15, 'boom', { t0: false, ease: 0.5 }), KEY), P(ellD(44.2, 43.1, 1.75, 1.4, H), DARK));
        return `<g class="headset">${g.join('')}</g>`;
      }
      case 'beanie': {
        const dome = [[35.6, 21], [35.6, 14.4], [39.6, 8.4], [45, 5.6], [50, 5], [55, 5.6], [60.4, 8.4], [64.4, 14.4], [64.4, 21]];
        g.push(P(circ(50, 3.8, 3.4), PAPER), P(circ(50, 3.8, 3.4, S), 'url(#mgKnit)'));
        g.push(`<path d="${rough(dome, 'beanie', { amp: 0.08, at: S })}" fill="${ACC}" stroke="${PAPER}" stroke-width="1.6" stroke-linejoin="round" paint-order="stroke"/>`);
        g.push(P([41, 45.4, 50, 54.6, 59].map((x, i) => brush([[x, 18], [x + (x - 50) * 0.12, 9 + Math.abs(x - 50) * 0.12]], 0.4, 'knit' + i, { ease: 0.5 })).join(''), mix(ACC, DARK, 0.35)));
        g.push(P(rough([[34.6, 17.2], [65.4, 17.2], [65.8, 23.4], [34.2, 23.4]], 'cuff', { smooth: false, amp: 0.07, step: 1.2, at: S }), mix(ACC, DARK, 0.16)));
        let ribs = ''; for (let x = 36.2; x < 64.4; x += 1.9) ribs += brush([[x, 18.2], [x, 22.6]], 0.42, 'brib' + x, { t0: false, t1: false, min: 1, wob: 0 });
        g.push(P(ribs, mix(ACC, DARK, 0.5)));
        return `<g class="hat">${g.join('')}</g>`;
      }
      case 'cap': {
        const dome = [[36, 19], [36.6, 12], [41, 6.4], [50, 4.6], [59, 6.4], [63.4, 12], [64, 19]];
        g.push(`<path d="${rough(dome, 'cap', { amp: 0.07, at: S })}" fill="${ACC}" stroke="${PAPER}" stroke-width="1.6" stroke-linejoin="round" paint-order="stroke"/>`);
        g.push(P(brush([[50, 5], [44.6, 10.4], [42.6, 18.6]], 0.45, 'seam1', { t0: false }) + brush([[50, 5], [55.4, 10.4], [57.4, 18.6]], 0.45, 'seam2', { t0: false }), mix(ACC, DARK, 0.45)), P(circ(50, 4.8, 1, H), DARK));
        g.push(P(rough([[33, 19], [50, 16.8], [67, 19], [66, 22.4], [50, 21], [34, 22.4]], 'brim', { amp: 0.06, step: 0.8, at: S }), mix(ACC, DARK, 0.22)));
        g.push(P(rough([[37.6, 22.6], [50, 21.6], [62.4, 22.6], [61, 24], [50, 23.2], [39, 24]], 'brimsh', { amp: 0.04, step: 0.8, at: H }), 'url(#mgShade)'));
        return `<g class="hat">${g.join('')}</g>`;
      }
      case 'bow': {
        const cx = 60.6, cy = top + (robot ? 1 : 6.4), loop = [[0, 0], [7, -4.4], [8.4, 0.4], [7, 4.6]];
        const L1 = rot(loop.map(([x, y]) => [cx + x, cy + y]), cx, cy, -18), L2 = rot(loop.map(([x, y]) => [cx - x, cy + y]), cx, cy, -18);
        g.push(sign(rough(L1, 'bowa', { amp: 0.05, step: 0.6, at: S }) + rough(L2, 'bowb', { amp: 0.05, step: 0.6, at: S }), ACC));
        g.push(P(rough(L1.map(([x, y]) => [cx + (x - cx) * 0.55, cy + (y - cy) * 0.55 + 0.8]), 'bows', { amp: 0.03, at: S }), 'url(#mgShade)'));
        g.push(P(circ(cx, cy, 1.7, H), mix(ACC, DARK, 0.45)));
        return `<g class="hat">${g.join('')}</g>`;
      }
      case 'sprig': {
        const bx = 56.4, by = top + (robot ? 0.4 : 3.2);
        g.push(P(brush([[bx, by + 1], [bx + 0.6, by - 3], [bx + 2.4, by - 6.4]], 0.7, 'stem', { t0: false }), KEY));
        g.push(`<g>${sign(rough(rot([[bx + 1.2, by - 3.6], [bx + 3, by - 6.4], [bx + 6.6, by - 7.2], [bx + 7.6, by - 6], [bx + 5, by - 3.6]], bx + 1.2, by - 3.6, 0), 'lfa', { amp: 0.04, step: 0.5, at: S }), ACC)}${sign(rough([[bx + 0.6, by - 2.6], [bx - 1.6, by - 5.6], [bx - 5.2, by - 6], [bx - 6, by - 4.6], [bx - 3.2, by - 2.4]], 'lfb', { amp: 0.04, step: 0.5, at: S }), ACC)}</g>`);
        g.push(P(brush([[bx + 1.6, by - 4], [bx + 4.4, by - 5.8], [bx + 6.4, by - 6.4]], 0.32, 'vein1', { ease: 0.4 }) + brush([[bx + 0.2, by - 3.2], [bx - 2.6, by - 4.8], [bx - 4.8, by - 5]], 0.32, 'vein2', { ease: 0.4 }), mix(ACC, DARK, 0.5)));
        return `<g class="hat">${g.join('')}</g>`;
      }
      case 'boppers': {
        const yb = Math.max(top + 2.4, 4.4), ball = Math.max(yb - 7.6, 2.8);
        g.push(P(brush([[35.6, 26], [38, 14.6], [50, yb], [62, 14.6], [64.4, 26]], 1.5, 'hband', { t0: false, t1: false, min: 1, wob: 0.04, step: 1.2, at: S }), ACC));
        for (const [i, s] of [-1, 1].entries()) {
          const x0 = 50 + s * 6.4, y0 = yb + 0.9, x1 = 50 + s * 11.6, spring = [];
          for (let k = 0; k <= 24; k++) { const t = k / 24; spring.push([x0 + (x1 - x0) * t + 0.9 * Math.sin(t * 19), y0 + (ball - y0) * t]); }
          g.push(P(brush(spring, 0.45, 'spr' + i, { ease: 0.1, step: 0.4 }), KEY));
          g.push(sign(circ(x1, ball, 2.3, S), ACC), P(circ(x1 - 0.7 + S[0], ball - 0.7 + S[1], 0.6), PAPER));
        }
        return `<g class="hat">${g.join('')}</g>`;
      }
      default: return '';
    }
  }

  // ---------- desk and props
  function deskLayer() {
    const edge = (name, y, at) => { const nz = noiseFn(name, 52, 12, false); return Array.from({ length: 52 }, (_, i) => [-1 + i * 2 + at[0], y + 0.12 * nz(i) + at[1]]); };
    const t = edge('desk', 63.4, Z), c = edge('deskedge', 62.2, S);
    return `<g class="desk">${P(poly([...t, [101, 76], [-1, 76]]), KEY)}${P(poly([...c, ...edge('deskedge2', 63.5, S).reverse()]), INK)}</g>`;
  }
  function propLayer(steam) {
    const g = [];
    if (C.prop === 'mug') {
      const body = [[80, 54.4], [87.2, 54.4], [87.2, 62.6], [80, 62.6]];
      g.push(`<path d="${rough(body, 'mugh', { amp: 0.06, step: 0.6 })}" fill="${PAPER}" stroke="${PAPER}" stroke-width="1.4" stroke-linejoin="round"/>`);
      g.push(P(rough([[80.6, 57.4], [86.6, 57.4], [86.6, 59], [80.6, 59]], 'mugband', { smooth: false, amp: 0.06, at: S }), INK));
      g.push(P(brush([[80.3, 54.4], [80.2, 62.4], [87, 62.4], [86.9, 54.4]], 0.85, 'mugl', { t0: false, t1: false, min: 1, step: 1.5 }) + brush([[79.6, 54.4], [83.6, 54.1], [87.6, 54.4]], 0.85, 'mugt', { t0: false, t1: false, min: 1, step: 1.1 }) + brush([[87, 56], [90, 56.6], [90.2, 59.4], [87, 60]], 1.05, 'mughd', { t0: false, t1: false, min: 1, step: 1 }), KEY));
      if (steam) g.push(P([82.2, 85].map((sx, i) => brush([[sx, 52.4], [sx - 0.9, 50.8], [sx + 0.6, 49], [sx - 0.4, 47.2]], 0.65, 'steam' + i)).join(''), KEY));
      return `<g class="props mug">${g.join('')}</g>`;
    }
    if (C.prop === 'plant') {
      const pot = [[11.2, 55], [21.8, 55], [20.6, 62.6], [12.4, 62.6]];
      g.push(leaf(16.4, 55, 8.4, 2.4, -128, 'pl1', KEY), leaf(16.6, 55, 9.2, 2.6, -62, 'pl2', KEY), leaf(16.4, 55, 6.4, 2, -96, 'pl3', mix(KEY, INK, 0.0), H), leaf(16.2, 55, 6, 1.9, -158, 'pl4', KEY));
      g.push(P([[-128, 8.4], [-62, 9.2], [-158, 6]].map(([d, l], i) => brush(rot([[16.6, 55], [16.6 + l * 0.75, 55]], 16.5, 55, d), 0.3, 'pv' + i, { ease: 0.5 })).join(''), mix(KEY, PAPER, 0.45)));
      g.push(`<path d="${rough(pot, 'pot', { smooth: false, amp: 0.06, step: 0.8, at: S })}" fill="${INK}" stroke="${PAPER}" stroke-width="1.4" stroke-linejoin="round" paint-order="stroke"/>`, P(rough([[10.6, 54.6], [22.4, 54.6], [22.2, 56.6], [10.8, 56.6]], 'rim', { smooth: false, amp: 0.05, at: S }), mix(INK, DARK, 0.3)));
      return `<g class="props plant">${g.join('')}</g>`;
    }
    const books = [[76, 58.8, 14.2, 3.8, INK, S], [77.6, 55, 12, 3.8, ACC, S], [76.8, 51.4, 11.4, 3.6, KEY, Z]];
    for (const [i, [x, y, w, hh, c, at]] of books.entries()) {
      g.push(`<path d="${rough([[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]], 'book' + i, { smooth: false, amp: 0.05, step: 1, at })}" fill="${c}" stroke="${PAPER}" stroke-width="1.2" stroke-linejoin="round" paint-order="stroke"/>`);
      g.push(P(`M${f1(x + w - 2.4)} ${f1(y + 0.9)}h2v.35h-2ZM${f1(x + w - 2.4)} ${f1(y + 1.8)}h2v.35h-2ZM${f1(x + w - 2.4)} ${f1(y + 2.7)}h2v.35h-2Z`, PAPER), P(`M${f1(x + 2.2)} ${f1(y)}h.9v${f1(hh)}h-.9Z`, c === KEY ? mix(KEY, PAPER, 0.4) : mix(c, DARK, 0.45)));
    }
    return `<g class="props books">${g.join('')}</g>`;
  }

  // ---------- hands and arms (v3)
  const MITT = [[-3.8, 1.5], [-4.1, -0.7], [-3, -2.5], [-0.6, -3.1], [2, -2.9], [3.7, -1.7], [4.1, 0.5], [3.3, 2.4], [0.2, 2.95], [-2.6, 2.7]];
  const PALM = [[-2.2, 4.4], [-2.9, 1.2], [-4.6, -0.6], [-6, -2.6], [-5.6, -4], [-4.2, -3.3], [-3.5, -4.4], [-3.7, -6.4], [-2.7, -8.2], [-0.6, -9], [1.7, -8.5], [3.2, -6.6], [3.6, -2.8], [3.1, 0.8], [2.3, 4.4]];
  const handDefs = [], HANDC = robot ? mix(PAPER, KEY, 0.2) : SKIN;
  function hand(spec, side, name) {
    const [hx, hy] = spec.h, k = spec.k || 1, ang = spec.ang || 0, g = [];
    const flip = spec.hand === 'palm' ? 1 : spec.hand === 'fist' ? 1 : side === 'l' ? 1 : -1;
    const base = (spec.hand === 'palm' ? PALM : MITT).map(([x, y]) => [hx + x * k * flip, hy + y * k]);
    const pts = rot(base, hx, hy, ang);
    handDefs.push(`<path id="${name}" d="${rough(pts, name, { amp: 0.07, step: 0.6 })}"/>`);
    g.push(U(name, PAPER, Z, HALO(2)), U(name, HANDC, S));
    g.push(P(brush([...cr(pts, true, 4), pts[0]], W.contour, name + 'c', { ease: 0.06, min: 0.7, step: 0.45 }), KEY));
    const Ln = (a, b, w, nm) => brush(rot([[hx + a[0] * k * flip, hy + a[1] * k], [hx + b[0] * k * flip, hy + b[1] * k]], hx, hy, ang), w, nm, { ease: 0.4 });
    if (spec.hand === 'palm') g.push(P(Ln([-1.5, -8.6], [-1.4, -5.8], W.fine, name + 'f1') + Ln([0.6, -8.8], [0.6, -5.9], W.fine, name + 'f2') + Ln([2.4, -7.6], [2.2, -5.6], W.fine, name + 'f3') + brush(rot([[hx - 2.2 * k, hy + 0.6 * k], [hx - 0.4 * k, hy + 1.8 * k], [hx + 1.6 * k, hy + 0.8 * k]], hx, hy, ang), W.fine, name + 'crease', { ease: 0.4 }), KEY));
    else g.push(P(Ln([-1.7, 2.6], [-1.6, 1.1], W.fine, name + 'k1') + Ln([0.3, 2.85], [0.3, 1.2], W.fine, name + 'k2') + Ln([2.2, 2.6], [2.1, 1.1], W.fine, name + 'k3'), KEY));
    return g.join('');
  }
  // Arms grow out of the shoulder: one tapered sleeve from a wide root inside the shirt to the wrist.
  // Up to `cut` (a point of p) the sleeve is part of the shirt: same ink, the shirt's own stripes, a thin crease, no paper edge.
  // From `cut` on it passes in front of the body: paper edge, stripes across the sleeve, cuff, hand.
  const AL = (a) => a, AR = (a) => ({ ...a, p: a.p.map(([x, y]) => [100 - x, y]), h: [100 - a.h[0], a.h[1]] });
  const REST = { p: [[30.8, 55.2], [26.2, 59.4], [32.6, 61.6]], cut: 1, hand: 'rest', h: [35, 60.8] };
  const ARMS2 = {
    idle: { l: AL(REST), r: AR(REST) },
    gesture: { l: AL(REST), r: { p: [[69.4, 55.6], [76.8, 56], [80, 52.8], [80.4, 49.8]], cut: 1, crease: false, hand: 'palm', h: [80.4, 46.8], ang: 7, k: 0.8 } },
    working: { l: AL({ p: [[30.8, 55.2], [26.4, 59], [33.6, 60.4]], cut: 1, hand: 'rest', h: [36, 59.8] }), r: AR({ p: [[30.8, 55.2], [26.4, 59], [33.6, 60.4]], cut: 1, hand: 'rest', h: [36, 59.8] }) },
    handUp: { l: AL(REST), r: { p: [[69.4, 55.4], [77.2, 53.8], [81, 48.6], [82.2, 37.6]], cut: 1, crease: false, hand: 'palm', h: [82.3, 33.6], ang: 3, k: 1.12 } },
    waiting: { l: { p: [[30.8, 55.2], [26.8, 59.4], [29.8, 61.8], [34.8, 56.4], [38.4, 50.6]], cut: 2, hand: 'fist', h: [40.4, 47.2], ang: -26 }, r: AR(REST) },
  };
  function sleevePts(p) {   // the centre line, resampled, with each point's arc length
    const s = resample(cr(p, false, 10), 0.4, false), len = [0];
    for (let i = 1; i < s.length; i++) len.push(len[i - 1] + Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]));
    return { s, len, tot: len[len.length - 1] };
  }
  function band(s, i0, i1, hwAt, name) {   // a filled band along s[i0..i1], half width hwAt(i), a round cap at i0
    const nz = noiseFn(name, s.length, Math.max(2, Math.round(s.length / 6)), false), L = [], R = [];
    for (let i = i0; i <= i1; i++) {
      const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1, nx = -dy / m, ny = dx / m, hw = hwAt(i) * (1 + 0.035 * nz(i));
      L.push([s[i][0] + nx * hw, s[i][1] + ny * hw]); R.push([s[i][0] - nx * hw, s[i][1] - ny * hw]);
    }
    const c = s[i0], d = s[Math.min(s.length - 1, i0 + 1)], dx = d[0] - c[0], dy = d[1] - c[1], m = Math.hypot(dx, dy) || 1, ux = dx / m, uy = dy / m, r0 = hwAt(i0), cap = [];
    for (let k = 1; k < 8; k++) { const t = Math.PI * (k / 8); cap.push([c[0] - uy * r0 * Math.cos(t) * -1 - ux * r0 * Math.sin(t), c[1] + ux * r0 * Math.cos(t) * -1 - uy * r0 * Math.sin(t)]); }
    return [...L, ...R.reverse(), ...cap];
  }
  function armLayer(pose) {
    const A = ARMS2[pose], g = [], clips = [];
    for (const side of ['l', 'r']) {
      const a = A[side], nm = pose + side, { s, len, tot } = sleevePts(a.p);
      const W0 = robot ? 7.6 : 9.6, W1 = robot ? 6.4 : 7.2, hw = (i) => (W0 + (W1 - W0) * Math.min(1, len[i] / tot)) / 2;
      let ic = 0, best = 1e9; for (let i = 0; i < s.length; i++) { const d = Math.hypot(s[i][0] - a.p[a.cut][0], s[i][1] - a.p[a.cut][1]); if (d < best) { best = d; ic = i; } }
      const N = s.length - 1, sid = 'mgS' + nm, fid = 'mgF' + nm;
      handDefs.push(`<path id="${sid}" d="${poly(band(s, 0, N, hw, 'sl' + nm))}"/><path id="${fid}" d="${poly(band(s, ic, N, hw, 'sl' + nm))}"/>`);
      // the part that belongs to the shirt: same ink, the shirt's stripes continue on it, a crease toward the body
      const upper = [U(sid, INK, S)];
      if (C.top === 'stripes' && !robot) { let st = ''; for (let y = 55; y < 77; y += 3.5) st += `M10 ${f1(y)}H90V${f1(y + 1.45)}H10Z`; upper.push(`<g clip-path="url(#mgU${nm})">${P(st, DARK)}</g>`); clips.push(`<clipPath id="mgU${nm}"><use href="#${sid}"${tr(S)}/></clipPath>`); }
      const im = Math.round(ic / 2), toward = Math.sign(50 - s[im][0]) || 1;
      const edge = (i, sign) => { const q = s[Math.max(0, i - 1)], b = s[Math.min(N, i + 1)], dx = b[0] - q[0], dy = b[1] - q[1], m = Math.hypot(dx, dy) || 1; return [s[i][0] - (dy / m) * hw(i) * sign, s[i][1] + (dx / m) * hw(i) * sign]; };
      const sgn = Math.sign(edge(im, 1)[0] - edge(im, -1)[0]) === toward ? 1 : -1;
      const i0 = Math.min(ic, Math.max(2, Math.round(1.6 / 0.4))), crease = []; for (let i = i0; i <= ic; i++) crease.push(edge(i, sgn));
      if (a.crease !== false && crease.length > 2) upper.push(P(brush(crease, W.detail, 'crease' + nm, { ease: 0.35, at: H }), robot ? KEY : DARK));
      g.push(...upper);
      // the part in front: paper edge (growing from nothing at the cut), the sleeve, its stripes or shade, the cuff, the hand
      const haloW = (i) => hw(i) + 0.75 * Math.min(1, (len[i] - len[ic]) / 2.2);
      g.push(P(poly(band(s, ic, N, haloW, 'sl' + nm)), PAPER), U(fid, INK, S));
      const ps = s.slice(ic); let run = 1.4, st = '';
      const every = robot ? 4.6 : 3.5, half = robot ? 0.3 : 0.72;
      for (let i = 1; i < ps.length - 12; i++) { run += Math.hypot(ps[i][0] - ps[i - 1][0], ps[i][1] - ps[i - 1][1]); const q0 = ps[Math.max(0, i - 7)], q1 = ps[Math.min(ps.length - 1, i + 7)], bend = Math.abs(Math.atan2(ps[i][1] - q0[1], ps[i][0] - q0[0]) - Math.atan2(q1[1] - ps[i][1], q1[0] - ps[i][0])); if (run >= every && Math.min(bend, 2 * Math.PI - bend) < 0.45) { run = 0; const dx = ps[i][0] - ps[i - 1][0], dy = ps[i][1] - ps[i - 1][1], m = Math.hypot(dx, dy), nx = -dy / m, ny = dx / m, c = ps[i]; st += poly([[c[0] - nx * 6 - (dx / m) * half, c[1] - ny * 6 - (dy / m) * half], [c[0] + nx * 6 - (dx / m) * half, c[1] + ny * 6 - (dy / m) * half], [c[0] + nx * 6 + (dx / m) * half, c[1] + ny * 6 + (dy / m) * half], [c[0] - nx * 6 + (dx / m) * half, c[1] - ny * 6 + (dy / m) * half]]); } }
      const cid = `mgA${pose.slice(0, 3)}${side}`; clips.push(`<clipPath id="${cid}"><use href="#${fid}"${tr(S)}/></clipPath>`);
      const sh = s[Math.min(N, ic + 4)], shade = rough([[sh[0] - 3, sh[1] - 1], [sh[0] + 3, sh[1] - 1], [sh[0] + 3, sh[1] + 5], [sh[0] - 3, sh[1] + 5]], 'slsh' + nm, { amp: 0.05 });
      const inner = C.top === 'stripes' || robot ? P(st, robot ? KEY : DARK) : P(shade, 'url(#mgShirt)');
      g.push(`<g clip-path="url(#${cid})">${inner}</g>`);
      
      const p2 = s[N], p1 = s[N - 3], dx = p2[0] - p1[0], dy = p2[1] - p1[1], m = Math.hypot(dx, dy), ux = dx / m, uy = dy / m;
      const cuffS = poly(off([[p2[0] - ux * 1.9 - uy * 3.7, p2[1] - uy * 1.9 + ux * 3.7], [p2[0] - ux * 1.9 + uy * 3.7, p2[1] - uy * 1.9 - ux * 3.7], [p2[0] + ux * 0.1 + uy * 3.6, p2[1] + uy * 0.1 - ux * 3.6], [p2[0] + ux * 0.1 - uy * 3.6, p2[1] + uy * 0.1 + ux * 3.6]], S));
      const ribs = [-2.6, -1.3, 0, 1.3, 2.6].map((t, j) => brush([[p2[0] - ux * 1.7 - uy * t, p2[1] - uy * 1.7 + ux * t], [p2[0] - uy * t, p2[1] + ux * t]], 0.38, 'rib' + nm + j, { t0: false, t1: false, min: 1, wob: 0 })).join('');
      g.push(hand(a, side, 'h' + nm), P(cuffS, robot ? DARK : INK), P(ribs, robot ? mix(PAPER, KEY, 0.45) : KEY));
    }
    return { svg: `<g class="arms">${g.join('')}</g>`, clips: clips.join('') + handDefs.splice(0).join('') };
  }

  // ---------- the face (v3, with eye shapes, lashes, freckles, beard and glasses as traits)
  const EYE = { round: [2.05, 2.65, 3.05], dot: [1.5, 1.8, 2.15], tall: [1.72, 3.05, 3.4] }[C.eye || 'round'];
  function faceLayer(E, live) {
    const look = E.look || [0, 0], out = [];
    const facePts = [[37.2, 27], [39.4, 20.4], [44, 17.8], [50, 17.2], [56, 17.8], [60.6, 20.4], [62.8, 27], [62.4, 34.6], [59.6, 41], [54.6, 45.3], [50, 46.6], [45.4, 45.3], [40.4, 41], [37.6, 34.6]];
    out.push(P(rough(facePts, 'face', { amp: 0.08, step: 1, at: S }), SKIN));
    out.push(P(rough([[57, 19.4], [63.2, 25], [62.9, 35], [59.4, 42.2], [54.6, 45.8], [58.2, 37.6], [59.8, 28]], 'cheekshade', { amp: 0.05, at: S }), SKIN2));
    out.push(P(brush([...facePts.slice(1), facePts[0], facePts[1]], W.contour, 'facec', { ease: 0.06, step: 1.5, wob: 0.15 }), KEY));
    const T = E.turn || 0;
    if (C.beard) {
      extraDefs.push(`<pattern id="mgBeard" patternUnits="userSpaceOnUse" width=".72" height=".72" patternTransform="rotate(20)"><circle cx=".36" cy=".36" r=".29" fill="${HAIRINK.stub}"/></pattern>`);
      out.push(P(rough([[37.8, 31], [38.8, 37.6], [41.4, 41.8], [45.4, 45.3], [50, 46.6], [54.6, 45.3], [58.6, 41.8], [61.2, 37.6], [62.2, 31], [60.2, 35.8], [57.2, 38.6], [54, 38], [50, 37.4], [46, 38], [42.8, 38.6], [39.8, 35.8]].map(([x, y]) => [x + (x > 40 && x < 60 ? T * 0.6 : 0), y]), 'beard', { amp: 0.05, step: 0.6, at: H }), 'url(#mgBeard)'));
    }
    out.push(P(ellD(42.1 + T, 37.7, 3.1, 1.9, S) + ellD(57.9 + T, 37.7, 3.1, 1.9, S), 'url(#mgBlush)'));
    if (C.freckles) out.push(P([[40.4, 36.1], [42.2, 35.4], [43.6, 36.7], [56.4, 36.7], [57.8, 35.4], [59.6, 36.1]].map(([x, y]) => circ(x + T, y, 0.3, S)).join(''), FRECK));
    out.push(P(rough([[50.4, 33.4], [51.8, 35.4], [50.6, 36.5], [49.1, 35.9], [49.4, 34.6]].map(([x, y]) => [x + T * 1.3, y]), 'nose', { amp: 0.03, step: 0.35, at: S }), NOSE));
    const EY = 31.2, ex = [44.1 + T, 55.9 + T], erx = EYE[0], ery = E.wide ? EYE[2] : EYE[1], lid = E.lid || 0, small = erx < 1.8;
    let eyes = '', lids = '', brows = '';
    for (const [i, x] of ex.entries()) {
      const side = i ? 1 : -1;
      if (E.happy) { eyes += P(brush([[x - 2.6, EY + 0.9], [x, EY - 1.9], [x + 2.6, EY + 0.9]], 1.3, 'happy' + i, { at: H }), DARK); continue; }
      const cx = x + look[0] * 0.55, cy = EY + look[1] * 0.5;
      eyes += (live ? '<g class="!eye">' : '') + P(rough(ellPts(cx, cy, erx, ery, 16), 'eye' + i, { amp: 0.03, step: 0.4, at: H }), DARK) + P(small ? circ(cx + 0.5, cy - 0.6, 0.48, H) : circ(cx + 0.75, cy - 0.95, 0.62, H) + circ(cx - 0.6, cy + 1.1, 0.28, H), PAPER) + (live ? '</g>' : '');
      const ly = EY - ery + lid * 2 * ery;
      if (lid > 0) {
        const cap = ellPts(x, EY, erx + 0.45, ery + 0.4, 14).map(([px, py]) => [px, Math.min(py, ly)]);
        lids += P(poly(off(cap, S)), SKIN) + P(brush([[x - erx - 0.55, ly + 0.25], [x, ly - 0.4], [x + erx + 0.55, ly + 0.25]], 0.8, 'lid' + i, { ease: 0.2, at: H }), DARK);
      }
      const ly2 = lid > 0 ? ly : EY - ery * 0.55;
      if (C.lashes) lids += P(brush([[x + side * (erx - 0.2), ly2 + 0.2], [x + side * (erx + 0.9), ly2 - 0.6], [x + side * (erx + 1.6), ly2 - 1.2]], 0.6, 'lash' + i, { t0: false, at: H }), DARK);
    }
    for (const [i, x] of ex.entries()) {
      if (E.happy && !E.brow) continue;
      const side = i ? 1 : -1, [ba, br] = E.brow || [0, 0], by = 26.3 - br - (!E.happy && i === 1 ? E.browR || 0 : 0);
      brows += P(brush(rot([[x - side * 2.9, by + 0.7], [x - side * 0.2, by - 0.5], [x + side * 3.2, by + 0.4]], x, by, side === -1 ? ba : -ba), 1.55, 'brow' + i, { t0: false, ease: 0.6, min: 0.2, at: H }), C.hair === 'silver' || C.hair === 'blonde' ? HAIRINK.glint : DARK);
    }
    const glasses = C.glasses ? `<g class="glasses">${P(ex.map((x, i) => brush([...ellPts(x, EY, 4.1, 3.8, 18), ellPts(x, EY, 4.1, 3.8, 18)[0]], 0.8, 'gl' + i, { t0: false, t1: false, min: 1, wob: 0.06, step: 0.8 })).join('') + brush([[ex[0] + 4, EY - 0.6], [50 + T, EY - 1.6], [ex[1] - 4, EY - 0.6]], 0.7, 'glb', { t0: false, t1: false, min: 1 }) + brush([[ex[0] - 4.1, EY - 0.8], [37.4, EY - 1.6]], 0.7, 'gla', { t0: false, t1: false, min: 1 }) + brush([[ex[1] + 4.1, EY - 0.8], [62.6, EY - 1.6]], 0.7, 'glc', { t0: false, t1: false, min: 1 }), KEY)}${P(ex.map((x) => brush([[x + 1.2, EY - 2.6], [x + 2.6, EY - 1.2]], 0.5, 'gls' + x, { ease: 0.4, at: H })).join(''), PAPER)}</g>` : '';
    const mx = 50 + T + look[0] * 0.2, my = 39.8;
    const line = (pts, w, nm) => P(brush(pts, w, nm, { at: H }), DARK);
    const M = {
      smile: () => line([[mx - 3.4, my - 0.3], [mx, my + 1.9], [mx + 3.4, my - 0.3]], 1.15, 'm-smile'),
      short: () => line([[mx - 1.6, my + 0.7], [mx + 1.6, my + 0.7]], 1.15, 'm-short'),
      flat: () => line([[mx - 2.2, my + 0.7], [mx, my + 0.45], [mx + 2.3, my + 0.85]], 1, 'm-flat'),
      o: () => P(ellD(mx, my + 1.1, 1.45, 1.85, H), DARK),
      wobble: () => line([[mx - 3.2, my + 1.4], [mx - 1.6, my + 0.4], [mx, my + 1.3], [mx + 1.6, my + 0.4], [mx + 3.2, my + 1.4]], 0.95, 'm-wob'),
      open: () => P(`M${f1(mx - 3.4)} ${f1(my - 0.6)}Q${f1(mx)} ${f1(my + 0.3)} ${f1(mx + 3.4)} ${f1(my - 0.6)}Q${f1(mx + 2.6)} ${f1(my + 5.4)} ${f1(mx)} ${f1(my + 5.4)}Q${f1(mx - 2.6)} ${f1(my + 5.4)} ${f1(mx - 3.4)} ${f1(my - 0.6)}Z`, DARK) + P(ellD(mx, my + 4.3, 1.9, 1.05, S), BLUSH) + P(`M${f1(mx - 2.9)} ${f1(my - 0.35)}Q${f1(mx)} ${f1(my + 0.5)} ${f1(mx + 2.9)} ${f1(my - 0.35)}L${f1(mx + 2.5)} ${f1(my + 0.7)}Q${f1(mx)} ${f1(my + 1.4)} ${f1(mx - 2.5)} ${f1(my + 0.7)}Z`, PAPER),
      grin: () => P(`M${f1(mx - 4.6)} ${f1(my - 1)}Q${f1(mx)} ${f1(my)} ${f1(mx + 4.6)} ${f1(my - 1)}Q${f1(mx + 3.6)} ${f1(my + 6)} ${f1(mx)} ${f1(my + 6)}Q${f1(mx - 3.6)} ${f1(my + 6)} ${f1(mx - 4.6)} ${f1(my - 1)}Z`, DARK) + P(ellD(mx, my + 4.7, 2.5, 1.3, S), BLUSH) + P(`M${f1(mx - 4)} ${f1(my - 0.75)}Q${f1(mx)} ${f1(my + 0.2)} ${f1(mx + 4)} ${f1(my - 0.75)}L${f1(mx + 3.5)} ${f1(my + 0.6)}Q${f1(mx)} ${f1(my + 1.5)} ${f1(mx - 3.5)} ${f1(my + 0.6)}Z`, PAPER),
    };
    const gaze = live && !E.happy && !(E.look || [0, 0]).some(Boolean) ? ' !rgaze' : '';   /* the listening face glances at whoever speaks, as the page moves --lx/--ly */
    const mouth = live && E.mouth === 'open' ? `<g transform="translate(${f1(mx)} ${f1(my + 1.9)}) scale(.62)"><ellipse class="!mouthE" rx="4.6" ry=".9" fill="${DARK}"/></g>` : M[E.mouth]();   /* the page's mouth clock sets its rx and ry while the voice plays */
    return `<g class="face">${out.join('')}<g class="eyes${gaze}">${eyes}</g><g class="lids">${lids}</g>${glasses}<g class="brows">${brows}</g><g class="mouth">${mouth}</g></g>`;
  }

  // ---------- the robot's head: a rounded box, a screen for a face, the accent ink lights it
  function robotHead(E, live) {
    const g = [], look = E.look || [0, 0], T = E.turn || 0, LIT = ACC, SCR = DARK;
    const box = [[35.6, 16.4], [64.4, 16.4], [65.2, 44.6], [34.8, 44.6]];
    g.push(P(brush([[50, 17], [50, 8.6]], 1, 'ant', { t0: false, t1: false, min: 1 }), KEY), `<g class="pulse">${P(circ(50, 6.6, 2.5, S), ACC)}${P(circ(49.3 + S[0], 5.9 + S[1], 0.6), PAPER)}</g>`);
    for (const [i, x] of [32.2, 64.8].entries()) g.push(P(rough([[x, 25], [x + 3, 25], [x + 3, 36], [x, 36]], 'bolt' + i, { smooth: false, amp: 0.05, at: H }), DARK), P(`M${f1(x + 0.6 + H[0])} ${f1(27 + H[1])}h1.8v.5h-1.8ZM${f1(x + 0.6 + H[0])} ${f1(30.2 + H[1])}h1.8v.5h-1.8ZM${f1(x + 0.6 + H[0])} ${f1(33.4 + H[1])}h1.8v.5h-1.8Z`, mix(PAPER, KEY, 0.45)));
    const rr = (x0, y0, x1, y1, r) => { const p = []; for (const [cx, cy, a0] of [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]]) for (let k = 0; k <= 4; k++) { const a = ((a0 + k * 22.5) * Math.PI) / 180; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return p; };
    const head = rr(box[0][0], box[0][1], box[1][0], box[2][1], 7);
    g.push(`<path d="${rough(head, 'rhead', { amp: 0.08, step: 1, smooth: false, at: S })}" fill="${INK}" stroke="${PAPER}" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke"/>`);
    g.push(P(rough([[59, 18], [63.6, 22], [64.2, 40], [60, 43.6], [62, 34]], 'rshade', { amp: 0.05, at: S }), 'url(#mgShirt)'));
    g.push(P(brush([...cr(head, true, 2), head[0]], W.contour, 'rheadc', { ease: 0.05, step: 1.4, wob: 0.12 }), KEY));
    const screen = rr(39.6 + T, 21.6, 60.4 + T, 40, 4.2);
    g.push(P(rough(screen, 'screen', { amp: 0.04, step: 0.8, smooth: false, at: H }), SCR), P(brush([[41.6 + T, 23.6], [45 + T, 22.8]], 0.5, 'glare', { ease: 0.4 }), mix(SCR, PAPER, 0.3)));
    const EY = 29.4, ex = [45 + T, 55 + T];
    let face = '';
    for (const [i, x] of ex.entries()) {
      if (E.happy) { face += P(brush([[x - 2.4, EY + 1], [x, EY - 1.6], [x + 2.4, EY + 1]], 1.1, 'rhappy' + i), LIT); continue; }
      const cx = x + look[0] * 0.5, cy = EY + look[1] * 0.45, ry = E.wide ? 2.8 : 2.4, lid = E.lid || 0;
      const pts = ellPts(cx, cy, 1.9, ry, 14).map(([px, py]) => [px, Math.max(py, cy - ry + lid * 2 * ry)]);
      face += (live ? '<g class="!eye">' : '') + P(poly(pts), LIT) + (live ? '</g>' : '');
      const side = i ? 1 : -1, [ba, br] = E.brow || [0, 0], by = 25 - br * 0.7 - (i === 1 ? (E.browR || 0) * 0.7 : 0);
      face += P(brush(rot([[x - side * 2.3, by + 0.4], [x + side * 2.3, by + 0.2]], x, by, side === -1 ? ba : -ba), 0.8, 'rbrow' + i, { t0: false, t1: false, min: 1 }), LIT);
    }
    const mx = 50 + T + look[0] * 0.2, my = 35.4, Ln = (pts, nm) => P(brush(pts, 0.85, nm, { t0: false, t1: false, min: 1 }), LIT);
    face += ({
      smile: () => Ln([[mx - 3, my - 0.4], [mx, my + 1.2], [mx + 3, my - 0.4]], 'rm'),
      short: () => Ln([[mx - 1.6, my + 0.4], [mx + 1.6, my + 0.4]], 'rm'),
      flat: () => Ln([[mx - 2.2, my + 0.4], [mx + 2.2, my + 0.6]], 'rm'),
      o: () => P(ellD(mx, my + 0.6, 1.3, 1.5), LIT),
      wobble: () => Ln([[mx - 3, my + 0.8], [mx - 1.5, my - 0.2], [mx, my + 0.8], [mx + 1.5, my - 0.2], [mx + 3, my + 0.8]], 'rm'),
      open: () => P(`M${f1(mx - 3)} ${f1(my - 0.6)}H${f1(mx + 3)}Q${f1(mx + 2.4)} ${f1(my + 2.6)} ${f1(mx)} ${f1(my + 2.6)}Q${f1(mx - 2.4)} ${f1(my + 2.6)} ${f1(mx - 3)} ${f1(my - 0.6)}Z`, LIT),
      grin: () => P(`M${f1(mx - 3.8)} ${f1(my - 0.8)}H${f1(mx + 3.8)}Q${f1(mx + 3)} ${f1(my + 3)} ${f1(mx)} ${f1(my + 3)}Q${f1(mx - 3)} ${f1(my + 3)} ${f1(mx - 3.8)} ${f1(my - 0.8)}Z`, LIT),
    }[live && E.mouth === 'open' ? 'live' : E.mouth] || (() => `<g transform="translate(${f1(mx)} ${f1(my + 1)}) scale(.55)"><ellipse class="!mouthE" rx="4.6" ry=".9" fill="${LIT}"/></g>`))();
    return `${g.join('')}<g class="face">${face}</g>`;
  }

  // ---------- marks (v3: ticks, sparkles, coil, talk arcs, wave, sweat)
  function marksLayer(E, pose) {
    const g = [], sign = (d, fill) => g.push(`<path d="${d}" fill="${PAPER}" stroke="${PAPER}" stroke-width="1.6" stroke-linejoin="round"/>`, P(d, fill));
    if (E.sparkle) { sign(star4(20.5, 14, 4, S) + star4(81, 26.5, 3, S), ACC); sign(star4(25.4, 44, 1.9, S), MARK); }
    if (E.alert && pose !== 'handUp') sign([[[25.2, 12.6], [21.6, 8.8]], [[23.6, 18.6], [18.8, 16.8]], [[29.6, 8.4], [27.8, 3.8]]].map(([a, b], i) => brush(off([a, b], S), 1.7, 'tick' + i, { t0: false, ease: 0.75 })).join(''), MARK);
    if (E.coil) { const s = []; for (let i = 0; i <= 40; i++) { const t = i / 40; s.push([71.4 + t * 8 + 1.6 * Math.cos(t * 15.5 + 1), 7 + 1.6 * Math.sin(t * 15.5 + 1)]); } sign(brush(s, 0.85, 'coil', { ease: 0.08, step: 0.55, at: S }), MARK); }
    if (E.talk) sign([[3, 0.95], [5.2, 0.85]].map(([r, w], i) => brush([-0.7, -0.23, 0.23, 0.7].map((a) => [66.8 + S[0] + r * Math.cos(a), 39.6 + S[1] + r * Math.sin(a)]), w * 1.2, 'talk' + i)).join(''), MARK);
    if (pose === 'handUp') sign([[[89.4, 22.4], [91, 26], [90.4, 29.8]], [[92.4, 20.2], [94.4, 25.6], [93.4, 31]]].map((p, i) => brush(off(p, S), 1.1, 'wave' + i)).join(''), MARK);
    if (E.sweat) { const dp = [[67.4, 16.4], [69.6, 20.6], [68.6, 22.8], [66.2, 22.4], [65.8, 20]]; const d = rough(dp, 'drop', { amp: 0.03, step: 0.4 }); g.push(`<path d="${d}" fill="${PAPER}" stroke="${PAPER}" stroke-width="1.6" stroke-linejoin="round"/>`, P(brush([...cr(dp, true, 4), dp[0]], 0.65, 'dropc', { t0: false, t1: false, min: 1 }), KEY)); }
    return g.length ? `<g class="marks">${g.join('')}</g>` : '';
  }

  // ---------- defs: a few reused screens, the grain
  const DEFS = `<pattern id="mgBlush" patternUnits="userSpaceOnUse" width=".95" height=".95" patternTransform="rotate(15)"><circle cx=".47" cy=".47" r=".3" fill="${BLUSH}"/></pattern>`
    + `<pattern id="mgMoon" patternUnits="userSpaceOnUse" width=".9" height=".9" patternTransform="rotate(15)"><circle cx=".45" cy=".45" r=".34" fill="${INK}"/></pattern>`
    + `<pattern id="mgShirt" patternUnits="userSpaceOnUse" width="1.05" height="1.05" patternTransform="rotate(75)"><circle cx=".52" cy=".52" r=".3" fill="${DARK}"/></pattern>`
    + `<pattern id="mgWall" patternUnits="userSpaceOnUse" width=".9" height=".9" patternTransform="rotate(75)"><circle cx=".45" cy=".45" r=".24" fill="${KEY}"/></pattern>`
    + `<filter id="mgGrain" x="0" y="0" width="100" height="75" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="2.1" numOctaves="1" seed="9"/><feColorMatrix values="0 0 0 0 .957 0 0 0 0 .918 0 0 0 0 .839 7 0 0 0 -4.7"/></filter>`;
  const need = { mgKnit: C.head === 'beanie' && !robot, mgShade: ['cap', 'bow'].includes(C.head), mgGlow: C.scene === 7 };
  if (need.mgKnit) staticDefs.push(`<pattern id="mgKnit" patternUnits="userSpaceOnUse" width=".8" height=".8" patternTransform="rotate(30)"><rect width=".8" height=".8" fill="${ACC}"/><circle cx=".4" cy=".4" r=".2" fill="${PAPER}"/></pattern>`);
  if (need.mgShade) staticDefs.push(`<pattern id="mgShade" patternUnits="userSpaceOnUse" width=".85" height=".85" patternTransform="rotate(75)"><circle cx=".42" cy=".42" r=".27" fill="${DARK}"/></pattern>`);
  if (need.mgGlow) staticDefs.push(`<pattern id="mgGlow1" patternUnits="userSpaceOnUse" width="1.1" height="1.1" patternTransform="rotate(15)"><circle cx=".55" cy=".55" r=".2" fill="${ACC}"/></pattern><pattern id="mgGlow2" patternUnits="userSpaceOnUse" width="1.1" height="1.1" patternTransform="rotate(15)"><circle cx=".55" cy=".55" r=".38" fill="${ACC}"/></pattern>`);

  const BODY = bodyLayer(), ROOM = roomLayer(), DESK = deskLayer(), EARS = robot ? '' : earsLayer(), HAT = headwear();
  function laptopLayer() {
    const st = []; for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? 1.3 : 3; st.push([50 + rr * Math.cos(a), 56 + rr * Math.sin(a)]); }
    return `<g class="props laptop"><path d="M33.6 63V51.4q0-1.8 1.8-1.8h29.2q1.8 0 1.8 1.8V63Z" fill="${PAPER}" stroke="${PAPER}" stroke-width="1.6" stroke-linejoin="round"/>${P(brush([[33.8, 62.8], [33.8, 50.4], [34.8, 49.6], [65.2, 49.6], [66.2, 50.4], [66.2, 62.8]], W.contour, 'lapl', { t0: false, t1: false, min: 1, step: 1.6 }), KEY)}${P(poly(off(st, S)), INK)}${P('M29.6 62.6H70.4V64.8H29.6Z', KEY)}</g>`;
  }
  const grainMask = (id, tilt) => {   // the grain is lighter on the hair and the city
    const hairMask = robot ? '' : `<g transform="rotate(${tilt} 50 50)">${U('mgHair', '#555', C.style === 'curls' ? H : Z)}${U('mgFringe', '#555')}</g>`;
    return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="75"><rect width="100" height="75" fill="#fff"/><g fill="#555">${(C.scene === 6 ? U('mgCity', '#555', H) : '') + hairMask}</g></mask>`;
  };
  const headOf = (faces) => {
    if (robot) return faces + HAT;
    const hc = hatClip ? ' clip-path="url(#mgHatC)"' : '';
    if (hatClip) extraDefs.push('<clipPath id="mgHatC"><rect y="13" width="100" height="62"/></clipPath>');
    return (hc ? `<g${hc}>${HS.back}</g>` : HS.back) + EARS + faces + (hc ? `<g${hc}>${HS.front}</g>` : HS.front) + HAT;
  };

  // The call's drawing: every face and every arm pose in one SVG, each in a group the page shows or hides from the tile's state
  // (data-f: the face and its marks, data-a: the arms, the laptop with the working ones). The head turns by CSS (.rtilt), the
  // body and the arms breathe together (.fig, the page's own clock), each eye blinks (.eye), the speaking mouth is the page's .mouthE.
  // Class names other than those hooks (written with a "!" here) are given an "r-" prefix by svg(), clear of the page's own classes.
  const LIVE = { listening: 'idle', speaking: 'gesture', focused: 'working', done: 'idle', needs: 'handUp', stuck: 'idle', waiting: 'waiting' };
  function live() {
    extraDefs.length = 0;
    const faces = [], marks = [], arms = [], clips = [];
    for (const k in LIVE) {
      faces.push(`<g data-f="${k}">${robot ? robotHead(EXPR[k], true) : faceLayer(EXPR[k], true)}</g>`);
      const m = marksLayer(EXPR[k], LIVE[k]); if (m) marks.push(`<g data-f="${k}">${m}</g>`);
    }
    for (const pose of ['idle', 'gesture', 'working', 'handUp', 'waiting']) { const a = armLayer(pose); clips.push(a.clips); arms.push(`<g data-a="${pose}">${a.svg}${pose === 'working' ? laptopLayer() : ''}</g>`); }
    const head = headOf(faces.join(''));
    return `<svg viewBox="0 0 100 75" preserveAspectRatio="xMidYMid slice" class="!rz"><defs>${DEFS}${robot ? '' : HS.defs}${R.city || ''}${robot ? '' : HS.frontDefs}${BODY.clip}${clips.join('')}${grainMask('mgGm', EXPR.listening.tilt)}${staticDefs.join('')}${[...new Set(extraDefs)].join('')}</defs>`
      + `<rect width="100" height="75" fill="${PAPER}"/>${ROOM}`
      + `<g class="!fig">${BODY.svg}<g class="head"><g class="!rtilt">${head}</g></g></g>`
      + `${DESK}${propLayer(true)}<g class="!fig">${arms.join('')}</g>${marks.join('')}`
      + `<rect class="grain" width="100" height="75" filter="url(#mgGrain)" mask="url(#mgGm)"/></svg>`;
  }

  function draw(exprK, pose) {
    const E = EXPR[exprK], arms = armLayer(pose), tilt = E.tilt || 0;
    const laptop = pose === 'working' ? laptopLayer() : '';
    extraDefs.length = 0;
    const headInner = headOf(robot ? robotHead(E) : faceLayer(E)), prop = propLayer(pose !== 'handUp');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 75" width="400" height="300"><defs>${DEFS}${robot ? '' : HS.defs}${R.city || ''}${robot ? '' : HS.frontDefs}${BODY.clip}${arms.clips}${grainMask('mgGm' + exprK + pose, tilt)}${staticDefs.join('')}${extraDefs.join('')}</defs>`
      + `<rect width="100" height="75" fill="${PAPER}"/>${ROOM}${BODY.svg}`
      + `<g class="head" data-pivot="50 50"><g transform="rotate(${tilt} 50 50)">${headInner}</g></g>`
      + `${DESK}${prop}${arms.svg}${laptop}${marksLayer(E, pose)}`
      + `<rect class="grain" width="100" height="75" filter="url(#mgGrain)" mask="url(#mgGm${exprK}${pose})"/></svg>`;
  }
  draw.live = live;
  return draw;
}

// ---------- the page's side: a persona of the call → its drawing (made once per agent, then copied with ids of its own per tile)
const kindOf = (p) => (p.id === 'main' ? 'lead' : p.id === 'user' ? 'user' : p.twin ? 'fork' : 'sub');
const made = new Map(), liveMem = new Map();
const drawerFor = (p) => { const k = kindOf(p) + '|' + p.id; let d = made.get(k); if (!d) { d = character(fromPersona(String(p.id), kindOf(p))); made.set(k, d); } return d; };
const hooks = (s) => s.replace(/class="([^"]*)"/g, (m, c) => 'class="' + c.split(/\s+/).map((x) => (x[0] === '!' ? x.slice(1) : x === 'pulse' ? x : 'r-' + x)).join(' ') + '"');
function svg(p, o, uid = '') {   // o: a still picture for the video export ({ m: 0 silent, 1 mouth closed, 2 open; working; done }), as avatarSVG takes it
  const d = drawerFor(p);
  if (o) return d(o.m === 2 ? 'speaking' : o.working ? 'focused' : o.done ? 'done' : 'listening', o.working ? 'working' : o.m ? 'gesture' : 'idle');
  const k = kindOf(p) + '|' + p.id; let s = liveMem.get(k); if (!s) { s = hooks(d.live()); liveMem.set(k, s); }
  const h = hashStr(String(p.id)), vars = `--d:${-((h % 45) / 10)}s;--bd:${4 + ((h >>> 4) % 15) / 10}s;--kd:${4 + ((h >>> 9) % 21) / 10}s`;   // its own breathing and blinking, as avatarSVG gives them
  return s.replace('<svg ', `<svg style="${vars}" `).replace(/id="/g, `id="${uid}`).replace(/(href="#|url\(#)/g, `$1${uid}`);
}

const api = { character, fromPersona, svg, INKS, KEYS, HAIR, STYLES, HEADWEAR, PROPS, EXPR, PAPER, mix, mul };
if (typeof module === 'object' && module.exports) module.exports = api; else root.RISO = api;
})(typeof window !== 'undefined' ? window : globalThis);
