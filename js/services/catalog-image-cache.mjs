import { isValidCatalogImageUrl } from "../domain/catalog-images.mjs";

export const CATALOG_IMAGE_CACHE_MESSAGE = "haze-gray-reference:catalog-images";

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
