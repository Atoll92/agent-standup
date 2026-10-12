// Every address the server answers, and who answers it: 'controller#action' (controllers/).
//
// The first route that matches wins. `any` answers every method. `sameSiteOnly` refuses requests a browser marks as coming from
// another site, even to read (see http/guard.js): those addresses start programs, claim the sound, or serve what is in a session.
// What no route matches is a file of the page (assets#show).
const { packDir } = require('./services/characters');

const SAME_SITE_ONLY = { sameSiteOnly: true };
const route = (method) => (path, to, options = {}) => ({ method, path, to, ...options });
const [post, put, any] = ['POST', 'PUT', '*'].map(route);
const isPack = (name) => /^[a-z]+$/.test(name) && packDir(name) !== null;

const ROUTES = [
  // Sessions
  any('/api/sessions', 'sessions#index'),
  any('/api/projects', 'sessions#projects'),
  any('/api/session', 'sessions#show'),
  any('/api/board', 'sessions#board'),
  any('/api/current', 'sessions#current'),
  any('/api/media', 'pictures#show', SAME_SITE_ONLY),

  // Translation
  post('/api/translate', 'translation#translate', SAME_SITE_ONLY),
  post('/api/quips', 'translation#quips', SAME_SITE_ONLY),
  any('/api/health', 'translation#health'),
  any('/api/warm', 'translation#warm', SAME_SITE_ONLY),

  // Voices and sound
  any('/api/voices', 'voices#index', SAME_SITE_ONLY),
  any('/api/tts', 'voices#speak', SAME_SITE_ONLY),
  post('/api/kokoro/install', 'voices#installKokoro', SAME_SITE_ONLY),
  any('/api/kokoro', 'voices#kokoroStatus', SAME_SITE_ONLY),
  any('/api/audio', 'voices#audio', SAME_SITE_ONLY),

  // Settings
  put('/api/prefs', 'prefs#update', SAME_SITE_ONLY),
  any('/api/prefs', 'prefs#show', SAME_SITE_ONLY),
  any('/api/prefs.js', 'prefs#script', SAME_SITE_ONLY),

  // Characters
  any('/api/characters', 'characters#index'),
  any('/api/packs', 'characters#packs'),
  any('/characters/*file', 'characters#image'),
  any('/packs/:pack/*file', 'characters#packImage', { constraints: { pack: isPack } }),
];

const FALLBACK = 'assets#show';

module.exports = { ROUTES, FALLBACK };
