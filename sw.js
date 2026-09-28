const APP_SCOPE = "/haze-gray-reference/";
const CACHE_PREFIX = "haze-gray-reference-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}shell-v5`;
const IMAGE_CACHE_PREFIX = "haze-gray-reference-catalog-images-";
const IMAGE_CACHE_NAME = `${IMAGE_CACHE_PREFIX}v1`;
const CATALOG_IMAGE_MESSAGE = "haze-gray-reference:catalog-images";
const CATALOG_IMAGE_PATH = /^\/haze-gray-reference\/assets\/cigars\/[A-Za-z0-9][A-Za-z0-9_-]*[.]webp$/;
const INDEX_PATH = `${APP_SCOPE}index.html`;
const SHELL_PATHS = [
  INDEX_PATH,
  `${APP_SCOPE}manifest.webmanifest`,
  `${APP_SCOPE}js/pwa-register.mjs`,
  `${APP_SCOPE}assets/icons/icon-192.png`,
  `${APP_SCOPE}assets/icons/icon-512.png`,
  `${APP_SCOPE}assets/icons/icon-maskable-512.png`,
  `${APP_SCOPE}assets/icons/apple-touch-icon.png`,
  `${APP_SCOPE}js/app.jsx`,
  `${APP_SCOPE}js/components/authorization-ui.mjs`,
  `${APP_SCOPE}js/components/catalog-editor.mjs`,
  `${APP_SCOPE}js/components/catalog-list.mjs`,
  `${APP_SCOPE}js/components/cigar-detail.mjs`,
  `${APP_SCOPE}js/components/common-ui.mjs`,
  `${APP_SCOPE}js/components/comparison-view.mjs`,
  `${APP_SCOPE}js/components/detail-order-controls.mjs`,
  `${APP_SCOPE}js/components/final-review.mjs`,
  `${APP_SCOPE}js/components/order-builder.mjs`,
  `${APP_SCOPE}js/components/order-history.mjs`,
  `${APP_SCOPE}js/components/retailer-directory.mjs`,
  `${APP_SCOPE}js/components/retailer-editors.mjs`,
  `${APP_SCOPE}js/components/save-order-panel.mjs`,
  `${APP_SCOPE}js/domain/assignments.mjs`,
  `${APP_SCOPE}js/domain/authorization.mjs`,
  `${APP_SCOPE}js/domain/catalog-data.mjs`,
  `${APP_SCOPE}js/domain/catalog-images.mjs`,
  `${APP_SCOPE}js/domain/catalog-snapshot.mjs`,
  `${APP_SCOPE}js/domain/pricing.mjs`,
  `${APP_SCOPE}js/domain/retailers.mjs`,
  `${APP_SCOPE}js/domain/saved-orders.mjs`,
  `${APP_SCOPE}js/domain/territories.mjs`,
  `${APP_SCOPE}js/services/auth-service.mjs`,
  `${APP_SCOPE}js/services/catalog-image-cache.mjs`,
  `${APP_SCOPE}js/services/catalog-service.mjs`,
  `${APP_SCOPE}js/services/catalog-snapshot-store.mjs`,
  `${APP_SCOPE}js/services/firebase.mjs`,
  `${APP_SCOPE}js/services/order-service.mjs`,
  `${APP_SCOPE}js/services/profile-service.mjs`,
  `${APP_SCOPE}js/services/retailer-service.mjs`,
  `${APP_SCOPE}js/ui/styles.mjs`,
  `${APP_SCOPE}vendor/babel/7.24.7/babel.min.js`,
  `${APP_SCOPE}vendor/react/18.3.1/react.mjs`,
  `${APP_SCOPE}vendor/react-dom/18.3.1/client.mjs`,
  `${APP_SCOPE}vendor/react-dom/18.3.1/react-dom.mjs`,
  `${APP_SCOPE}vendor/scheduler/0.23.2/scheduler.mjs`,
  `${APP_SCOPE}vendor/lucide-react/0.383.0/lucide-react.mjs`,
  `${APP_SCOPE}vendor/firebase/10.12.2/firebase-app.js`,
  `${APP_SCOPE}vendor/firebase/10.12.2/firebase-auth.js`,
  `${APP_SCOPE}vendor/firebase/10.12.2/firebase-firestore.js`
];

function catalogImageUrl(value) {
  if (typeof value !== "string") return null;
  const url = new URL(value, self.location.origin);
  if (url.origin !== self.location.origin || url.search || url.hash || url.pathname !== value || !CATALOG_IMAGE_PATH.test(url.pathname)) return null;
  return url;
}

function validCatalogImageResponse(response) {
  return Boolean(response?.ok && response.status >= 200 && response.status < 300 &&
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "image/webp");
}

async function refreshCatalogImage(cache, path) {
  try {
    const request = new Request(new URL(path, self.location.origin), { cache: "reload" });
    const response = await fetch(request);
    if (!validCatalogImageResponse(response)) return false;
    await cache.put(request, response.clone());
    return true;
  } catch {
    return false;
  }
}

async function synchronizeCatalogImages(paths, authoritative) {
  const desired = new Set(paths.map((path) => catalogImageUrl(path)?.pathname).filter(Boolean));
  const cache = await caches.open(IMAGE_CACHE_NAME);
  await Promise.allSettled([...desired].map((path) => refreshCatalogImage(cache, path)));
  if (!authoritative) return;
  const entries = await cache.keys();
  await Promise.allSettled(entries.map((request) => {
    const url = catalogImageUrl(new URL(request.url).pathname);
    return url && !desired.has(url.pathname) ? cache.delete(request) : Promise.resolve(false);
  }));
}

async function catalogImageResponse(request) {
  let cache = null;
  let networkResponse = null;
  try { cache = await caches.open(IMAGE_CACHE_NAME); } catch { /* Network use can continue without Cache Storage. */ }
  try {
    networkResponse = await fetch(new Request(request, { cache: "no-cache" }));
    if (validCatalogImageResponse(networkResponse)) {
      if (cache) await cache.put(request, networkResponse.clone()).catch(() => {});
      return networkResponse;
    }
  } catch { /* Fall through to the last cached image. */ }
  const cached = cache ? await cache.match(request).catch(() => null) : null;
  return cached || networkResponse || Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(SHELL_PATHS.map((path) => (
        new Request(new URL(path, self.location.origin), { cache: "reload" })
      )));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
  // No skipWaiting: a replacement worker must not interrupt active drafts.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(
    names.filter((name) => (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) ||
      (name.startsWith(IMAGE_CACHE_PREFIX) && name !== IMAGE_CACHE_NAME))
      .map((name) => caches.delete(name).catch(() => false))
  )));
  // No clients.claim or forced reload. Existing pages keep their lifecycle.
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type !== CATALOG_IMAGE_MESSAGE || !Array.isArray(data.paths)) return;
  event.waitUntil(synchronizeCatalogImages(data.paths, data.authoritative === true).catch(() => {}));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Only exact, query-free, same-origin shell resources are intercepted.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search) return;

  if (!url.hash && catalogImageUrl(url.pathname)) {
    event.respondWith(catalogImageResponse(request));
    return;
  }

  if (request.mode === "navigate") {
    if (url.pathname !== APP_SCOPE && url.pathname !== INDEX_PATH) return;
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      // A controlled page stays on one coherent shell version. The browser
      // checks sw.js separately and a replacement worker waits normally.
      const fallback = await cache.match(INDEX_PATH);
      return fallback || fetch(request);
    }));
    return;
  }

  if (!SHELL_PATHS.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request);
    return cached || fetch(request);
  }));
  // No runtime cache writes, API interception or background synchronization.
});
