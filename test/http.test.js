// test/http.test.js: the server's parts on their own (server/): the router and its routes, who may ask, which window plays the sound.
// The whole server, against real requests, is in server.test.js.
const test = require('node:test'), assert = require('node:assert'), http = require('http');
const { Router } = require('../server/http/router');
const { comesFromThisMachine, isRefusedFromOtherSites } = require('../server/http/guard');
const { ROUTES, FALLBACK } = require('../server/routes');
const { AudioOwner } = require('../server/services/audioOwner');
const { listCharacters, packDir } = require('../server/services/characters');

test('a route is matched whole, by method, first one first; what no route matches is a file of the page', () => {
  const router = new Router([
    { method: 'PUT', path: '/api/prefs', to: 'prefs#update' },
    { method: '*', path: '/api/prefs', to: 'prefs#show' },
    { method: '*', path: '/api/prefs.js', to: 'prefs#script' },
    { method: '*', path: '/files/*name', to: 'files#show' },
    { method: '*', path: '/packs/:pack/*name', to: 'packs#show', constraints: { pack: (pack) => pack === 'cats' } },
  ], 'assets#show');
  assert.deepEqual(router.match('PUT', '/api/prefs'), { to: 'prefs#update', params: {} });
  assert.deepEqual(router.match('DELETE', '/api/prefs'), { to: 'prefs#show', params: {} }, 'any method');
  assert.deepEqual(router.match('GET', '/api/prefs/'), { to: 'assets#show', params: {} }, 'whole paths only');
  assert.deepEqual(router.match('GET', '/api/prefs.js'), { to: 'prefs#script', params: {} });
  assert.deepEqual(router.match('GET', '/api/prefsXjs'), { to: 'assets#show', params: {} }, 'a dot is a dot');
  assert.deepEqual(router.match('GET', '/files/a/b.png'), { to: 'files#show', params: { name: 'a/b.png' } }, '* takes the rest');
  assert.deepEqual(router.match('GET', '/files/'), { to: 'files#show', params: { name: '' } });
  assert.deepEqual(router.match('GET', '/packs/cats/x.png'), { to: 'packs#show', params: { pack: 'cats', name: 'x.png' } });
  assert.deepEqual(router.match('GET', '/packs/dogs/x.png').to, 'assets#show', 'a part the constraint refuses');
  assert.deepEqual(router.match('GET', '/packs/a/b/x.png').to, 'assets#show', ': takes one part');
});

test('every route names a controller action that exists, and the addresses that start programs or serve a session are same-site only', () => {
  const { SessionsController } = require('../server/controllers/sessions'), { PicturesController } = require('../server/controllers/pictures');
  const { TranslationController } = require('../server/controllers/translation'), { VoicesController } = require('../server/controllers/voices');
  const { PrefsController } = require('../server/controllers/prefs'), { CharactersController } = require('../server/controllers/characters'), { AssetsController } = require('../server/controllers/assets');
  const controllers = { sessions: SessionsController, pictures: PicturesController, translation: TranslationController, voices: VoicesController, prefs: PrefsController, characters: CharactersController, assets: AssetsController };
  for (const { to } of [...ROUTES, { to: FALLBACK }]) {
    const [name, action] = to.split('#');
    assert.equal(typeof controllers[name].prototype[action], 'function', to);
  }
  assert.deepEqual([...new Router(ROUTES, FALLBACK).sameSiteOnlyPaths].sort(), ['/api/audio', '/api/kokoro', '/api/kokoro/install', '/api/media', '/api/prefs', '/api/prefs.js', '/api/quips', '/api/translate', '/api/tts', '/api/voices', '/api/warm']);
});

test('only this machine may ask; another site may only read, and not the same-site-only addresses', () => {
  const request = (headers, method = 'GET') => ({ method, headers: { host: 'localhost:4747', ...headers } });
  assert.ok(comesFromThisMachine(request({})));
  assert.ok(comesFromThisMachine(request({ host: '127.0.0.1:1', origin: 'http://[::1]:9' })));
  assert.ok(!comesFromThisMachine(request({ host: 'evil.com' })), 'DNS rebinding');
  assert.ok(!comesFromThisMachine(request({ origin: 'http://evil.com' })));
  assert.ok(!comesFromThisMachine(request({ origin: 'not an address' })));
  const sameSiteOnly = new Set(['/api/media']);
  assert.ok(!isRefusedFromOtherSites(request({ 'sec-fetch-site': 'cross-site' }), '/api/sessions', sameSiteOnly));
  assert.ok(isRefusedFromOtherSites(request({ 'sec-fetch-site': 'cross-site' }), '/api/media', sameSiteOnly));
  assert.ok(isRefusedFromOtherSites(request({ 'sec-fetch-site': 'same-site' }, 'POST'), '/', sameSiteOnly));
  assert.ok(!isRefusedFromOtherSites(request({ 'sec-fetch-site': 'same-origin' }, 'POST'), '/api/media', sameSiteOnly));
  assert.ok(!isRefusedFromOtherSites(request({ 'sec-fetch-site': 'none' }), '/api/media', sameSiteOnly), 'typed in the address bar');
  assert.ok(!isRefusedFromOtherSites(request({}, 'PUT'), '/api/media', sameSiteOnly), 'not a browser');
});

test('the sound goes to the last window that claimed it, until it stops checking in for 6 seconds', (t) => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const owner = new AudioOwner();
  assert.equal(owner.checkIn('window-a'), null, 'checking in does not claim');
  assert.equal(owner.checkIn('window-a', { claim: true }), 'window-a');
  now += 5000; assert.equal(owner.checkIn('window-b'), 'window-a', 'another window checking in keeps nothing alive');
  now += 1500; assert.equal(owner.checkIn('window-b'), null, 'window-a went quiet');
  assert.equal(owner.checkIn('window-b', { claim: true }), 'window-b');
  now += 5000; assert.equal(owner.checkIn('window-b'), 'window-b');
  now += 5000; assert.equal(owner.checkIn('window-b'), 'window-b', 'its own check-ins keep it');
  assert.equal(owner.checkIn('no!', { claim: true }), 'window-b', 'not a window id');
});

test('a pack is one of the built-in packs, not any name an object happens to have', async () => {
  assert.equal(packDir('constructor'), null);
  assert.deepEqual(listCharacters('toString').chars, []);
  assert.ok(listCharacters('cats').chars.length > 0);
  const server = require('../server.js').start(0); await new Promise((resolve) => server.once('listening', resolve));
  const get = (target) => new Promise((resolve) => http.get({ port: server.address().port, path: target }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); }));
  try {
    assert.equal(await get('/api/characters?pack=constructor'), 200, 'it used to be an exception: 500');
    assert.equal(await get('/packs/constructor/x.png'), 404);
  } finally { server.close(); require('../server.js').shutdown(); }
});
