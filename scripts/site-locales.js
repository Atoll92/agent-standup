// Languages of the website (website/) and of the landing page (landing/). As in the app, English and French are written in the page itself
// (data-en / data-fr) and every other language is a file <folder>/locales/<code>.json mapping each English text to its translation;
// a text that is missing stays in English. The rules of a translation are in public/locales/README.md.
//   node scripts/site-locales.js            checks every file: missing, empty or unused texts, HTML tags that differ from the English. Exit code 1 on problems.
//   node scripts/site-locales.js extract    rewrites the two en.json (the template to copy for a new language)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
// code (as in the app), name in its own language, label in the menu, HTML lang, folder of its page on the website
const LANGS = [['en', 'English', 'EN', 'en', ''], ['fr', 'Français', 'FR', 'fr', 'fr/'], ['zh-TW', '繁體中文', '繁體', 'zh-Hant-TW', 'zh-tw/'], ['zh-CN', '简体中文', '简体', 'zh-Hans-CN', 'zh-cn/'], ['es', 'Español', 'ES', 'es', 'es/'], ['de', 'Deutsch', 'DE', 'de', 'de/'], ['da', 'Dansk', 'DA', 'da', 'da/'], ['pt-BR', 'Português (Brasil)', 'PT', 'pt-BR', 'pt-br/'], ['ja', '日本語', '日本語', 'ja', 'ja/'], ['ko', '한국어', '한국어', 'ko', 'ko/']];
// the three states of the "copy" tag of a command box on the website: [English, French]
const COPY = [['copy', 'copier'], ['copied', 'copié'], ['select the text', 'sélectionnez le texte']];
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');   // an attribute value, as the browser reads it
const pairs = (html) => [...html.matchAll(/\sdata-en="([^"]*)"\sdata-fr="([^"]*)"/g)].map((m) => decode(m[1]));
const marked = (html) => [...html.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1]);                 // {{text}}: a text that is not the content of an element (title, description, alt)
const said = (html) => [...html.matchAll(/say: \['((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);         // the lines of the landing page's little illustration: say: ['English', 'French']
// what each site needs (its pages: one file, or a list): every English text, and the ones French has to find in fr.json because the page holds no French for them
const SITES = {
  website: { file: ['website/src/home.html', 'website/src/shop.html'], dir: 'website/locales', keys: (h) => [...pairs(h), ...marked(h), 'Language', ...COPY.slice(1).map((c) => c[0])], fr: (h) => marked(h) },
  landing: { file: 'landing/template.html', dir: 'landing/locales', keys: (h) => [...pairs(h), ...said(h)], fr: () => [] },
};
const read = (rel) => [].concat(rel).map((r) => fs.readFileSync(path.join(root, r), 'utf8')).join('\n');
const keysOf = (site) => [...new Set(SITES[site].keys(read(SITES[site].file)))].filter((k) => k.trim());
// { code: { English: translation } } for the languages that have a file
function load(site) {
  const out = {};
  for (const [code] of LANGS) { const f = path.join(root, SITES[site].dir, code + '.json'); if (code !== 'en' && fs.existsSync(f)) { out[code] = JSON.parse(fs.readFileSync(f, 'utf8')); delete out[code]._meta; } }
  return out;
}
module.exports = { LANGS, COPY, decode, load, keysOf };

if (require.main === module) {
  const tags = (s) => (s.match(/<[^>]+>/g) || []).sort().join(''), frame = (s) => /^\s*/.exec(s)[0] + '|' + /\s*$/.exec(s)[0];
  let bad = 0;
  for (const site of Object.keys(SITES)) {
    const ks = keysOf(site), frKeys = new Set(SITES[site].fr(read(SITES[site].file)));
    if (process.argv[2] === 'extract') { fs.mkdirSync(path.join(root, SITES[site].dir), { recursive: true }); fs.writeFileSync(path.join(root, SITES[site].dir, 'en.json'), JSON.stringify(Object.fromEntries(ks.map((k) => [k, k])), null, 1) + '\n'); console.log(`${site}: ${ks.length} texts → ${SITES[site].dir}/en.json`); continue; }
    const cats = load(site);
    const tpl = path.join(root, SITES[site].dir, 'en.json'); if (!fs.existsSync(tpl) || Object.keys(JSON.parse(fs.readFileSync(tpl, 'utf8'))).join('\n') !== ks.join('\n')) { bad++; console.log(`${site}: en.json is out of date, run: node scripts/site-locales.js extract`); }
    for (const [code] of LANGS.slice(1)) {
      const need = code === 'fr' ? ks.filter((k) => frKeys.has(k)) : ks, cat = cats[code] || {}, problems = [];
      if (!cats[code] && need.length) problems.push('no file');
      for (const k of need) if (cats[code] && !String(cat[k] || '').trim()) problems.push('missing: ' + k.slice(0, 70));
      for (const k of Object.keys(cat)) {
        if (!need.includes(k)) problems.push('unused: ' + k.slice(0, 70));
        else if (tags(k) !== tags(cat[k])) problems.push('HTML tags differ from the English: ' + k.slice(0, 70));
        else if (frame(k) !== frame(cat[k])) problems.push('leading or trailing space differs: ' + k.slice(0, 70));
      }
      if (problems.length) { bad += problems.length; console.log(`${site} ${code}: ${problems.length} problem(s)\n  ` + problems.join('\n  ')); }
    }
    console.log(`${site}: ${ks.length} texts; files for ${Object.keys(cats).join(', ') || 'no language yet'}`);
  }
  process.exit(bad ? 1 : 0);
}
