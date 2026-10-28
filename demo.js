// A made-up session used by the built-in demo (?demo=1, "Try the demo"): a fictional team fixes a slow login page
// and flaky cart tests. No real project data. Same shape as what server.js builds from real transcripts.
// `fr` holds the French version of spoken lines, so the demo needs no translation service.
// It also shows the other screens an agent can share: the lead's plan, a task board, a test run, a diff, a web search and a page in Claude Preview, whose screenshot is drawn below (PICTURE).
module.exports = function demoTimeline() {
  const start = Date.now() - 8 * 60 * 1000;
  let now = start, n = 0;
  const events = [];
  const agents = [
    { id: 'main', role: 'Lead', type: 'main' },
    { id: 'ada', name: 'Ada', role: 'Login profiling', roleFr: 'Profilage du login', type: 'general-purpose' },
    { id: 'remy', name: 'Remy', role: 'Flaky cart tests', roleFr: 'Tests du panier instables', type: 'general-purpose' },
    { id: 'iris', name: 'Iris', role: 'API error review', roleFr: 'Revue des erreurs API', type: 'general-purpose' },
    { id: 'hugo', name: 'Lena', role: 'Retry logic check', roleFr: 'Vérif. de la logique de retry', type: 'general-purpose' },
  ];
  const cat = (lines) => lines.map((l, i) => String(i + 1).padStart(6) + '\t' + l).join('\n');
  const ev = (gap, e) => { now += gap; events.push({ ts: now, ...e }); return now; };
  const tok = (agent) => { const k = ++n; events.push({ ts: now - 5, agent, kind: 'usage', u: { i: 4 + (k % 7), o: 90 + ((k * 37) % 420), r: 16000 + k * 1100, w: k % 5 === 0 ? 2400 : 0 }, model: 'demo' }); };   // made-up numbers, same shape as real ones
  const user = (text, fr) => ev(0, { agent: 'user', kind: 'user', text, fr });
  const say = (agent, text, fr, gap = 2600) => { const t = ev(gap, { agent, kind: 'say', text, fr }); tok(agent); return t; };
  const order = (from, to, title, text, fr, gap = 2200) => { const t = ev(gap, { agent: from, to, kind: 'order', title, text, fr }); tok(from); return t; };
  const report = (agent, to, text, fr, gap = 2600) => ev(gap, { agent, to, kind: 'report', text, fr });
  // one tool call + its result, `ms` later; `more`: what else the server reads from a real result (tests, diff, search, web)
  const use = (agent, name, arg, d, out, { err = false, ms = 400, gap = 1500, more = null } = {}) => {
    const id = 'toolu_demo' + ++n, ts = ev(gap, { agent, kind: 'tools', tools: [{ id, name, arg, d }] }); tok(agent);
    if (out != null) events.push({ ts: ts + ms, agent, kind: 'results', items: [{ id, err, out, ...(more || {}) }] });
    events[events.findIndex((e) => e.tools && e.tools[0].id === id)].tools[0].ts = ts;
  };
  const todo = (agent, items, gap = 1200) => use(agent, 'TodoWrite', 'update todos', { kind: 'todo', items: items.map(([c, s]) => ({ c, s })) }, null, { gap });
  const PREVIEW = 'mcp__Claude_Preview__preview_';

  user('The login page is slow and the cart tests keep failing at random. Can you sort it out?',
       'La page de connexion est lente et les tests du panier échouent au hasard. Tu peux régler ça ?');
  use('main', 'ExitPlanMode', 'plan', { kind: 'plan', text: [
    '# Fix the slow login and the flaky cart tests', '',
    '## What we know', '- `/login` takes about 3 s to show the form', '- The cart tests fail about one run in three', '',
    '## Steps', '1. **Ada** profiles the login flow (read-only)', '2. **Remy** finds why the cart tests are flaky, fixes them, runs them twice',
    '3. **Iris** reviews error handling in `src/api`; **Lena** checks the retry logic', '4. I apply the login fix, check the page in the preview, and commit on a branch', '',
    '## Out of scope', '- No dependency upgrades, no visual changes'].join('\n') },
      'User has approved your plan. You can now start coding.', { ms: 900, gap: 2400 });
  say('main', "On it. Here's my plan: one agent profiles the login, one hunts the flaky cart tests, one reviews the API errors.",
      "Je m'en occupe. Voici mon plan : un agent profile le login, un autre traque les tests instables du panier, un troisième passe en revue les erreurs de l'API.", 1400);
  todo('main', [['Profile the login flow', 'in_progress'], ['Fix the flaky cart tests', 'pending'], ['Review API error handling', 'pending'], ['Check the login page in the preview', 'pending'], ['Commit the changes', 'pending']]);
  order('main', 'ada', 'Profile the login flow', "Find out why /login takes about 3 seconds. Read-only: don't edit anything. Report what you find, with file and line.",
        "Trouve pourquoi /login prend environ 3 secondes. Lecture seule : ne modifie rien. Rapporte ce que tu trouves, avec fichier et ligne.");
  order('main', 'remy', 'Fix the flaky cart tests', 'The cart tests fail about one run in three. Find the cause, fix it, then run the suite twice to be sure.',
        'Les tests du panier échouent environ une fois sur trois. Trouve la cause, corrige, puis lance la suite deux fois pour être sûr.', 1200);
  order('main', 'iris', 'Review API error handling', 'Review how src/api handles failures. List the unhandled errors and fix the safe ones. Ask Lena to check the retry logic.',
        "Passe en revue la gestion des erreurs dans src/api. Liste celles qui ne sont pas gérées et corrige les plus sûres. Demande à Lena de vérifier la logique de retry.", 1200);

  // --- parallel work -------------------------------------------------------------
  // A spoken line takes the floor: the screen of whoever shares it closes unless that agent is the one speaking, and a helper's line takes the calls after it along, silently (the page's replay groups them).
  // So a screen meant to be seen comes right before its own agent's line, and each helper's report is followed by the lead or an order.
  use('ada', 'Read', 'src/pages/Login.jsx', { kind: 'read', file: 'src/pages/Login.jsx' }, cat([
    "import { useEffect, useState } from 'react';", "import { useProfile } from '../context/ProfileProvider';", "import { fetchProfile } from '../api/profile';", "import { fetchNetworks } from '../api/networks';", '',
    'export default function Login() {', '  const profile = useProfile();', '  const [networks, setNetworks] = useState(null);', '', '  useEffect(() => {', '    fetchProfile();            // <-- second call, the provider already fetched it',
    '    fetchNetworks().then(setNetworks);', '  }, []);', '', '  if (!profile || !networks) return <Spinner />;', '', '  return (', '    <main className="login">', '      <LoginForm networks={networks} />', '    </main>', '  );', '}']), { ms: 220, gap: 2400 });
  use('ada', 'Bash', 'npm run profile -- login', { kind: 'cmd', text: 'npm run profile -- login', note: 'Profile the login page' },
      'login render: 3120 ms\n  ├─ fetchProfile   2410 ms   (called 2×)\n  ├─ fetchNetworks   380 ms\n  └─ paint           330 ms', { ms: 1300, gap: 1400 });
  use('remy', 'Bash', 'npm test -- cart', { kind: 'cmd', text: 'npm test -- cart', note: 'Run the cart tests' },
      " FAIL  src/cart/cart.test.js\n  ● applies a discount code\n\n    Expected: 45\n    Received: 50\n\n      12 |   applyCode('SAVE10');\n    > 13 |   expect(total()).toBe(45);\n\n  ● updates the total after adding an item\n\n    Expected: 42\n    Received: 0\n\n      18 |   addItem(item);\n    > 19 |   expect(total()).toBe(42);\n\nTests: 2 failed, 10 passed, 12 total",
      { err: true, ms: 1500, gap: 1300, more: { tests: { runner: 'jest', pass: 10, fail: 2, skip: 0, total: 12, failed: ['applies a discount code', 'updates the total after adding an item'] } } });
  say('remy', 'Two cart tests fail: the discount and the total.', 'Deux tests du panier échouent : la remise et le total.', 1600);
  say('ada', "Found it: fetchProfile runs twice and blocks the first render. That's about 2.4 seconds.", "Trouvé : fetchProfile est appelé deux fois et bloque le premier affichage. Ça fait environ 2,4 secondes.", 2000);
  report('ada', 'main', 'Login is slow because fetchProfile runs twice (Login.jsx:11 and ProfileProvider.jsx:18) and blocks rendering. Fix: fetch once, in the provider. Expected: 3.1 s down to under 1 s.',
         "Le login est lent car fetchProfile est appelé deux fois (Login.jsx:11 et ProfileProvider.jsx:18) et bloque l'affichage. Correctif : un seul appel, dans le provider. Attendu : de 3,1 s à moins d'une seconde.", 1400);
  order('iris', 'hugo', 'Retry logic check', 'Check the retry logic in src/api/client.js: any infinite retry, or no backoff?', 'Vérifie la logique de retry dans src/api/client.js : y a-t-il un retry infini, ou pas de backoff ?', 1600);
  use('hugo', 'Read', 'src/api/client.js', { kind: 'read', file: 'src/api/client.js' }, cat([
    'const MAX = 5;', '', 'export async function request(url, opts, attempt = 0) {', '  const res = await fetch(url, opts).catch(() => null);', '  if (res && res.ok) return res;', "  if (attempt >= MAX) throw new Error('request failed: ' + url);",
    '  return request(url, opts, attempt + 1);   // no delay, and 4xx retried too', '}']), { ms: 140, gap: 1000 });
  use('iris', 'Edit', 'src/api/errors.js', { kind: 'edit', file: 'src/api/errors.js', old: "  // TODO: map status codes to friendly messages\n  throw new Error('request failed');", new: '  throw new ApiError(res.status, friendly(res.status));' },
      'The file src/api/errors.js has been updated.', { ms: 120, gap: 1300, more: { diff: { files: [{ file: 'src/api/errors.js', hunks: [{ o: 1, n: 1, lines: [
        ' export async function handle(res) {', '   if (res.ok) return res.json();', '-  // TODO: map status codes to friendly messages', "-  throw new Error('request failed');", '+  throw new ApiError(res.status, friendly(res.status));', ' }', ' ', ' export async function safe(fn) {'] }] }] } } });
  use('remy', 'MultiEdit', 'src/cart/cart.test.js', { kind: 'edit', file: 'src/cart/cart.test.js', old: '  expect(total()).toBe(45);', new: '  await waitFor(() => expect(total()).toBe(45));' },
      'Applied 2 edits to src/cart/cart.test.js.', { ms: 120, gap: 1300, more: { diff: { files: [{ file: 'src/cart/cart.test.js', hunks: [{ o: 10, n: 10, lines: [
        " test('applies a discount code', async () => {", '   addItem({ id: 2, price: 50 });', "   applyCode('SAVE10');", '-  expect(total()).toBe(45);', '+  await waitFor(() => expect(total()).toBe(45));', ' });', ' ',
        " test('updates the total after adding an item', async () => {", '   const item = { id: 1, price: 42 };', '   addItem(item);', '-  expect(total()).toBe(42);', '+  await waitFor(() => expect(total()).toBe(42));', ' });'] }] }] } } });
  use('remy', 'Bash', 'npm test -- cart', { kind: 'cmd', text: 'npm test -- cart', note: 'Run the cart tests again' },
      ' PASS  src/cart/cart.test.js\n  ✓ starts empty (3 ms)\n  ✓ applies a discount code (9 ms)\n  ✓ updates the total after adding an item (12 ms)\n\nTests: 12 passed, 12 total\nTime:  2.1 s',
      { ms: 1100, gap: 1300, more: { tests: { runner: 'jest', pass: 12, fail: 0, skip: 0, total: 12, failed: [] } } });
  report('remy', 'main', 'Cause: two cart tests read the total before the async update finished. Added waitFor to both. Two consecutive runs pass (12/12).', "Cause : deux tests du panier lisaient le total avant la fin de la mise à jour asynchrone. J'ai ajouté waitFor aux deux. Deux exécutions de suite passent (12/12).", 1200);
  say('main', 'Thanks, Remy.', 'Merci, Remy.', 1200);
  use('hugo', 'WebSearch', 'retry fetch exponential backoff jitter which status codes', { kind: 'web', query: 'retry fetch exponential backoff jitter which status codes' },
      'Web search results for query: "retry fetch exponential backoff jitter which status codes"\n\nLinks: 5 results', { ms: 1200, gap: 1100, more: { search: [
        { t: 'Retrying failed requests with exponential backoff and jitter', u: 'https://docs.example.org/guides/retries' },
        { t: 'Which HTTP status codes should a client retry?', u: 'https://qa.example.net/questions/which-status-codes-to-retry' },
        { t: 'Backoff and jitter, explained with charts', u: 'https://engineering.example.com/blog/backoff-and-jitter' },
        { t: 'Fetch API: handling network errors and timeouts', u: 'https://web-reference.example.org/fetch/errors' },
        { t: 'Never retry a 4xx: idempotency and client errors', u: 'https://notes.example.dev/http/never-retry-4xx' }] } });
  say('hugo', "No infinite loop, but there's no backoff: five instant retries hammer the server. And 4xx errors shouldn't retry at all.", "Pas de boucle infinie, mais aucun backoff : cinq retries immédiats martèlent le serveur. Et les erreurs 4xx ne devraient pas être retentées.", 1800);
  report('hugo', 'iris', 'Retries have no backoff and also retry on 4xx. Suggest exponential backoff and stopping on client errors.', 'Les retries n’ont pas de backoff et retentent aussi sur les 4xx. Je suggère un backoff exponentiel et un arrêt sur les erreurs client.', 1200);
  say('main', 'Good catch, Lena. Iris, go ahead with the backoff.', 'Bien vu, Lena. Iris, vas-y pour le backoff.', 1200);
  use('iris', 'MultiEdit', 'src/api/client.js', { kind: 'edit', file: 'src/api/client.js', old: '  return request(url, opts, attempt + 1);   // no delay, and 4xx retried too', new: '  await wait(2 ** attempt * 200 + Math.random() * 100);\n  return request(url, opts, attempt + 1);' },
      'Applied 3 edits to src/api/client.js.', { ms: 120, gap: 1200, more: { diff: { files: [{ file: 'src/api/client.js', hunks: [{ o: 1, n: 1, lines: [
        ' const MAX = 5;', '+const wait = (ms) => new Promise((r) => setTimeout(r, ms));', ' ', ' export async function request(url, opts, attempt = 0) {', '   const res = await fetch(url, opts).catch(() => null);', '   if (res && res.ok) return res;',
        '+  if (res && res.status >= 400 && res.status < 500) return res;   // a client error: retrying will not help', "   if (attempt >= MAX) throw new Error('request failed: ' + url);", '-  return request(url, opts, attempt + 1);   // no delay, and 4xx retried too',
        '+  await wait(2 ** attempt * 200 + Math.random() * 100);', '+  return request(url, opts, attempt + 1);', ' }'] }] }] } } });
  use('iris', 'Bash', 'npm test -- api', { kind: 'cmd', text: 'npm test -- api', note: 'Run the API tests' }, ' PASS  src/api/errors.test.js\n PASS  src/api/client.test.js\n\nTests: 18 passed, 18 total',
      { ms: 1100, gap: 1300, more: { tests: { runner: 'jest', pass: 18, fail: 0, skip: 0, total: 18, failed: [] } } });
  report('iris', 'main', 'Two unhandled error paths fixed (profile load, checkout) and retries now back off and stop on 4xx. API tests: 18/18.', 'Deux chemins d’erreur non gérés corrigés (chargement du profil, paiement), et les retries ralentissent et s’arrêtent sur les 4xx. Tests API : 18/18.', 1700);
  say('main', "Thanks, all. I'll apply the login fix and check the page in the preview.", "Merci à tous. J'applique le correctif du login et je vérifie la page dans l'aperçu.", 1600);

  // --- the lead wraps up ----------------------------------------------------------------
  todo('main', [['Profile the login flow', 'completed'], ['Fix the flaky cart tests', 'completed'], ['Review API error handling', 'completed'], ['Check the login page in the preview', 'in_progress'], ['Commit the changes', 'pending']], 2200);
  use('main', 'MultiEdit', 'src/pages/Login.jsx', { kind: 'edit', file: 'src/pages/Login.jsx', old: "import { fetchProfile } from '../api/profile';\n", new: '' },
      'Applied 2 edits to src/pages/Login.jsx.', { ms: 120, gap: 1400, more: { diff: { files: [{ file: 'src/pages/Login.jsx', hunks: [{ o: 1, n: 1, lines: [
        " import { useEffect, useState } from 'react';", " import { useProfile } from '../context/ProfileProvider';", "-import { fetchProfile } from '../api/profile';", " import { fetchNetworks } from '../api/networks';", ' ',
        ' export default function Login() {', '   const profile = useProfile();', '   const [networks, setNetworks] = useState(null);', ' ', '   useEffect(() => {', '-    fetchProfile();            // <-- second call, the provider already fetched it', '     fetchNetworks().then(setNetworks);', '   }, []);'] }] }] } } });
  say('main', 'One profile call instead of two: that is the fix.', 'Un seul appel au profil au lieu de deux : voilà le correctif.', 1000);
  use('main', PREVIEW + 'start', 'web', { kind: 'browser', steps: [{ a: 'start' }] }, '{"name":"web","port":3000,"status":"running"}', { ms: 900, gap: 1200, more: { web: { u: 'http://localhost:3000' } } });
  use('main', PREVIEW + 'screenshot', 'web', { kind: 'browser', steps: [{ a: 'screenshot' }] }, '', { ms: 600, gap: 900, more: { img: 1, web: { u: 'http://localhost:3000', f: [1280, 800] } } });   // its picture is PICTURE below
  use('main', PREVIEW + 'console_logs', 'logs', { kind: 'browser', steps: [{ a: 'logs' }] },
      '[vite] connected.\nGET /api/profile 200 · 410 ms\nGET /api/networks 200 · 380 ms\nlogin render: 892 ms', { ms: 200, gap: 1200, more: { web: { log: ['[vite] connected.', 'GET /api/profile 200 · 410 ms', 'GET /api/networks 200 · 380 ms', 'login render: 892 ms'] } } });
  use('main', 'Bash', 'git commit -am "Fix slow login and flaky cart tests"', { kind: 'cmd', text: 'git commit -am "Fix slow login and flaky cart tests"', note: 'Commit' },
      '[fix/login-and-cart 3f2a9c1] Fix slow login and flaky cart tests\n 4 files changed, 41 insertions(+), 15 deletions(-)', { ms: 300, gap: 1300 });
  todo('main', [['Profile the login flow', 'completed'], ['Fix the flaky cart tests', 'completed'], ['Review API error handling', 'completed'], ['Check the login page in the preview', 'completed'], ['Commit the changes', 'completed']], 900);
  say('main', 'Done. Login goes from 3.1 s to 0.9 s, the cart tests pass twice in a row, and two API error paths are handled. Everything is committed on a branch.',
      'Terminé. Le login passe de 3,1 s à 0,9 s, les tests du panier passent deux fois de suite et deux chemins d’erreur de l’API sont gérés. Tout est commité sur une branche.', 1800);

  events.sort((a, b) => a.ts - b.ts);
  const merged = [];   // same merging rule as the real timeline: nothing to merge here, each call is its own beat
  for (const e of events) merged.push(e);
  const first = merged[0].ts;
  return { id: 'demo', proj: '_demo', agents, events: merged.map((e) => ({ ...e, t: e.ts - first })), durationMs: merged[merged.length - 1].ts - first };
};

// The screenshot the lead takes in Claude Preview: the made-up login page, drawn (served by /api/media for the demo, see server.js)
const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800" font-family="Helvetica, Arial, sans-serif">'
  + '<rect width="1280" height="800" fill="#f4f6fb"/><rect width="1280" height="64" fill="#ffffff"/><rect y="64" width="1280" height="1" fill="#e3e7f0"/>'
  + '<circle cx="56" cy="32" r="14" fill="#5b6cff"/><text x="80" y="39" font-size="20" font-weight="700" fill="#1d2233">Acme</text>'
  + '<text x="1080" y="38" font-size="15" fill="#5d6477">Pricing</text><text x="1160" y="38" font-size="15" fill="#5d6477">Help</text>'
  + '<rect x="440" y="150" width="400" height="460" rx="16" fill="#ffffff" stroke="#e3e7f0"/>'
  + '<text x="640" y="218" font-size="28" font-weight="700" fill="#1d2233" text-anchor="middle">Welcome back</text>'
  + '<text x="640" y="248" font-size="15" fill="#7a8194" text-anchor="middle">Sign in to your account</text>'
  + '<text x="480" y="300" font-size="13" fill="#5d6477">Email</text><rect x="480" y="310" width="320" height="44" rx="8" fill="#f8f9fc" stroke="#d6dbe7"/><text x="496" y="338" font-size="15" fill="#1d2233">sam@example.com</text>'
  + '<text x="480" y="384" font-size="13" fill="#5d6477">Password</text><rect x="480" y="394" width="320" height="44" rx="8" fill="#f8f9fc" stroke="#d6dbe7"/><text x="496" y="422" font-size="15" fill="#1d2233" letter-spacing="3">••••••••••</text>'
  + '<rect x="480" y="466" width="320" height="46" rx="8" fill="#5b6cff"/><text x="640" y="495" font-size="16" font-weight="700" fill="#ffffff" text-anchor="middle">Sign in</text>'
  + '<text x="640" y="560" font-size="14" fill="#5b6cff" text-anchor="middle">Forgot your password?</text>'
  + '<rect x="1060" y="730" width="190" height="40" rx="20" fill="#e8f7ee"/><circle cx="1084" cy="750" r="6" fill="#2fb36b"/><text x="1098" y="755" font-size="14" fill="#1f7a49">Loaded in 0.4 s</text></svg>';
module.exports.picture = (tool, n) => (/^toolu_demo\d+$/.test(String(tool)) && !n ? { type: 'image/svg+xml', buf: Buffer.from(PICTURE) } : null);
