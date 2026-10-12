// Who may talk to the server: only this machine.
//
// The Host header must be this machine's (that blocks DNS rebinding), and so must the Origin when a browser sends one (that blocks other
// websites). On top of that, requests a browser marks as coming from another site may only read: they are refused when they write,
// and for the addresses marked sameSiteOnly in routes.js (they start programs, claim the sound, or serve what is in a session),
// so an <img> or a <script src> on some web page cannot use them either.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const isLocal = (host) => LOCAL_HOST.test(host || '');

function comesFromThisMachine(request) {
  let originIsLocal = true;
  try { originIsLocal = !request.headers.origin || isLocal(new URL(request.headers.origin).host); } catch { originIsLocal = false; }
  return isLocal(request.headers.host) && originIsLocal;
}

function isRefusedFromOtherSites(request, path, sameSiteOnlyPaths) {
  const site = request.headers['sec-fetch-site'];
  const fromOtherSite = site && site !== 'same-origin' && site !== 'none';
  return !!fromOtherSite && (request.method !== 'GET' || sameSiteOnlyPaths.has(path));
}

module.exports = { comesFromThisMachine, isRefusedFromOtherSites };
