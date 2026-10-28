// Renders the brand sources (brand/*.svg) into the files the extension, the desktop app, the page and the site use:
//   media/icon.png (store icon) · plugin/.claude-plugin/icon.png (plugin listing) · media/icon.svg (side bar glyph) · media/tray.png + tray@2x.png (desktop tray) · public/icon.svg + public/favicon.svg (header, browser tab)
//   desktop/icon.ico · desktop/icon.icns (macOS only: needs iconutil) · docs/media/social.jpg (link preview) · docs/media/banner.png (README header) · docs/media/install-*.png (README install buttons)
//   npm run brand        needs puppeteer-core and a Chrome (CHROME_PATH), and the network for the two fonts of the banners
// Three drawings of the icon: icon.svg down to 48 px, icon-32.svg for 20 to 40 px, icon-16.svg below.
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const root = path.join(__dirname, '..'), B = (f) => path.join(root, 'brand', f), src = (f) => fs.readFileSync(B(f), 'utf8');
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('no Chrome found (set CHROME_PATH)'); process.exit(1); }
const sized = (svg) => svg.replace('<svg ', '<svg width="64" height="64" ');   // some browsers only draw an SVG onto a canvas (the tab icon with its red dot) when it states a size
const pick = (n) => (n <= 18 ? 'icon-16.svg' : n <= 40 ? 'icon-32.svg' : 'icon.svg');
const out = (rel, data) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), data); console.log('  ' + rel + '  ' + (data.length / 1024).toFixed(1) + ' KB'); };

function dib(n, rgba) {   // one .ico picture under 256 px: a 32-bit bitmap, rows bottom-up, then an empty 1-bit mask
  const mask = Math.ceil(n / 32) * 4 * n, b = Buffer.alloc(40 + n * n * 4 + mask);
  b.writeUInt32LE(40, 0); b.writeInt32LE(n, 4); b.writeInt32LE(n * 2, 8); b.writeUInt16LE(1, 12); b.writeUInt16LE(32, 14); b.writeUInt32LE(n * n * 4 + mask, 20);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const s = (y * n + x) * 4, d = 40 + ((n - 1 - y) * n + x) * 4; b[d] = rgba[s + 2]; b[d + 1] = rgba[s + 1]; b[d + 2] = rgba[s]; b[d + 3] = rgba[s + 3]; }
  return b;
}
function ico(pics) {   // pics: [{ n, png, rgba }], 256 px stored as PNG, the smaller ones as bitmaps
  const data = pics.map((p) => (p.n >= 256 ? p.png : dib(p.n, p.rgba))), head = Buffer.alloc(6 + 16 * pics.length); let at = head.length;
  head.writeUInt16LE(1, 2); head.writeUInt16LE(pics.length, 4);
  pics.forEach((p, i) => { const o = 6 + 16 * i; head[o] = p.n >= 256 ? 0 : p.n; head[o + 1] = p.n >= 256 ? 0 : p.n; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(data[i].length, o + 8); head.writeUInt32LE(at, o + 12); at += data[i].length; });
  return Buffer.concat([head, ...data]);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] }), page = await browser.newPage();
  await page.goto('about:blank');
  // an icon drawing at n × n pixels; inset (0 to 1) leaves that share of the square empty all round, as macOS icons do
  const draw = async (file, n, inset = 0, edit = (svg) => svg) => {
    const r = await page.evaluate(async (svg, n, inset) => {
      const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await im.decode();
      const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'), o = Math.round(n * inset); g.imageSmoothingQuality = 'high'; g.drawImage(im, o, o, n - 2 * o, n - 2 * o);
      return { png: c.toDataURL('image/png').split(',')[1], rgba: Array.from(g.getImageData(0, 0, n, n).data) };
    }, edit(src(file)), n, inset);
    return { n, png: Buffer.from(r.png, 'base64'), rgba: r.rgba };
  };
  console.log('icons');
  out('media/icon.png', (await draw('icon.svg', 256)).png);
  out('plugin/.claude-plugin/icon.png', (await draw('icon.svg', 1024, 0, (svg) => svg.replace('rx="230"', 'rx="0"'))).png);   // the listing icon of the Claude Code plugin: a full square, the directory rounds it itself
  out('media/tray.png', (await draw(pick(18), 18)).png); out('media/tray@2x.png', (await draw(pick(36), 36)).png);
  out('media/icon.svg', src('glyph.svg')); out('public/icon.svg', sized(src('icon-32.svg'))); out('public/favicon.svg', sized(src('icon-16.svg')));
  out('desktop/icon.ico', ico(await Promise.all([256, 64, 48, 32, 24, 16].map((n) => draw(pick(n), n)))));
  if (process.platform === 'darwin') {
    const set = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'as-icns-')), 'icon.iconset'); fs.mkdirSync(set);
    for (const [pt, k] of [[16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2], [256, 1], [256, 2], [512, 1], [512, 2]]) fs.writeFileSync(path.join(set, `icon_${pt}x${pt}${k === 2 ? '@2x' : ''}.png`), (await draw(pick(pt * k), pt * k, 100 / 1024)).png);
    const icns = path.join(path.dirname(set), 'icon.icns'); execFileSync('iconutil', ['-c', 'icns', set, '-o', icns]); out('desktop/icon.icns', fs.readFileSync(icns)); fs.rmSync(path.dirname(set), { recursive: true, force: true });
  } else console.log('  desktop/icon.icns skipped (needs macOS)');

  console.log('banners');
  const banner = async (file, w, h, scale, type) => {   // the banners carry text in Gabarito and Figtree: the fonts must really be there, or the picture is refused. file: a brand/ file, or the SVG itself
    const svg = file.startsWith('<svg') ? file : src(file), [, sw, sh] = svg.match(/<svg[^>]*width="(\d+)" height="(\d+)"/).map(Number), k = Math.max(w / sw, h / sh);
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
    await page.setContent(`<!doctype html><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Figtree:wght@500;600&family=Gabarito:wght@800&display=swap" rel="stylesheet"><body style="margin:0;overflow:hidden"><div style="width:${sw * k}px;height:${sh * k}px;margin:${(h - sh * k) / 2}px 0 0 ${(w - sw * k) / 2}px">${svg.replace(/<svg([^>]*) width="\d+" height="\d+"/, '<svg$1 width="100%" height="100%"')}</div>`, { waitUntil: 'load' });
    const ok = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('800 20px Gabarito') && document.fonts.check('600 20px Figtree') && [...document.fonts].some((f) => f.status === 'loaded'); });
    if (!ok) throw new Error('the fonts did not load (network?): ' + file + ' not written');
    const shot = await page.screenshot(type === 'jpeg' ? { type: 'jpeg', quality: 90 } : { type: 'png', omitBackground: type === 'clear' }); await page.close(); return shot;
  };
  out('docs/media/social.jpg', await banner('link-preview.svg', 1200, 630, 1, 'jpeg'));
  out('docs/media/banner.png', await banner('readme-banner.svg', 1280, 320, 2, 'png'));

  console.log('README install buttons');
  // one big button for VS Code (the app icon on the lead's peach), two smaller teal ones under it; drawn at their size in the README, rendered at 2x
  const button = ({ w, h, bg, fg, title, sub, size, icon, arrow }) => {
    const pad = h * 0.22, tx = icon ? h : pad * 1.2, cx = w - h / 2, cy = h / 2, r = h * 0.21, a = r * 0.45;
    const glyph = arrow === 'down' ? `M${cx} ${cy - a * 1.15}v${a * 2.1}M${cx - a} ${cy + a * 0.05}l${a} ${a}l${a} ${-a}` : `M${cx - a * 1.15} ${cy}h${a * 2.1}M${cx - a * 0.05} ${cy - a}l${a} ${a}l${-a} ${a}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x=".75" y=".75" width="${w - 1.5}" height="${h - 1.5}" rx="${h * 0.25}" fill="${bg}" stroke="#F6F2EA" stroke-opacity=".22" stroke-width="1.5"/>`
      + (icon ? src('icon.svg').replace('<svg ', `<svg x="${pad}" y="${pad}" width="${h - 2 * pad}" height="${h - 2 * pad}" `) : '')
      + `<text x="${tx}" y="${h * 0.52}" font-family="Gabarito" font-weight="800" font-size="${size}" fill="${fg}">${title}</text><text x="${tx}" y="${h * 0.79}" font-family="Figtree" font-weight="600" font-size="${size * 0.54}" fill="${fg}" fill-opacity=".78">${sub}</text>`
      + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fg}"/><path d="${glyph}" fill="none" stroke="${bg}" stroke-width="${r * 0.2}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };
  const teal = { h: 56, bg: '#18444F', fg: '#F6F2EA', size: 20 };
  out('docs/media/install-vscode.png', await banner(button({ w: 380, h: 76, bg: '#E8845F', fg: '#2C2F40', size: 27, icon: true, title: 'Install in VS Code', sub: 'Free and open source' }), 380, 76, 2, 'clear'));
  out('docs/media/install-openvsx.png', await banner(button({ ...teal, w: 260, title: 'Cursor · Windsurf', sub: 'and VSCodium: from Open VSX' }), 260, 56, 2, 'clear'));
  out('docs/media/install-macos.png', await banner(button({ ...teal, w: 260, arrow: 'down', title: 'macOS app', sub: 'Free download, no editor needed' }), 260, 56, 2, 'clear'));
  await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
