import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase.mjs";
import { validateCatalogImage } from "../domain/catalog-images.mjs";

const FIRESTORE_API = { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, setDoc };

export function createCatalogService(database, api = FIRESTORE_API) {
  const cigarsCollection = api.collection(database, "cigars");
  const legacyDocument = api.doc(database, "app-data", "cigars");

  const subscribeCatalog = (onRecords, onError) => api.onSnapshot(
    cigarsCollection,
    (snapshot) => onRecords(snapshot.docs.map((item) => ({ ...item.data(), id: item.id }))),
    onError
  );

  const isLegacyCatalogMigrationAvailable = async () => {
    const [catalogSnapshot, legacySnapshot] = await Promise.all([
      api.getDocs(cigarsCollection),
      api.getDoc(legacyDocument)
    ]);
    return catalogSnapshot.empty && legacySnapshot.exists() && Boolean(legacySnapshot.data().payload);
  };

  const saveCatalogRecord = async (record) => {
    validateCatalogImage(record);
    return api.setDoc(api.doc(database, "cigars", record.id), record);
  };
  const deleteCatalogRecord = (id) => api.deleteDoc(api.doc(database, "cigars", id));

  const readLegacyCatalog = async () => {
    const snapshot = await api.getDoc(legacyDocument);
    if (!snapshot.exists() || !snapshot.data().payload) return null;
    const records = JSON.parse(snapshot.data().payload);
    if (!Array.isArray(records)) throw new Error("Legacy catalog must be an array.");
    // Preflight the entire import before the caller starts sequential writes.
    records.forEach(validateCatalogImage);
    return records;
  };

  return {
    CIGARS_COL: cigarsCollection,
    LEGACY_DOC: legacyDocument,
    subscribeCatalog,
    isLegacyCatalogMigrationAvailable,
    saveCatalogRecord,
    deleteCatalogRecord,
    readLegacyCatalog
  };
}

export const {
  CIGARS_COL,
  LEGACY_DOC,
  subscribeCatalog,
  isLegacyCatalogMigrationAvailable,
  saveCatalogRecord,
  deleteCatalogRecord,
  readLegacyCatalog
} = createCatalogService(db);
