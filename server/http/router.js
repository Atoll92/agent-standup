// Finds the route of a request (see routes.js). A path is matched whole: '/api/sessions' exactly, ':name' one part of it, '*name' the rest of it.
// `constraints` say which values a part may take: { name: (value) => true | false }.
class Router {
  #routes;
  #fallback;

  constructor(routes, fallback) {
    this.#routes = routes.map((route) => ({ ...route, pattern: patternOf(route.path) }));
    this.#fallback = fallback;
  }

  // The paths of the routes marked sameSiteOnly.
  get sameSiteOnlyPaths() { return new Set(this.#routes.filter((route) => route.sameSiteOnly).map((route) => route.path)); }

  // { to: 'controller#action', params }
  match(method, path) {
    for (const route of this.#routes) {
      if (route.method !== '*' && route.method !== method) continue;
      const params = route.pattern(path);
      if (params && satisfies(params, route.constraints)) return { to: route.to, params };
    }
    return { to: this.#fallback, params: {} };
  }
}

// A function of a path, giving its parameters ({} when there are none), or null when the path is not that route's.
function patternOf(path) {
  const names = [];
  const source = path.split(/(:\w+|\*\w+)/).map((part) => {
    if (part.startsWith(':')) { names.push(part.slice(1)); return '([^/]+)'; }
    if (part.startsWith('*')) { names.push(part.slice(1)); return '(.*)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  const regexp = new RegExp('^' + source + '$');
  return (candidate) => {
    const match = regexp.exec(candidate);
    return match && Object.fromEntries(names.map((name, index) => [name, match[index + 1]]));
  };
}

const satisfies = (params, constraints = {}) => Object.entries(constraints).every(([name, allows]) => allows(params[name]));

module.exports = { Router };
