// Builds docs/index.html (the GitHub Pages landing page) from landing/template.html,
// pulling the character art straight out of public/index.html so the two never drift apart.
const fs = require('fs'), path = require('path');
const { langsOf, load } = require('./site-locales.js'), LANGS = langsOf('landing');
const supporters = require('./supporters.js'), backers = supporters.read();
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const sep = '// =====================================================================\n';
const jsStart = app.indexOf(sep + '//  cast: soft mascots'), jsEnd = app.indexOf(sep + '//  state'), js = app.slice(jsStart, jsEnd);
// the styles of the characters: from their comment to the end of the reduced-motion line that closes them, whatever that line says (its wording changed in 1.19.3, and the landing page was built without these styles until 1.31.0)
const cssStart = app.indexOf('/* character animation'), cssLast = app.indexOf('@media (prefers-reduced-motion:reduce)', cssStart), cssEnd = app.indexOf('\n', cssLast);
const css = app.slice(cssStart, cssEnd);
if (jsStart < 0 || jsEnd <= jsStart || cssStart < 0 || cssLast < 0 || cssEnd < 0 || !css.includes('.tile .laptop')) throw new Error('art markers not found in public/index.html');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
// the people who bought a coffee, as committed in website/supporters/ (node scripts/supporters.js fetches them again); the page puts the numbers into the line that counts them, in every language
let out = supporters.fill(fs.readFileSync(path.join(root, 'landing/template.html'), 'utf8'), backers)
  .replace('/*ART_CSS*/', () => css).replace('/*ART_JS*/', () => js).replace(/__VERSION__/g, version)
  .replace('/*LANGS*/[]', () => JSON.stringify(LANGS.map(([code, name, , htmlLang]) => [code, name.replace(/ \(.*/, ''), htmlLang])));
out = out.replace(/(<p class="backed" data-people="(\d+)" data-coffees="(\d+)"(?:\s[\w-]+="[^"]*")*>)([\s\S]*?<\/p>)/, (m, open, n, c, rest) => open + rest.replace(/\{people\}/g, n).replace(/\{coffees\}/g, c));
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/index.html'), out);
// the languages other than English and French: one small file each, fetched by the page when that language is chosen (see scripts/site-locales.js)
fs.rmSync(path.join(root, 'docs/locales'), { recursive: true, force: true }); fs.mkdirSync(path.join(root, 'docs/locales'));
for (const [code, cat] of Object.entries(load('landing'))) fs.writeFileSync(path.join(root, 'docs/locales', code + '.json'), JSON.stringify(cat));
fs.copyFileSync(path.join(root, 'media/icon.png'), path.join(root, 'docs/icon.png'));
fs.rmSync(path.join(root, 'docs/supporters'), { recursive: true, force: true });
if (backers.some((p) => p.picture)) fs.cpSync(path.join(root, 'website/supporters'), path.join(root, 'docs/supporters'), { recursive: true, filter: (f) => !f.endsWith('.json') });
console.log('docs/index.html built (' + Math.round(out.length / 1024) + ' KB, v' + version + ')');
