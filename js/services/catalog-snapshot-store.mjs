import { validateCatalogSnapshot } from "../domain/catalog-snapshot.mjs";

export const CATALOG_DATABASE_NAME = "haze-gray-reference";
export const CATALOG_DATABASE_VERSION = 1;
export const CATALOG_OBJECT_STORE = "public-catalog";
export const CATALOG_RECORD_KEY = "current";

function openCatalogDatabase(indexedDb) {
  if (!indexedDb || typeof indexedDb.open !== "function") return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(CATALOG_DATABASE_NAME, CATALOG_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CATALOG_OBJECT_STORE)) database.createObjectStore(CATALOG_OBJECT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the catalog database."));
    request.onblocked = () => reject(new Error("Catalog database upgrade is blocked."));
  });
}

export function createCatalogSnapshotStore(indexedDb = globalThis.indexedDB) {
  const load = async () => {
    const database = await openCatalogDatabase(indexedDb);
    try {
      const stored = await new Promise((resolve, reject) => {
        const transaction = database.transaction(CATALOG_OBJECT_STORE, "readonly");
        const request = transaction.objectStore(CATALOG_OBJECT_STORE).get(CATALOG_RECORD_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not read the catalog snapshot."));
        transaction.onabort = () => reject(transaction.error || new Error("Catalog snapshot read was aborted."));
      });
      if (stored === undefined) return null;
      try { return validateCatalogSnapshot(stored); } catch { return null; }
    } finally {
      database.close();
    }
  };

  const replace = async (snapshot) => {
    const validated = validateCatalogSnapshot(snapshot);
    const database = await openCatalogDatabase(indexedDb);
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(CATALOG_OBJECT_STORE, "readwrite");
        transaction.objectStore(CATALOG_OBJECT_STORE).put(validated, CATALOG_RECORD_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Could not store the catalog snapshot."));
        transaction.onabort = () => reject(transaction.error || new Error("Catalog snapshot replacement was aborted."));
      });
      return validated;
    } finally {
      database.close();
    }
  };

  return { load, replace };
}

export const catalogSnapshotStore = createCatalogSnapshotStore();
export const loadCatalogSnapshot = () => catalogSnapshotStore.load();
export const replaceCatalogSnapshot = (snapshot) => catalogSnapshotStore.replace(snapshot);
