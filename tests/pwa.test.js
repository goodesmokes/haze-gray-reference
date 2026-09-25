const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const scope = '/haze-gray-reference/';
const origin = 'https://goodesmokes.github.io';
const foundation = ['index.html', 'manifest.webmanifest', 'js/pwa-register.mjs', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png', 'assets/icons/apple-touch-icon.png'].map(name => scope + name);
const cacheName = 'haze-gray-reference-pwa-foundation-v1';

function worker({ network = async () => new Response('network'), entries = new Map(), names = [], installFailure = false } = {}) {
  const handlers = new Map(), opened = [], deleted = [], added = [], fetched = [];
  const cache = {
    addAll: async requests => {
      added.push(...requests);
      if (installFailure) throw new Error('install unavailable');
    },
    match: async request => entries.get(new URL(typeof request === 'string' ? request : request.url, origin).pathname)
  };
  vm.runInNewContext(read('sw.js'), {
    URL, Request, Response,
    self: { location: { origin }, addEventListener: (name, fn) => handlers.set(name, fn), skipWaiting: () => assert.fail('forced activation'), clients: { claim: () => assert.fail('forced control') } },
    caches: { open: async name => { opened.push(name); return cache; }, keys: async () => names, delete: async name => { deleted.push(name); return true; } },
    fetch: async request => { fetched.push(request.url); return network(request); }
  });
  return {
    handlers, opened, deleted, added, fetched,
    lifecycle: name => { let result; handlers.get(name)({ waitUntil: promise => { result = promise; } }); return result; },
    request: (url, mode = 'cors', method = 'GET') => {
      let response;
      handlers.get('fetch')({ request: { url: new URL(url, origin).href, mode, method }, respondWith: promise => { response = promise; } });
      return response;
    }
  };
}

test('PWA manifest and icon dimensions use the exact GitHub Pages project path', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const field of ['id', 'start_url', 'scope']) assert.equal(manifest[field], scope);
  assert.equal(manifest.name, 'Haze Gray Reference');
  assert.equal(manifest.short_name, 'Haze Gray');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#14161A');
  assert.equal(manifest.background_color, '#14161A');
  assert.deepEqual(manifest.icons.map(icon => [icon.sizes, icon.purpose]), [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]);
  for (const icon of [...manifest.icons, { src: scope + 'assets/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]) {
    assert(icon.src.startsWith(scope + 'assets/icons/'));
    assert.equal(icon.type, 'image/png');
    const bytes = fs.readFileSync(path.join(root, icon.src.slice(scope.length)));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16) + 'x' + bytes.readUInt32BE(20), icon.sizes);
  }
});

test('HTML links installation resources without replacing the existing application bootstrap', () => {
  const html = read('index.html');
  assert.match(html, /rel="manifest" href="\.\/manifest.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\.\/assets\/icons\/apple-touch-icon.png"/);
  assert.match(html, /name="theme-color" content="#14161A"/);
  assert.match(html, /type="module" src="\.\/js\/pwa-register.mjs"/);
  assert.match(html, /type="importmap"/);
  assert.match(html, /type="text\/babel" data-type="module" data-presets="react" src="\.\/js\/app.jsx"/);
});

function registration({ ready = 'complete', secure = true, supported = true, pathname = scope, failure = false } = {}) {
  const calls = [], events = [], warnings = [];
  vm.runInNewContext(read('js/pwa-register.mjs'), {
    window: { isSecureContext: secure, location: { pathname, reload: () => assert.fail('forced reload') }, addEventListener: (type, fn, options) => events.push({ type, fn, options }) },
    document: { readyState: ready },
    navigator: supported ? { serviceWorker: { register: (url, options) => { calls.push({ url, options }); return failure ? Promise.reject(new Error('blocked')) : Promise.resolve({}); } } } : {},
    console: { warn: (...args) => warnings.push(args) }
  });
  return { calls, events, warnings };
}

test('registration is scoped, nonblocking, feature-detected and never reloads a page', async () => {
  const loaded = registration();
  assert.equal(loaded.calls.length, 1);
  assert.equal(loaded.calls[0].url, scope + 'sw.js');
  assert.equal(loaded.calls[0].options.scope, scope);
  assert.equal(loaded.calls[0].options.updateViaCache, 'none');
  const loading = registration({ ready: 'loading' });
  assert.equal(loading.calls.length, 0);
  assert.equal(loading.events[0].type, 'load');
  assert.equal(loading.events[0].options.once, true);
  loading.events[0].fn();
  assert.equal(loading.calls.length, 1);
  for (const options of [{ secure: false }, { supported: false }, { pathname: '/' }, { pathname: '/haze-gray-reference-other/' }]) assert.equal(registration(options).calls.length, 0);
  const failed = registration({ failure: true });
  await Promise.resolve();
  assert.equal(failed.warnings.length, 1);
});

test('install caches only the seven deterministic local foundation resources', async () => {
  const app = worker();
  await app.lifecycle('install');
  assert.deepEqual(app.opened, [cacheName]);
  assert.deepEqual(app.added.map(request => new URL(request.url).pathname), foundation);
  for (const request of app.added) {
    assert.equal(new URL(request.url).origin, origin);
    assert.equal(request.cache, 'reload');
    assert(fs.existsSync(path.join(root, new URL(request.url).pathname.slice(scope.length))));
  }
  await assert.rejects(worker({ installFailure: true }).lifecycle('install'), /install unavailable/);
});

test('activation deletes only older application foundation caches without taking over active clients', async () => {
  const old = 'haze-gray-reference-pwa-foundation-v0';
  const app = worker({ names: [old, cacheName, 'another-app-v1', 'haze-gray-reference-catalog-v1'] });
  await app.lifecycle('activate');
  assert.deepEqual(app.deleted, [old]);
  assert.deepEqual([...app.handlers.keys()], ['install', 'activate', 'fetch']);
});

test('only root and index navigation receive cached HTML on network failure', async () => {
  for (const endpoint of [scope, scope + 'index.html']) {
    const app = worker({ network: async () => { throw new Error('offline'); }, entries: new Map([[scope + 'index.html', new Response('shell')]]) });
    assert.equal(await (await app.request(endpoint, 'navigate')).text(), 'shell');
  }
  const online = worker({ network: async () => new Response('fresh') });
  assert.equal(await (await online.request(scope, 'navigate')).text(), 'fresh');
  const missing = worker({ network: async () => new Response('not found', { status: 404 }) });
  assert.equal((await missing.request(scope, 'navigate')).status, 404);
  const noCache = worker({ network: async () => { throw new Error('offline'); } });
  await assert.rejects(noCache.request(scope, 'navigate'), /offline/);
});

test('static-resource failures never receive the cached index document', async () => {
  const app = worker({ network: async () => { throw new Error('offline'); }, entries: new Map([[scope + 'index.html', new Response('shell')]]) });
  for (const resource of ['js/missing.mjs', 'assets/cigars/missing.webp', 'missing.webmanifest', 'assets/icons/missing.png']) {
    assert.equal(app.request(scope + resource), undefined);
    assert.equal(app.request(scope + resource, 'navigate'), undefined);
  }
  for (const resource of ['manifest.webmanifest', 'assets/icons/icon-192.png', 'js/pwa-register.mjs']) {
    await assert.rejects(app.request(scope + resource), /offline/);
    assert.equal(app.request(scope + resource, 'navigate'), undefined);
  }
});

test('API, Firebase, auth, orders, profiles, retailers, CDN and out-of-scope requests are untouched', () => {
  const app = worker();
  const urls = ['/', '/other-app/', '/haze-gray-reference-other/', scope + 'api/cigars', scope + 'orders', scope + 'users', scope + 'profiles', scope + 'retailers', scope + 'auth', scope + 'pending-order', scope + '?token=example', scope + 'manifest.webmanifest?token=example', 'https://firestore.googleapis.com/v1/projects/test', 'https://identitytoolkit.googleapis.com/v1/accounts:lookup', 'https://securetoken.googleapis.com/v1/token', 'https://haze-gray-cigars.firebaseapp.com/__/auth/handler', 'https://esm.sh/react@18.3.1', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'];
  for (const url of urls) for (const mode of ['cors', 'navigate']) assert.equal(app.request(url, mode), undefined, url);
  assert.equal(app.request(scope, 'navigate', 'POST'), undefined);
  assert.equal(app.request(scope + 'manifest.webmanifest', 'cors', 'POST'), undefined);
  assert.deepEqual(app.opened, []);
  assert.deepEqual(app.fetched, []);
  assert.deepEqual(app.added, []);
});

test('cached static responses are exact resources and misses do not populate a runtime cache', async () => {
  const target = scope + 'manifest.webmanifest';
  const app = worker({ entries: new Map([[target, new Response('manifest')]]) });
  assert.equal(await (await app.request(target)).text(), 'manifest');
  assert.deepEqual(app.fetched, []);
  assert.equal(await (await app.request(scope + 'assets/icons/icon-192.png')).text(), 'network');
  assert.deepEqual(app.added, []);
});
