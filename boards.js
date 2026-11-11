// Claude Whiteboards and Claude Sheets on the shared screen. Neither sends a page when it is made: a board keeps its content in its own store (the ArtifactData tool's writes) and a Sheet
// keeps its cells on Anthropic's server (the Claude Docs connector's applyEdits). The call cannot fetch either, and does not try: like the pages of other artifacts, each is put together again
// from what the session file holds, the writes of that session up to the one asked for, in order, those that were refused left out. The result is a still picture (no script runs in it),
// close to what the person saw on claude.ai at that moment: what someone else drew on the same board, or typed in the same Sheet, is not in this session's file and so not in the picture.
'use strict';
const fs = require('fs');

const LIVE_MAX = 32 * 1024 * 1024;   // a session file read further than this for one picture is not read whole: the picture is drawn from what was read
const memo = new Map();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const blocksOf = (r) => { const c = r && r.message && r.message.content; return Array.isArray(c) ? c : []; };
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n') : '');
const BOARD_WRITES = new Set(['set', 'update', 'delete', 'str_replace', 'batch']);
const boardDoc = (w) => !!w && (String(w.collection || '') === 'elements' || (String(w.collection || '') === 'board' && /^(meta|claim-[a-z0-9]{1,40})$/.test(String(w.doc_id || ''))));
const onBoard = (i) => (i.action === 'batch' ? Array.isArray(i.writes) && i.writes.some(boardDoc) : boardDoc(i));   // a Whiteboard keeps its content in board/meta and elements/<id>: another page's own database (a tracker, a sign-up sheet) is not a board
const docsTool = (name) => { const m = /^mcp__(.+?)__(update|read)$/.exec(name || ''); return m && /(^|_)Claude_Docs$/.test(m[1]) ? m[2] : ''; };

// What a call does to a board or a Sheet, or null: { key, kind: 'board' | 'sheet', op: 'write' | 'read' }. key: the board's address, or the Sheet's project in Claude Docs.
function liveCall(name, i) {
  if (!i || typeof i !== 'object') return null;
  if (name === 'ArtifactData' && BOARD_WRITES.has(i.action) && typeof i.url === 'string' && onBoard(i)) return { key: i.url, kind: 'board', op: 'write' };
  const d = docsTool(name), proj = i.container && typeof i.container.id === 'string' ? i.container.id : '', p = i.payload && typeof i.payload === 'object' ? i.payload : null;
  if (!d || !proj || i.engine !== 'workbook' || !p) return null;
  if (d === 'update' && p.kind === 'applyEdits' && Array.isArray(p.edits)) return { key: proj, kind: 'sheet', op: 'write' };
  if (d === 'read' && p.kind === 'readCells') return { key: proj, kind: 'sheet', op: 'read' };
  return null;
}

// One pass over the session file: the calls on the same board or Sheet as toolId, up to toolId's answer, each with whether it went through (and, for a read of cells, what they came to).
function collect(file, toolId) {
  const ops = [], byId = new Map(); let target = null, done = false, tail = false, fd, pos = 0, size = 0, carry = Buffer.alloc(0);
  const marks = [Buffer.from('"ArtifactData"'), Buffer.from('Claude_Docs__'), Buffer.from('"tool_result"')];
  try {
    fd = fs.openSync(file, 'r'); size = fs.fstatSync(fd).size;
    while (pos < size && pos < LIVE_MAX && !done) {
      const buf = Buffer.alloc(Math.min(8 * 1024 * 1024, size - pos)); fs.readSync(fd, buf, 0, buf.length, pos); pos += buf.length;
      const all = carry.length ? Buffer.concat([carry, buf]) : buf; let a = 0;
      for (let b; !done && (b = all.indexOf(10, a)) >= 0; a = b + 1) {
        const line = all.subarray(a, b);
        if (line.indexOf(marks[0]) < 0 && line.indexOf(marks[1]) < 0 && !(byId.size && line.indexOf(marks[2]) >= 0)) continue;
        let r; try { r = JSON.parse(line.toString('utf8')); } catch { continue; }
        for (const blk of blocksOf(r)) {
          if (blk.type === 'tool_use') { const c = liveCall(blk.name, blk.input); if (!c) continue;
            if (tail && (c.key !== target.key || c.op !== 'read')) { if (c.key === target.key) done = true; continue; }   /* after the write: only the reads of the same Sheet, up to its next write */
            const op = { id: blk.id, ...c, i: blk.input, ok: null }; ops.push(op); byId.set(blk.id, op); if (blk.id === toolId) target = op; }
          else if (blk.type === 'tool_result' && byId.has(blk.tool_use_id)) {
            const op = byId.get(blk.tool_use_id), text = textOf(blk.content);
            if (blk.is_error) op.ok = false;
            else if (op.kind === 'board') op.ok = !/\bnothing (was )?written\b|\brefused\b/i.test(text.slice(0, 400));
            else { const j = docsJson(text); op.ok = !!(j && j.verdict !== 'deny' && (op.op === 'read' ? j.value && j.value.rows : j.data && Number.isFinite(+j.data.revision))); if (op.ok && op.op === 'read') op.value = j.value; }
            byId.delete(blk.tool_use_id); if (blk.tool_use_id === toolId) { if (op.kind === 'sheet' && op.ok) tail = true; else done = true; }   /* a Sheet: what the formulas came to is told by a read that follows */
          }
        }
      }
      carry = Buffer.from(all.subarray(a));
    }
  } catch {} finally { if (fd != null) fs.closeSync(fd); }
  if (!target || target.op !== 'write' || !(done || tail) || !target.ok) return null;   // a write that was refused, or whose answer is not written yet, has no picture of its own
  return { kind: target.kind, ops: ops.filter((o) => o.key === target.key && o.kind === target.kind && o.ok), size };
}
function docsJson(text) {   // the connector's answer: a line that says it comes from others, then the JSON
  const s = text.indexOf('{"verdict"'); if (s < 0) return null;
  try { return JSON.parse(text.slice(s)); } catch {}
  try { return JSON.parse(text.slice(s, text.lastIndexOf('}') + 1)); } catch { return null; }
}

// ---- The board: its store, as the writes left it, then drawn as one SVG.
const DEL = (v) => v && typeof v === 'object' && v.__delete__ === true, BAD_KEY = new Set(['__proto__', 'constructor', 'prototype']);
const clean = (v) => JSON.parse(JSON.stringify(v), (k, x) => (BAD_KEY.has(k) ? undefined : x));   // a copy with no key that could reach a prototype: a session's records must not change the server's objects
function merge(into, data, depth = 0) {
  for (const [k, v] of Object.entries(data || {})) {
    if (BAD_KEY.has(k)) continue;
    if (DEL(v)) delete into[k];
    else if (depth < 40 && v && typeof v === 'object' && !Array.isArray(v) && into[k] && typeof into[k] === 'object' && !Array.isArray(into[k])) merge(into[k], v, depth + 1);
    else into[k] = v;
  }
  return into;
}
function boardStore(ops) {
  let room = 4e6;   // what str_replace may add to the board's texts in all: a board holds 2 MB
  const docs = new Map(), one = (w) => {
    if (!boardDoc(w)) return;   // only the board's own documents
    const key = String(w.collection || '') + '/' + String(w.doc_id || ''), data = w.data && typeof w.data === 'object' ? w.data : null;
    if (w.op === 'delete' || w.action === 'delete') docs.delete(key);
    else if ((w.op || w.action) === 'set' && data) docs.set(key, clean(data));
    else if ((w.op || w.action) === 'update' && data) docs.set(key, merge(docs.get(key) || {}, clean(data)));
    else if (w.action === 'str_replace' && docs.has(key) && !BAD_KEY.has(w.field)) { const d = docs.get(key), f = w.field; if (typeof d[f] === 'string' && typeof w.old_str === 'string' && w.old_str) { const n = w.replace_all ? d[f].split(w.old_str).length - 1 : 1, grows = String(w.new_str || '').length - w.old_str.length; if (d[f].length + n * grows <= 100000 && (grows <= 0 || (room -= n * grows) >= 0)) d[f] = w.replace_all ? d[f].split(w.old_str).join(w.new_str || '') : d[f].replace(w.old_str, () => w.new_str || ''); } }   /* a text that would grow past what a board holds is not grown (doubling it could end the process) */
  };
  for (const o of ops) { if (o.i.action === 'batch') for (const w of Array.isArray(o.i.writes) ? o.i.writes : []) one(w); else one(o.i); }
  return docs;
}
const FILL = { yellow: '#fff1b3', peach: '#ffd9bf', pink: '#ffd3e4', green: '#d3f2da', blue: '#d4e6ff', purple: '#e6dbff', white: '#ffffff' };
const INK = { ink: '#1f1f22', terracotta: '#c2613d', blue: '#2f6fdb', green: '#2e8b57', purple: '#7b4fd6' };
const HEX = /^#[0-9a-f]{6}$/i, fillOf = (c, dflt) => (HEX.test(c || '') ? c : FILL[c] || dflt), inkOf = (c) => (HEX.test(c || '') ? c : INK[c] || INK.ink);
const SIZE = { small: 14, body: 16, large: 28, title: 48, huge: 96 };
const num = (v, d = 0) => (Number.isFinite(+v) ? Math.max(-1e6, Math.min(1e6, +v)) : d);
function inline(t) {   // the few marks a board's text has: **bold**, *italic*, `code`, [label](link), and lists, on escaped text
  return String(t || '').slice(0, 4000).split('\n').map((ln) => {
    const li = /^(- |\d+\. )/.exec(ln), body = esc(li ? ln.slice(li[0].length) : ln)
      .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<u>$1</u>');
    return li ? `<div class="li">${li[0].trim() === '-' ? '•' : esc(li[0].trim())} ${body}</div>` : `<div>${body || '&nbsp;'}</div>`;
  }).join('');
}
const fo = (x, y, w, h, cls, style, html) => `<foreignObject x="${x}" y="${y}" width="${Math.max(1, w)}" height="${Math.max(1, h)}"><div xmlns="http://www.w3.org/1999/xhtml" class="${cls}" style="${style}">${html}</div></foreignObject>`;
function tableSize(el) {
  const cols = Object.entries(el.cols || {}).sort((a, b) => num(a[1] && a[1].at) - num(b[1] && b[1].at)).slice(0, 30).map(([k]) => k), rows = Object.values(el.rows || {}).filter((r) => r && typeof r === 'object').sort((a, b) => num(a.at) - num(b.at)).slice(0, 200);
  const widths = cols.map((c) => Math.min(320, Math.max(60, ...rows.map((r) => String(r[c] == null ? '' : r[c]).length * 8 + 24))));
  return { cols, rows, widths, w: widths.reduce((a, b) => a + b, 0), h: rows.length * 34 };
}
function drawBoard(docs) {
  const meta = docs.get('board/meta') || {}, els = new Map(); for (const [k, v] of docs) if (k.startsWith('elements/') && v && typeof v === 'object') els.set(k.slice(9), v);
  const order = (Array.isArray(meta.order) ? meta.order.filter((id) => els.has(id)) : []), ids = [...new Set([...order, ...els.keys()])].slice(0, 800);
  const box = new Map(); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; const grow = (x, y, w, h) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };
  for (const id of ids) {   // where each thing stands, for the arrows and the frame
    const e = els.get(id), x = num(e.x), y = num(e.y);
    if (e.type === 'text') { const s = SIZE[e.size] || 16, lines = String(e.text || '').split('\n'), w = e.wrap ? num(e.wrap, 300) : lines.reduce((m, l) => Math.max(m, l.length), 0) * s * 0.56 + 8, h = (e.wrap ? Math.ceil(String(e.text || '').length * s * 0.55 / w) + lines.length - 1 : lines.length) * s * 1.4; box.set(id, { x, y, w, h }); grow(x, y, w, h); }
    else if (e.type === 'table') { const t = tableSize(e); box.set(id, { x, y, w: t.w, h: t.h, t }); grow(x, y, t.w, t.h); }
    else if (e.type === 'link') { box.set(id, { x, y, w: 320, h: 56 }); grow(x, y, 320, 56); }
    else if (e.type === 'stroke') { const p = Array.isArray(e.points) ? e.points.slice(0, 8000).map((v) => num(v)) : []; for (let k = 0; k + 1 < p.length; k += 2) grow(x + p[k], y + p[k + 1], 1, 1); }
    else if (e.type !== 'arrow' && e.type !== 'sticker') { const w = num(e.w, 160), h = num(e.h, 80); box.set(id, { x, y, w, h }); grow(x, y - (e.type === 'container' ? 34 : 0), w, h + (e.type === 'container' ? 34 : 0)); }
  }
  if (!docs.has('board/meta') && !els.size) return null;   // nothing of a board: no picture (the call shows the artifact's card)
  if (x0 > x1) return page('board', esc(meta.title || ''), '<div class="empty">The board is empty so far.</div>');
  const out = [], P = 40;
  for (const id of ids) {
    const e = els.get(id), b = box.get(id), x = num(e.x), y = num(e.y);
    if (e.type === 'container') { out.push(`<rect x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="18" fill="${fillOf(e.color, '#f4f4f1')}" fill-opacity="${e.color ? 0.45 : 1}" stroke="#d9d9d3"/>`); if (e.text) out.push(fo(x, y - 34, b.w, 30, 'ct', '', inline(String(e.text).split('\n')[0]))); }
    else if (e.type === 'shape') {
      const w = b.w, h = b.h, fill = e.hollow ? 'none' : fillOf(e.color, FILL.green), st = e.stroke ? ` stroke="${inkOf(e.stroke)}" stroke-width="2"` : ' stroke="rgba(0,0,0,.08)"', k = e.kind;
      out.push(k === 'ellipse' ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${st}/>` : k === 'diamond' ? `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" fill="${fill}"${st}/>`
        : k === 'hexagon' ? `<polygon points="${x + w * 0.2},${y} ${x + w * 0.8},${y} ${x + w},${y + h / 2} ${x + w * 0.8},${y + h} ${x + w * 0.2},${y + h} ${x},${y + h / 2}" fill="${fill}"${st}/>`
        : k === 'parallelogram' ? `<polygon points="${x + w * 0.15},${y} ${x + w},${y} ${x + w * 0.85},${y + h} ${x},${y + h}" fill="${fill}"${st}/>`
        : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${k === 'pill' ? h / 2 : k === 'rect' ? 4 : 14}" fill="${fill}"${st}/>`);
      const inset = k === 'diamond' || k === 'ellipse' ? 0.18 : 0.04;
      if (e.text) out.push(fo(x + w * inset + 6, y + 4, w * (1 - 2 * inset) - 12, h - 8, 'sh', `font-size:${SIZE[e.size] || 15}px;text-align:${['left', 'right'].includes(e.textAlign) ? e.textAlign : 'center'};justify-content:${e.textAlign === 'left' ? 'flex-start' : e.textAlign === 'right' ? 'flex-end' : 'center'}`, inline(e.text)));
    }
    else if (e.type === 'note') { out.push(`<rect x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="6" fill="${FILL.yellow}" stroke="rgba(0,0,0,.08)"/>`); if (e.text) out.push(fo(x + 8, y + 6, b.w - 16, b.h - 12, 'sh', 'font-size:15px;text-align:left;justify-content:flex-start', inline(e.text))); }
    else if (e.type === 'text') out.push(fo(x, y, b.w + 40, b.h + 20, 'tx', `font-size:${SIZE[e.size] || 16}px;color:${inkOf(e.color)};${e.wrap ? '' : 'white-space:pre;'}text-align:${['center', 'right'].includes(e.textAlign) ? e.textAlign : 'left'};${e.size === 'title' || e.size === 'huge' ? 'font-weight:700;' : ''}`, inline(e.text)));
    else if (e.type === 'stroke') { const p = Array.isArray(e.points) ? e.points.slice(0, 8000).map((v) => num(v)) : [], pts = []; for (let k = 0; k + 1 < p.length; k += 2) pts.push(`${x + p[k]},${y + p[k + 1]}`); if (pts.length > 1) out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${inkOf(e.color)}" stroke-width="${Math.min(20, num(e.width, 3))}" stroke-linecap="round" stroke-linejoin="round"/>`); }
    else if (e.type === 'image') { const src = typeof e.src === 'string' && /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/.test(e.src) && e.src.length < 400000 ? e.src : ''; out.push(src ? `<image x="${x}" y="${y}" width="${b.w}" height="${b.h}" href="${esc(src)}" preserveAspectRatio="xMidYMid meet"/>` : `<rect x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="10" fill="#ececea"/>` + fo(x, y, b.w, b.h, 'sh muted', 'font-size:14px', 'picture')); }
    else if (e.type === 'html') { out.push(`<rect x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="10" fill="#fff" stroke="#cfcfca"/>`); const t = /<title>([^<]{1,80})<\/title>/i.exec(String(e.html || '')); out.push(fo(x, y, b.w, b.h, 'sh muted', 'font-size:14px', '▶ ' + esc(t ? t[1] : 'embed'))); }
    else if (e.type === 'link') { out.push(`<rect x="${x}" y="${y}" width="320" height="56" rx="12" fill="#fff" stroke="#cfcfca"/>`); out.push(fo(x + 14, y + 4, 292, 48, 'sh', 'font-size:15px;text-align:left;justify-content:flex-start', '↗ ' + esc(String(e.title || e.href || '').slice(0, 80)))); }
    else if (e.type === 'table') { const t = b.t; out.push(fo(x, y, t.w + 2, t.h + 2, 'tb', '', `<table>${t.rows.map((r, n) => `<tr>${t.cols.map((c, k) => `<${n ? 'td' : 'th'} style="width:${t.widths[k]}px">${inline(r[c] == null ? '' : String(r[c]).split('\n')[0])}</${n ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`)); }
  }
  const side = (bx, s) => (s === 'top' ? [bx.x + bx.w / 2, bx.y] : s === 'bottom' ? [bx.x + bx.w / 2, bx.y + bx.h] : s === 'left' ? [bx.x, bx.y + bx.h / 2] : [bx.x + bx.w, bx.y + bx.h / 2]);
  const end = (v, s, other) => {   // an end of an arrow: a point, or the middle of a side of what it joins (the side facing the other end when none is named)
    if (Array.isArray(v)) return { p: [num(v[0]), num(v[1])], s: '' };
    const bx = box.get(v); if (!bx) return null; if (s) return { p: side(bx, s), s };
    const o = other || [bx.x + bx.w + 100, bx.y], cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2, dx = o[0] - cx, dy = o[1] - cy;
    const f = Math.abs(dx) * bx.h > Math.abs(dy) * bx.w ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top'; return { p: side(bx, f), s: f };
  };
  const centre = (v) => (Array.isArray(v) ? [num(v[0]), num(v[1])] : box.has(v) ? [box.get(v).x + box.get(v).w / 2, box.get(v).y + box.get(v).h / 2] : null);
  for (const id of ids) {
    const e = els.get(id); if (e.type !== 'arrow') continue;
    const ca = centre(e.from), cb = centre(e.to); if (!ca || !cb) continue;
    const a = end(e.from, e.fromSide, cb), z = end(e.to, e.toSide, ca); if (!a || !z) continue;
    const [ax, ay] = a.p, [zx, zy] = z.p, flat = (s) => s === 'left' || s === 'right', pts = [[ax, ay]];
    if (Math.abs(ax - zx) > 2 && Math.abs(ay - zy) > 2) { if (flat(a.s || 'right')) { const mx = (ax + zx) / 2; pts.push([mx, ay], [mx, zy]); } else { const my = (ay + zy) / 2; pts.push([ax, my], [zx, my]); } }
    pts.push([zx, zy]);
    const heads = Array.isArray(e.heads) ? e.heads : e.head === 'both' ? ['arrow', 'arrow'] : e.head === 'none' ? ['none', 'none'] : ['none', 'arrow'], col = inkOf(e.color);
    out.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="2.2"${e.dash ? ' stroke-dasharray="7 6"' : ''}${heads[1] === 'arrow' ? ' marker-end="url(#ah)"' : ''}${heads[0] === 'arrow' ? ' marker-start="url(#ahs)"' : ''}/>`);
    if (e.label) { const m = pts[Math.floor((pts.length - 1) / 2)], n = pts[Math.floor((pts.length - 1) / 2) + 1] || m, lx = (m[0] + n[0]) / 2, ly = (m[1] + n[1]) / 2; out.push(fo(lx - 80, ly - 14, 160, 28, 'al', '', inline(String(e.label).split('\n')[0]))); }
  }
  const vb = [x0 - P, y0 - P, x1 - x0 + 2 * P, y1 - y0 + 2 * P].map((v) => Math.round(v));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" preserveAspectRatio="xMidYMin meet"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0L10,5L0,10z" fill="${INK.ink}"/></marker><marker id="ahs" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M10,0L0,5L10,10z" fill="${INK.ink}"/></marker></defs>${out.join('')}</svg>`;
  return page('board', esc(meta.title || ''), svg);
}

// ---- The Sheet: its sheets and cells as the edits left them, the values the reads gave the formulas, then the sheet edited last drawn as a grid.
const colNum = (s) => { let n = 0; for (const ch of String(s).toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
const colName = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const addr = (a) => { const m = /^([A-Z]{1,3})(\d{1,7})$/i.exec(String(a || '').trim()); return m ? [+m[2], colNum(m[1])] : null; };
function rangeOf(rg, sh) {   // "A1:C4", "B2", "3:4", "B:C" → [r0, c0, r1, c1], bounded by what the sheet holds
  const s = String(rg || '').trim(), [p, q = p] = s.split(':'), MAXR = Math.max(sh.maxR, 1), MAXC = Math.max(sh.maxC, 1);
  if (/^\d+$/.test(p) && /^\d+$/.test(q)) return [+p, 1, Math.min(+q, +p + 2000, R_MAX), Math.min(Math.max(MAXC + 5, 40), C_MAX)];   /* whole rows, whole columns: as far as the sheet holds anything, not the million rows of the Sheet */
  if (/^[A-Z]+$/i.test(p) && /^[A-Z]+$/i.test(q)) return [1, colNum(p), Math.min(Math.max(MAXR + 50, 400), R_MAX), Math.min(colNum(q), colNum(p) + 60, C_MAX)];
  const a = addr(p), b = addr(q) || a; if (!a) return null;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(Math.max(a[0], b[0]), a[0] + 2000), Math.min(Math.max(a[1], b[1]), a[1] + 60)];
}
const R_MAX = 2400, C_MAX = 240, inGrid = (r, c) => r >= 1 && c >= 1 && r <= R_MAX && c <= C_MAX;   // the picture shows 400 rows and 40 columns: what lies far past them is not kept
function sheetState(ops) {
  let budget = 400000; const spend = (n) => (budget -= n) > 0;   // one budget for the whole replay (cells written, formatted, moved, fitted, read): records made to be slow cost their own picture only
  const book = [], find = (n) => book.find((s) => s.name === n), mk = (name) => { const s = { name: String(name).slice(0, 100), cells: new Map(), fmt: new Map(), widths: new Map(), head: 0, maxR: 0, maxC: 0 }; book.push(s); return s; };
  let last = null; mk('Sheet1').phantom = true;   // a new Sheet starts with Sheet1; a Sheet made in another session is known only by the sheets its edits and reads name
  const named = (n, make) => { if (typeof n !== 'string' || !n) return null; let s = find(n); if (!s && make && book.length < 200) s = mk(n);   /* a workbook has 200 sheets at most */ if (s) s.phantom = false; return s; };
  const shift = (s, at, n, rows) => { if (!spend(s.cells.size + s.fmt.size)) return; for (const m of [s.cells, s.fmt]) { const moved = new Map(); for (const [k, v] of m) { const [r, c] = k.split(',').map(Number), key = rows ? (r >= at ? `${r + n},${c}` : n < 0 && r >= at + n ? null : k) : c >= at ? `${r},${c + n}` : n < 0 && c >= at + n ? null : k;   /* a delete: what lay in the deleted rows goes, what lay after moves up */ if (key) moved.set(key, v); } m.clear(); for (const [k, v] of moved) m.set(k, v); } };
  for (const o of ops) {
    if (o.op === 'read') { const v = o.value, rg = v && typeof v.range === 'string' ? addr(v.range.split(':')[0]) : null, s = rg && v.rows && typeof v.rows === 'object' ? named(v.sheet, true) : null; if (!s) continue;
      for (const [rn, row] of Object.entries(v.rows).slice(0, 5000)) if (Array.isArray(row) && +rn > 0 && spend(row.length)) row.slice(0, 200).forEach((cell, k) => { const key = `${+rn},${rg[1] + k}`, mine = s.cells.get(key); if (cell == null || !inGrid(+rn, rg[1] + k)) return;
        if (!s.cells.has(key)) { s.cells.set(key, cell); s.maxR = Math.max(s.maxR, +rn); s.maxC = Math.max(s.maxC, rg[1] + k); }   /* what a read shows of cells this session did not write */
        else if (typeof cell === 'object' && 'formula' in cell && typeof mine === 'string' && mine.trim().toUpperCase() === String(cell.formula).trim().toUpperCase()) s.cells.set(key, { formula: mine, value: cell.value }); });
      continue; }
    for (const e of o.i.payload.edits.slice(0, 64)) {
      if (budget <= 0) break; if (!e || typeof e !== 'object') continue; const s = named(e.sheet, e.kind !== 'deleteSheet' && e.kind !== 'restoreSheet');
      if (e.kind === 'renameSheet' && s && typeof e.name === 'string') { s.name = e.name.slice(0, 100); last = s; }
      else if (e.kind === 'addSheet' && typeof e.name === 'string' && !find(e.name)) last = named(e.name, true) || last;
      else if (e.kind === 'deleteSheet' && s) { book.splice(book.indexOf(s), 1); if (last === s) last = null; }
      else if (e.kind === 'restoreSheet' && typeof e.sheet === 'string' && !find(e.name || e.sheet)) last = named(e.name || e.sheet, true) || last;
      else if (e.kind === 'writeCells' && s && Array.isArray(e.rows)) { const a = addr(e.topLeft); if (!a) continue; last = s;
        e.rows.slice(0, 5000).forEach((row, i) => Array.isArray(row) && spend(row.length) && row.slice(0, 200).forEach((v, k) => { const key = `${a[0] + i},${a[1] + k}`; if (!inGrid(a[0] + i, a[1] + k)) return; if (v == null) s.cells.delete(key); else { s.cells.set(key, v); s.maxR = Math.max(s.maxR, a[0] + i); s.maxC = Math.max(s.maxC, a[1] + k); } })); }
      else if (e.kind === 'formatCells' && s && Array.isArray(e.ranges) && e.format) { last = s; const f = e.format, look = {}; if (f.font && typeof f.font.bold === 'boolean') look.b = f.font.bold; if (f.font && typeof f.font.italic === 'boolean') look.i = f.font.italic; if (f.fillColor && HEX.test(f.fillColor.hex || '')) look.fill = f.fillColor.hex; if (f.fillColor && f.fillColor.kind === 'none') look.fill = '';
        if (Object.keys(look).length) for (const rg of e.ranges.slice(0, 40)) { const R = rangeOf(rg, s); if (R) for (let r = R[0]; r <= Math.min(R[2], R_MAX) && budget > 0; r++) for (let c = R[1]; c <= Math.min(R[3], C_MAX) && budget-- > 0; c++) s.fmt.set(`${r},${c}`, { ...(s.fmt.get(`${r},${c}`) || {}), ...look }); } }
      else if (e.kind === 'setColumnWidths' && s && typeof e.columns === 'string') { const [p, q = p] = e.columns.split(':'); for (let c = colNum(p); c <= colNum(q) && c < colNum(p) + 200; c++) s.widths.set(c, Math.max(20, Math.min(800, num(e.widthInPixels, 104)))); }
      else if (e.kind === 'fitColumns' && s && typeof e.columns === 'string') { const [p, q = p] = e.columns.split(':'); for (let c = colNum(p); c <= colNum(q) && c < colNum(p) + 200 && spend(s.maxR); c++) { let w = 40; for (let r = 1; r <= Math.min(s.maxR, 2000); r++) { const v = s.cells.get(`${r},${c}`); if (v != null && !(typeof v === 'string' && v.length > 60 && !s.cells.has(`${r},${c + 1}`))) w = Math.max(w, (typeof v === 'string' && v[0] === '=' ? 8 : cellText(v).t.length) * 7.4 + 18);   /* a formula: what it comes to, most often a short number */ } s.widths.set(c, Math.min(360, Math.round(w))); } }
      else if (e.kind === 'setCellTable' && s) s.head = e.cellTable && e.cellTable.headerRows ? +String(e.cellTable.headerRows).split(':').pop() || 0 : 0;
      else if ((e.kind === 'insertRows' || e.kind === 'insertColumns') && s) { const n = Math.min(1000, num(e.count, 1)), at = e.kind === 'insertRows' ? num(e.besideRow) + (e.side === 'below' ? 1 : 0) : colNum(e.besideColumn) + (e.side === 'right' ? 1 : 0); shift(s, at, n, e.kind === 'insertRows'); if (e.kind === 'insertRows') s.maxR += n; else s.maxC += n; last = s; }
      else if ((e.kind === 'deleteRows' || e.kind === 'deleteColumns') && s) { const [p, q = p] = String(e.rows || e.columns || '').split(':'), rows = e.kind === 'deleteRows', a = rows ? +p : colNum(p), b = rows ? +q : colNum(q); if (a > 0 && b >= a) { shift(s, b + 1, -(b - a + 1), rows); last = s; } }
    }
  }
  const shown = book.filter((x) => !x.phantom);
  return { book: shown, last: last && shown.includes(last) ? last : shown[0] || null };
}
function cellText(v) {   // what a cell shows, as far as the session knows it: a formula it never read shows as written
  if (v == null) return { t: '' };
  if (typeof v === 'number') return { t: v.toLocaleString('en-US', { maximumFractionDigits: 6 }), n: 1 };
  if (typeof v === 'boolean') return { t: v ? '☑' : '☐', c: 1 };
  if (typeof v === 'string') { if (/^=/.test(v)) return { t: v, f: 1 }; if (/^'/.test(v)) return { t: v.slice(1) }; return /^[-+]?[\d,]*\.?\d+%?$|^[$€£]\s?[\d,.]+$/.test(v.trim()) ? { t: v, n: 1 } : /^\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?$/i.test(v.trim()) ? { t: v, n: 1 } : { t: v }; }
  if (Array.isArray(v)) return { t: v.map((x) => (x && x.name) || '').join(', ') };
  if (typeof v === 'object') {
    if ('formula' in v) { const r = cellText(v.value); return r.t === '' && v.value == null ? { t: String(v.formula), f: 1 } : r; }
    if ('error' in v) return { t: String(v.error), c: 1 };
    if ('shown' in v) return { t: String(v.shown), n: 1 }; if ('date' in v) return { t: String(v.date), n: 1 }; if ('time' in v) return { t: String(v.time).replace(/:00$/, ''), n: 1 }; if ('dateTime' in v) return { t: String(v.dateTime).replace('T', ' ').replace(/:00$/, ''), n: 1 };
    if ('markdown' in v) return { t: String(v.markdown).replace(/\*\*|~~|<\/?u>|\\/g, '').replace(/(^|[^*])\*([^*]+)\*/g, '$1$2').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') };
    if ('name' in v) return { t: String(v.name) };
  }
  return { t: '' };
}
function drawSheet(st) {
  const s = st.last; if (!s) return null;   // no sheet any edit named: no picture (the call shows the artifact's card)
  const R = Math.min(Math.max(s.maxR, 12), 400), C = Math.min(Math.max(s.maxC, 6), 40), head = [`<tr><th class="corner"></th>${Array.from({ length: C }, (_, k) => `<th style="width:${s.widths.get(k + 1) || 104}px">${colName(k + 1)}</th>`).join('')}</tr>`];
  for (let r = 1; r <= R; r++) {
    const tds = []; for (let c = 1; c <= C; c++) { const v = cellText(s.cells.get(`${r},${c}`)); let span = 1; if (v.t && !v.n && !v.c) while (c + span <= C && span < 16 && !s.cells.has(`${r},${c + span}`) && v.t.length * 7.2 > Array.from({ length: span }, (_, k) => s.widths.get(c + k) || 104).reduce((x, y) => x + y, 0)) span++;   /* text runs on over the empty cells beside it, as in the Sheet */
      const f = s.fmt.get(`${r},${c}`) || {}, cls = [v.n ? 'n' : '', v.c ? 'c' : '', v.f ? 'f' : '', r === s.head ? 'h' : ''].filter(Boolean).join(' '), sty = (f.fill ? `background:${f.fill};` : '') + (f.b ? 'font-weight:700;' : '') + (f.i ? 'font-style:italic;' : '');
      tds.push(`<td${span > 1 ? ` colspan="${span}"` : ''}${cls ? ` class="${cls}"` : ''}${sty ? ` style="${sty}"` : ''}>${esc(v.t.slice(0, 400))}</td>`); c += span - 1; }
    head.push(`<tr><th>${r}</th>${tds.join('')}</tr>`);
  }
  const tabs = st.book.slice(0, 30).map((x) => `<span class="${x === s ? 'on' : ''}">${esc(x.name)}</span>`).join('');
  const tw = 38 + Array.from({ length: C }, (_, k) => s.widths.get(k + 1) || 104).reduce((x, y) => x + y, 0);
  return page('sheet', '', `<div class="grid"><table style="width:${tw}px">${head.join('')}</table></div><div class="tabs">${tabs}</div>`);
}

const STYLE = {
  board: 'html,body{margin:0;background:#fbfbf8;font:15px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f1f22}svg{display:block;width:100%;height:auto;max-height:100vh}.sh{height:100%;display:flex;flex-direction:column;justify-content:center;overflow:hidden;line-height:1.3}.sh>div{width:100%}.tx{line-height:1.4}.ct{font-weight:600;font-size:16px;color:#55554f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.al{font-size:13px;text-align:center;background:#fbfbf8;border-radius:6px}.muted{color:#8a8a84}.li{padding-left:2px}code{font:13px ui-monospace,Menlo,monospace;background:rgba(0,0,0,.06);padding:0 3px;border-radius:3px}.tb table{border-collapse:collapse;background:#fff;font-size:14px}.tb th,.tb td{border:1px solid #deded8;padding:6px 10px;text-align:left;height:21px;overflow:hidden;white-space:nowrap}.tb th{background:#f1f1ed}.empty{padding:80px;text-align:center;color:#8a8a84}',
  sheet: 'html,body{margin:0;height:100%;background:#fff;font:13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f1f22}body{display:flex;flex-direction:column}.grid{flex:1;overflow:auto}table{border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #e3e3e0;height:27px;padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:800px}th{background:#f6f6f4;color:#77776f;font-weight:500;position:sticky;top:0;z-index:1}th.corner{width:38px}tr th:first-child{position:sticky;left:0;text-align:center;z-index:2}th.corner{z-index:3}td.n{text-align:right;font-variant-numeric:tabular-nums}td.c{text-align:center}td.f{color:#8a8a84;font-style:italic}td.h{font-weight:600}.tabs{display:flex;gap:2px;padding:6px 8px 8px;background:#f6f6f4;border-top:1px solid #e3e3e0}.tabs span{padding:5px 12px;border-radius:6px;color:#66665f}.tabs span.on{background:#fff;color:#1f1f22;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12)}.empty{padding:80px;text-align:center;color:#8a8a84}',
};
const page = (kind, title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${title ? `<title>${title}</title>` : ''}<style>${STYLE[kind]}</style>${body}`;

// The picture of the board or the Sheet as the write toolId left it, or null (not such a write, refused, or not answered yet).
function livePage(file, toolId) {
  let size = 0; try { size = fs.statSync(file).size; } catch { return null; }
  const key = file + '|' + toolId, hit = memo.get(key); if (hit && hit.size === size) return hit.page;
  let html = null; const got = collect(file, toolId);
  try { html = got ? (got.kind === 'board' ? drawBoard(boardStore(got.ops.filter((o) => o.op === 'write'))) : drawSheet(sheetState(got.ops))) : null; } catch { html = null; }   // records too odd to draw cost that picture only
  const out = html ? { html, net: false } : null;
  memo.delete(key); memo.set(key, { size, page: out }); if (memo.size > 24) memo.delete(memo.keys().next().value);
  return out;
}
module.exports = { liveCall, livePage, _draw: { board: (ops) => drawBoard(boardStore(ops)), sheet: (ops) => drawSheet(sheetState(ops)) } };
