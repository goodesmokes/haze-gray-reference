import { isValidCatalogImageUrl } from "../domain/catalog-images.mjs";

export const CATALOG_IMAGE_CACHE_MESSAGE = "haze-gray-reference:catalog-images";
export const CATALOG_IMAGE_CACHE_NAME = "haze-gray-reference-catalog-images-v1";

export function catalogImagePaths(records) {
  if (!Array.isArray(records)) return [];
  return [...new Set(records.map((record) => record?.imageUrl)
    .filter((path) => path && isValidCatalogImageUrl(path)))].sort();
}

export async function requestCatalogImageCache(records, { authoritative = false, serviceWorker = globalThis.navigator?.serviceWorker } = {}) {
  if (!serviceWorker?.ready) return false;
  try {
    const registration = await serviceWorker.ready;
    const worker = serviceWorker.controller || registration.active;
    if (!worker) return false;
    worker.postMessage({ type: CATALOG_IMAGE_CACHE_MESSAGE, authoritative, paths: catalogImagePaths(records) });
    return true;
  } catch {
    return false;
  }
}

function validCachedCatalogImage(response) {
  return Boolean(response?.ok && response.status >= 200 && response.status < 300 &&
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "image/webp");
}

export async function recoverCatalogImageFromCache(image, path, {
  cacheStorage = globalThis.caches,
  origin = globalThis.location?.origin,
  createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
  revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL)
} = {}) {
  if (!image || image.dataset?.catalogCacheAttempted === "true" || !path ||
      !isValidCatalogImageUrl(path) || !cacheStorage?.open || !origin || !createObjectURL) return false;
  image.dataset.catalogCacheAttempted = "true";
  try {
    const cache = await cacheStorage.open(CATALOG_IMAGE_CACHE_NAME);
    const cached = await cache.match(new URL(path, origin).href, { ignoreVary: true });
    if (!validCachedCatalogImage(cached)) return false;
    const blob = await cached.blob();
    if (blob.type.toLowerCase() !== "image/webp") return false;
    const objectUrl = createObjectURL(blob);
    const release = () => revokeObjectURL?.(objectUrl);
    image.addEventListener?.("load", release, { once: true });
    image.addEventListener?.("error", release, { once: true });
    image.src = objectUrl;
    return true;
  } catch {
    return false;
  }
}

export async function handleCatalogImageError(event, path, dependencies) {
  const image = event.currentTarget;
  if (!await recoverCatalogImageFromCache(image, path, dependencies)) image.style.display = "none";
}
