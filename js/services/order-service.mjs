import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { getProfilePermissions } from "../domain/authorization.mjs";
import { buildReorderPlan, buildSavedOrder, isReadableSavedOrder } from "../domain/saved-orders.mjs";
import { auth, db } from "./firebase.mjs";

const FIRESTORE_API = { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, where };

export function createOrderService({ db: database, auth: authentication, api = FIRESTORE_API }) {
  const savePendingOrder = async (pending, uid, permitted, cigars, packOptions) => {
    if (!permitted() || authentication.currentUser?.uid !== uid) throw new Error("You are not authorized to save orders.");
    if (pending?.uid !== uid || typeof pending.id !== "string" || !/^[a-zA-Z0-9]{20}$/.test(pending.id)) throw new Error("Invalid pending save identity.");
    return api.runTransaction(database, async (transaction) => {
      const ref = api.doc(database, "orders", pending.id);
      const existing = await transaction.get(ref);
      if (!permitted() || authentication.currentUser?.uid !== uid) throw new Error("Your order access changed.");
      if (existing.exists()) {
        if (existing.data().creatorUid !== uid) throw new Error("This order ID belongs to another account.");
        return;
      }
      const profileDoc = await transaction.get(api.doc(database, "users", uid));
      const currentProfile = profileDoc.exists() ? profileDoc.data() : null;
      if (!getProfilePermissions(currentProfile).canUseFinalReview) throw new Error("Your account is not authorized to save orders.");
      const payload = pending.payload;
      if (payload?.creatorUid !== uid || payload.schemaVersion !== 1 || payload.status !== "saved") throw new Error("Invalid pending order snapshot.");
      const snapshot = buildSavedOrder({ orderItems: payload.lineItems, orderRetailer: payload.retailerName, orderEmail: payload.retailerEmail, orderNotes: payload.notes, retailerId: payload.retailerId }, { uid }, currentProfile);
      const plan = buildReorderPlan(snapshot, cigars, packOptions, []);
      if (plan.unavailable.length) throw new Error("A captured product, size or package is no longer available. Restore that configuration before retrying this captured save.");
      if (!permitted() || authentication.currentUser?.uid !== uid) throw new Error("Your order access changed.");
      transaction.set(ref, { ...snapshot, savedAt: api.serverTimestamp() });
    });
  };

  const subscribeOrderHistory = ({ allOrders, uid }, onRecords, onError) => {
    const scope = allOrders
      ? api.query(api.collection(database, "orders"), api.orderBy("savedAt", "desc"))
      : api.query(api.collection(database, "orders"), api.where("creatorUid", "==", uid), api.orderBy("savedAt", "desc"));
    return api.onSnapshot(scope, (snapshot) => {
      const records = snapshot.docs
        .filter((item) => !item.metadata.hasPendingWrites && (allOrders || item.data().creatorUid === uid))
        .map((item) => ({ ...item.data(), id: item.id }));
      const readable = records.filter(isReadableSavedOrder);
      onRecords(readable, records.length - readable.length);
    }, onError);
  };

  return { savePendingOrder, subscribeOrderHistory };
}

export const { savePendingOrder, subscribeOrderHistory } = createOrderService({ db, auth });
