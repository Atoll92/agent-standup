// The server's answer to a request: who may ask (http/guard.js), which controller answers (routes.js), and what to do when it fails.
const { Exchange } = require('./http/exchange');
const { Router } = require('./http/router');
const { comesFromThisMachine, isRefusedFromOtherSites } = require('./http/guard');
const { ROUTES, FALLBACK } = require('./routes');

// controllers: { name: controller } for the names that routes.js uses ('sessions' for 'sessions#index'…)
function createApp(controllers) {
  const router = new Router(ROUTES, FALLBACK), sameSiteOnlyPaths = router.sameSiteOnlyPaths;

  return function handle(request, response) {
    let url;
    try { url = new URL(request.url, 'http://x'); } catch { response.writeHead(400); return response.end('bad request'); }   // "GET //" is not an address: answered, where it used to stop the whole server
    request.on('error', () => {}); response.on('error', () => {});   // a browser that goes away mid-request is not our problem
    if (!comesFromThisMachine(request) || isRefusedFromOtherSites(request, url.pathname, sameSiteOnlyPaths)) { response.writeHead(403); return response.end('forbidden'); }

    const exchange = new Exchange(request, response, url);
    const fail = (error) => { if (response.headersSent) return response.destroy(); exchange.json({ error: String(error.message || error) }, 500); };
    try {
      const { to, params } = router.match(request.method, url.pathname), [name, action] = to.split('#');
      exchange.params = params;
      const answered = controllers[name][action](exchange);
      if (answered && typeof answered.catch === 'function') answered.catch(fail);
    } catch (error) { fail(error); }
  };
}

module.exports = { createApp };
