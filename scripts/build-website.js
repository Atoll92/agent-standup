// Builds the website of Agent Standup into website/dist/ (ignored by git; the host runs this at each deployment, see vercel.json).
//   npm run website        then open website/dist/index.html, or serve the folder
// It is a site of its own, beside the landing page in docs/ (GitHub Pages), which this script never touches.
// Sources: website/src/home.html, shop.html and style.css, website/locales/ (the languages other than English and French), website/static/ (fonts, recorded media), the logo files of the app, and PRIVACY.md and TRADEMARKS.md for two plain pages.
// website/site.json: "url" is the address the site answers on (for the canonical link and the link preview); "waitlist" is the address of a form
// that takes an email, and the "For teams" section stays out of the page while it is empty.
const fs = require('fs'), path = require('path');
const { LANGS, COPY, decode, load } = require('./site-locales.js');
const supporters = require('./supporters.js');
const root = path.join(__dirname, '..'), src = path.join(root, 'website'), dist = path.join(src, 'dist');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8'), write = (rel, s) => { fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true }); fs.writeFileSync(path.join(dist, rel), s); };
const copy = (from, rel) => { fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true }); fs.copyFileSync(path.join(root, from), path.join(dist, rel)); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const version = JSON.parse(read('package.json')).version, conf = JSON.parse(read('website/site.json'));
const site = String(conf.url || '').replace(/\/?$/, '/'), waitlist = /^https:\/\//.test(conf.waitlist || '') ? conf.waitlist : '';
// "halloweenVideo": the YouTube id of the Halloween pack's video. While it is empty, the hero and the shop show its picture as a link to the shop instead of a video
const hwVideo = /^[\w-]{6,20}$/.test(conf.halloweenVideo || '') ? conf.halloweenVideo : '';
const hwPin = (html) => (hwVideo ? html.replace(/<!--HWSHOP-->[\s\S]*?<!--\/HWSHOP-->\n?/g, '').replace(/<!--\/?HWVIDEO-->/g, '').replace(/__HALLOWEEN_YT__/g, hwVideo) : html.replace(/<!--HWVIDEO-->[\s\S]*?<!--\/HWVIDEO-->\n?/g, '').replace(/<!--\/?HWSHOP-->/g, ''));
if (!/^https:\/\/[^/]+\/$/.test(site)) throw new Error('website/site.json: "url" must be the https address of the site');
// Visits are counted by the host (Vercel Web Analytics, switched on in the project's settings; no cookie, see PRIVACY.md). This is the tag Vercel gives for a plain HTML site,
// which is all its npm package adds. Only on the site's own address, so not on a preview or a copy opened from a folder, and not for a browser that sends Do Not Track.
// The buttons and links people click, counted by name with Vercel custom events (Pro plan): which way of installing, which download, from which part of the page.
// It runs only where the visit itself is counted (this host, no Do Not Track), and sends the name of the button, the part of the page and a short detail, nothing else.
function trackClicks() {
  const what = (el) => {
    if (el.matches('button[data-copy]')) return ['Copy command', el.getAttribute('data-copy').split(' ').slice(0, 2).join(' ')];
    const u = new URL(el.getAttribute('href') || '', location.href);
    if (u.origin === location.origin) {
      if (u.pathname === location.pathname && u.hash) return ['Jump', u.hash];
      const p = u.pathname.replace(/^\/[a-z]{2}(-[a-z]{2,4})?\//i, '/');
      return /^\/shop\//.test(p) ? ['Shop', u.searchParams.get('ref') || ''] : /^\/(claude-code-subagents|codex-sessions|mistral-vibe-sessions|claude-code-session-files)\//.test(p) ? ['Guide', p.split('/')[1]] : null;
    }
    if (/marketplace\.visualstudio\.com$/.test(u.hostname)) return ['Install VS Code', ''];
    if (/open-vsx\.org$/.test(u.hostname)) return ['Install Open VSX', ''];
    if (/github\.com$/.test(u.hostname)) {
      const f = /\/releases\/(?:latest\/)?download\/(?:[^/]+\/)?([^/]+)$/.exec(u.pathname);
      if (f) return ['Download', /mac-apple/.test(f[1]) ? 'Mac Apple silicon' : /mac-intel/.test(f[1]) ? 'Mac Intel' : /windows/.test(f[1]) ? 'Windows' : /linux/.test(f[1]) ? 'Linux' : /\.vsix$/.test(f[1]) ? 'vsix' : f[1].slice(0, 40)];
      return ['GitHub', /\/releases/.test(u.pathname) ? 'releases' : /\/issues/.test(u.pathname) ? 'issues' : /CHANGELOG/.test(u.pathname) ? 'changelog' : 'repo'];
    }
    if (/buymeacoffee\.com$/.test(u.hostname)) return ['Coffee', ''];
    if (/(youtube\.com|youtu\.be)$/.test(u.hostname)) return ['YouTube', u.pathname.startsWith('/watch') ? 'video' : 'channel'];
    if (/instagram\.com$/.test(u.hostname)) return ['Artist', ''];
    return null;
  };
  document.addEventListener('click', (e) => {
    try {
      const el = e.target.closest && e.target.closest('a[href], button[data-copy]'), w = el && what(el); if (!w) return;
      const where = el.closest('.hero') ? 'hero' : el.closest('header') ? 'nav' : el.closest('footer') ? 'footer' : (el.closest('section[id]') || {}).id || 'page', data = { where };
      if (w[1]) data.what = w[1]; window.va('event', { name: w[0], data });
    } catch (err) {}
  }, true);
}
const analytics = `<script>if (location.hostname === ${JSON.stringify(new URL(site).hostname)} && navigator.doNotTrack !== '1') { window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); }; const s = document.createElement('script'); s.defer = true; s.src = '/_vercel/insights/script.js'; document.head.appendChild(s); (${trackClicks.toString()})(); }</script>`;

// on the host, the people who bought a coffee are fetched again first (scripts/supporters.js), so a deployment shows the latest ones; here, the ones committed in website/supporters/
if (process.env.VERCEL) require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'supporters.js')], { stdio: 'inherit' });
const backers = supporters.read(), people = backers.length, coffees = backers.reduce((n, p) => n + p.coffees, 0);

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(src, 'static'), dist, { recursive: true });
if (fs.existsSync(path.join(src, 'supporters'))) fs.cpSync(path.join(src, 'supporters'), path.join(dist, 'supporters'), { recursive: true, filter: (f) => !f.endsWith('.json') });
copy('website/src/style.css', 'style.css');
copy('media/icon.png', 'brand/icon.png'); copy('public/favicon.svg', 'brand/favicon.svg'); copy('brand/team-strip.svg', 'brand/team-strip.svg'); copy('docs/media/social.jpg', 'brand/social.jpg');

let home = hwPin(read('website/src/home.html'));
home = waitlist ? home.replace(/<!--\/?WAITLIST-->\n?/g, '').replace(/__WAITLIST__/g, () => esc(waitlist)) : home.replace(/<!--WAITLIST-->[\s\S]*?<!--\/WAITLIST-->\n?/, '');
home = supporters.fill(home, backers).replace(/__VERSION__/g, version).replace(/__SITE__/g, site).replace('<!--ANALYTICS-->', () => analytics);
// ---- one page per language, written here and not by the browser, so that each has its own address for search engines: / and /shop/ in English, /fr/ and /fr/shop/, /de/…
// English and French come from the page (data-en / data-fr), the others from website/locales/<code>.json (see scripts/site-locales.js); a missing text stays in English.
const locales = load('website');
const pick = "(ls) => { for (const l of ls) { const s = String(l).toLowerCase(), b = s.split('-')[0]; if (b === 'zh') return /hant|tw|hk|mo/.test(s) ? 'zh-TW' : 'zh-CN'; if (b === 'pt') return 'pt-BR'; if (['en', 'fr', 'es', 'de', 'da', 'ja', 'ko'].includes(b)) return b; } return 'en'; }";
// slug: '' for the home page, whose links are relative, or 'shop/' for the shop, whose links all start with /
function languages(source, slug) {
for (const [code, name, label, htmlLang, dir] of LANGS) {
  const cat = locales[code] || {}, up = dir ? '../' : '', at = (d) => (slug ? '/' + d + slug : (up + d) || './'), t = (en, fr) => (code === 'en' ? en : code === 'fr' && fr != null ? fr : cat[en] || en);
  const menu = `<details class="langs"><summary aria-label="${esc(t('Language', 'Langue'))}">${label}</summary><div>${LANGS.map(([c, n, , hl, d]) => `<a href="${at(d)}" hreflang="${c}" lang="${hl}" data-lang="${c}"${c === code ? ' aria-current="true"' : ''}>${n}</a>`).join('')}</div></details>`;
  const alternates = LANGS.map(([c, , , , d]) => `<link rel="alternate" hreflang="${c}" href="${site}${d}${slug}">`).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${site}${slug}">`;
  // on the English pages only: a visitor who chose another language before, or whose browser asks for one the site has, goes to that page
  const redirect = code !== 'en' ? '' : `<script>try { const to = ${JSON.stringify(Object.fromEntries(LANGS.slice(1).map((l) => [l[0], slug ? '/' + l[4] + slug : l[4]])))}, want = localStorage.getItem('as.site.lang') || (${pick})(navigator.languages || [navigator.language || '']); if (to[want]) location.replace(to[want] + location.search + location.hash); } catch {}</script>`;
  write(dir + slug + 'index.html', source
    .replace(/<([a-z0-9]+)((?:\s[^<>]*?)?)\sdata-en="([^"]*)"\sdata-fr="([^"]*)"([^<>]*)>[\s\S]*?<\/\1>/g, (m, tag, a, en, fr, b) => `<${tag}${a}${b}>${t(decode(en), decode(fr))}</${tag}>`)
    .replace(/\ssrc="[^"]*"\sdata-en-src="([^"]*)"\sdata-fr-src="([^"]*)"/g, (m, en, fr) => ` src="${code === 'fr' ? fr : en}"`)
    .replace(/\{\{([^{}]+)\}\}/g, (m, en) => esc(t(en)))
    .replace(/\b(href|src|poster)=(["'])(?!https?:|#|\/|mailto:|data:|\.\/["']|shop\/)/g, (m, attr, q) => (slug ? m : `${attr}=${q}${up}`))   // a language page is one folder down; its shop is beside it (/fr/shop/)
    .replace('<html lang="en">', `<html lang="${htmlLang}">`).replace(/__PAGE__/g, site + dir + slug).replace(/__HOME__/g, '/' + dir)
    .replace('<!--HREFLANG-->', alternates).replace('<!--REDIRECT-->\n', redirect ? redirect + '\n' : '').replace('<!--LANGS-->', menu)
    .replace('__COPY__', () => JSON.stringify(COPY.map(([en, fr]) => t(en, fr))))
    .replace(/\{people\}/g, people).replace(/\{coffees\}/g, coffees));
}
}
languages(home, '');
languages(hwPin(read('website/src/shop.html')), 'shop/');   // the shop shows the Halloween video once it is online

// ---- the plain pages. Just enough Markdown for what those files use: titles, paragraphs, lists, tables, bold, code, fenced code blocks, links.
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>').replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,])/g, '$1<a href="$2" rel="noopener">$2</a>');
function markdown(md) {
  const out = [], lines = md.split('\n'), cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) { const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); continue; }   // a fenced block, shown as written
    const h = /^(#{1,3}) (.+)$/.exec(l); if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^- /.test(l)) { const li = []; while (i < lines.length && /^- /.test(lines[i])) li.push('<li>' + inline(lines[i++].slice(2)) + '</li>'); out.push('<ul>' + li.join('') + '</ul>'); continue; }
    if (/^\|/.test(l) && /^\|[\s:|-]+\|$/.test((lines[i + 1] || '').trim())) { const head = cells(l), rows = []; i += 2; while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++])); out.push('<div class="tbl"><table><thead><tr>' + head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>'); continue; }
    const p = []; while (i < lines.length && lines[i].trim() && !/^(#{1,3} |- |\||```)/.test(lines[i])) p.push(lines[i++]); out.push('<p>' + inline(p.join(' ')) + '</p>');
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
${analytics}
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
<footer><div class="wrap"><nav><a href="../">Agent Standup</a><a href="../privacy/">Privacy</a><a href="../name-and-logo/">Name and logo</a><a href="../claude-code-subagents/">Claude Code sub-agents</a><a href="../codex-sessions/">Codex sessions</a><a href="../mistral-vibe-sessions/">Mistral Vibe sessions</a><a href="https://github.com/Atoll92/agent-standup" rel="noopener">GitHub</a></nav></div></footer>
</body>
</html>
`);
page('PRIVACY.md', 'privacy', 'Privacy', 'What Agent Standup reads, what it keeps on your computer, and what can leave it.');
page('TERMS.md', 'terms', 'Terms of sale', 'The terms of sale of the Agent Standup shop: the seller, the price, the delivery, the right of withdrawal, the licence of the pictures.');
page('website/guides/claude-code-subagents.md', 'claude-code-subagents', 'Claude Code sub-agent monitor', 'See which Claude Code sub-agent is working, stuck, waiting on another or burning tokens, live, from the session files Claude Code already writes. Free, local, zero tokens.');
page('website/guides/codex-sessions.md', 'codex-sessions', 'Codex session viewer', 'Follow and replay your OpenAI Codex sessions (desktop app and CLI) as a live call: prompts, commands with their output, file changes. Free, local, zero tokens.');
page('website/guides/mistral-vibe-sessions.md', 'mistral-vibe-sessions', 'Mistral Vibe session viewer', 'Follow and replay your Mistral Vibe sessions and sub-agents as a live call, in both of Vibe\'s log formats. Free, local, zero tokens.');
page('website/guides/claude-code-session-files.md', 'claude-code-session-files', 'What Claude Code writes to disk while it works', 'Where Claude Code keeps its transcripts, sub-agents, live status and background output, and how to tell from them whether an agent is done, stuck or waiting for you.');
page('TRADEMARKS.md', 'name-and-logo', 'Name and logo', 'The code of Agent Standup is MIT licensed. What you may and may not do with its name, its logo and its characters.');
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site}sitemap.xml\n`);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...LANGS.map((l) => l[4]), ...LANGS.map((l) => l[4] + 'shop/'), 'claude-code-subagents/', 'codex-sessions/', 'mistral-vibe-sessions/', 'claude-code-session-files/', 'privacy/', 'terms/', 'name-and-logo/'].map((p) => `  <url><loc>${site}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`website built for ${site} in website/dist (v${version}, ${(size(dist) / 1048576).toFixed(1)} MB${waitlist ? ', waitlist on' : ', no waitlist form yet'}, ${people} supporter(s))`);
