// Phase 4B caches installation resources only, not the executable dependency
// graph or catalog. A cached index.html alone cannot provide offline startup.
const APP_SCOPE = "/haze-gray-reference/";
const CACHE_PREFIX = "haze-gray-reference-pwa-foundation-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const INDEX_PATH = `${APP_SCOPE}index.html`;
const FOUNDATION_PATHS = [
  INDEX_PATH,
  `${APP_SCOPE}manifest.webmanifest`,
  `${APP_SCOPE}js/pwa-register.mjs`,
  `${APP_SCOPE}assets/icons/icon-192.png`,
  `${APP_SCOPE}assets/icons/icon-512.png`,
  `${APP_SCOPE}assets/icons/icon-maskable-512.png`,
  `${APP_SCOPE}assets/icons/apple-touch-icon.png`
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    FOUNDATION_PATHS.map((path) => new Request(new URL(path, self.location.origin), { cache: "reload" }))
  )));
  // No skipWaiting: a replacement worker must not interrupt active drafts.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(
    names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name))
  )));
  // No clients.claim or forced reload. Existing pages keep their lifecycle.
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // An exact local allowlist avoids API, auth, user data, CDN and query caching.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search) return;

  if (request.mode === "navigate") {
    // Only known document entry points qualify; even an in-scope missing
    // module/image or arbitrary route must never receive HTML as a fallback.
    if (url.pathname !== APP_SCOPE && url.pathname !== INDEX_PATH) return;
    event.respondWith(fetch(request).catch(async (error) => {
      const cache = await caches.open(CACHE_NAME);
      const fallback = await cache.match(INDEX_PATH);
      if (fallback) return fallback;
      throw error;
    }));
    return;
  }

  if (!FOUNDATION_PATHS.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request);
    return cached || fetch(request);
  }));
  // No runtime cache writes, API interception or background synchronization.
});
