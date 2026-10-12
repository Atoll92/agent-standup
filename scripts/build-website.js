// Builds the website of Agent Standup into website/dist/ (ignored by git; the host runs this at each deployment, see vercel.json).
//   npm run website        then open website/dist/index.html, or serve the folder
// It is a site of its own, beside the landing page in docs/ (GitHub Pages), which this script never touches.
// Sources: website/src/home.html and style.css, website/static/ (fonts, recorded media), the logo files of the app, and PRIVACY.md and TRADEMARKS.md for two plain pages.
// website/site.json: "url" is the address the site answers on (for the canonical link and the link preview); "waitlist" is the address of a form
// that takes an email, and the "For teams" section stays out of the page while it is empty.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), src = path.join(root, 'website'), dist = path.join(src, 'dist');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8'), write = (rel, s) => { fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true }); fs.writeFileSync(path.join(dist, rel), s); };
const copy = (from, rel) => { fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true }); fs.copyFileSync(path.join(root, from), path.join(dist, rel)); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const version = JSON.parse(read('package.json')).version, conf = JSON.parse(read('website/site.json'));
const site = String(conf.url || '').replace(/\/?$/, '/'), waitlist = /^https:\/\//.test(conf.waitlist || '') ? conf.waitlist : '';
if (!/^https:\/\/[^/]+\/$/.test(site)) throw new Error('website/site.json: "url" must be the https address of the site');

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(src, 'static'), dist, { recursive: true });
copy('website/src/style.css', 'style.css');
copy('media/icon.png', 'brand/icon.png'); copy('public/favicon.svg', 'brand/favicon.svg'); copy('brand/team-strip.svg', 'brand/team-strip.svg'); copy('docs/media/social.jpg', 'brand/social.jpg');

let home = read('website/src/home.html');
home = waitlist ? home.replace(/<!--\/?WAITLIST-->\n?/g, '').replace(/__WAITLIST__/g, () => esc(waitlist)) : home.replace(/<!--WAITLIST-->[\s\S]*?<!--\/WAITLIST-->\n?/, '');
write('index.html', home.replace(/__VERSION__/g, version).replace(/__SITE__/g, site));

// ---- two plain pages. Just enough Markdown for what those files use: titles, paragraphs, lists, one table, bold, code, links.
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>').replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,])/g, '$1<a href="$2" rel="noopener">$2</a>');
function markdown(md) {
  const out = [], lines = md.split('\n'), cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,3}) (.+)$/.exec(l); if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^- /.test(l)) { const li = []; while (i < lines.length && /^- /.test(lines[i])) li.push('<li>' + inline(lines[i++].slice(2)) + '</li>'); out.push('<ul>' + li.join('') + '</ul>'); continue; }
    if (/^\|/.test(l) && /^\|[\s:|-]+\|$/.test((lines[i + 1] || '').trim())) { const head = cells(l), rows = []; i += 2; while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++])); out.push('<div class="tbl"><table><thead><tr>' + head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>'); continue; }
    const p = []; while (i < lines.length && lines[i].trim() && !/^(#{1,3} |- |\|)/.test(lines[i])) p.push(lines[i++]); out.push('<p>' + inline(p.join(' ')) + '</p>');
  }
  return out.join('\n');
}
const page = (file, slug, title, about) => write(`${slug}/index.html`, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Agent Standup</title>
<meta name="description" content="${esc(about)}">
<meta name="theme-color" content="#0e2328">
<link rel="canonical" href="${site}${slug}/">
<link rel="icon" href="../brand/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../style.css">
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="brand" href="../"><img src="../brand/icon.png" alt="" width="36" height="36"> Agent Standup</a>
    <nav><a href="../">Home</a><a href="https://github.com/Atoll92/agent-standup" rel="noopener">GitHub</a></nav>
  </header>
  <main class="doc">
    <h1>${esc(title)}</h1>
${markdown(read(file).replace(/^# .+\n/, ''))}
  </main>
</div>
<footer><div class="wrap"><nav><a href="../">Agent Standup</a><a href="../privacy/">Privacy</a><a href="../name-and-logo/">Name and logo</a><a href="https://github.com/Atoll92/agent-standup" rel="noopener">GitHub</a></nav></div></footer>
</body>
</html>
`);
page('PRIVACY.md', 'privacy', 'Privacy', 'What Agent Standup reads, what it keeps on your computer, and what can leave it.');
page('TRADEMARKS.md', 'name-and-logo', 'Name and logo', 'The code of Agent Standup is MIT licensed. What you may and may not do with its name, its logo and its characters.');
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site}sitemap.xml\n`);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['', 'privacy/', 'name-and-logo/'].map((p) => `  <url><loc>${site}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`website built for ${site} in website/dist (v${version}, ${(size(dist) / 1048576).toFixed(1)} MB${waitlist ? ', waitlist on' : ', no waitlist form yet'})`);
