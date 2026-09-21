import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { getProfilePermissions } from "../domain/authorization.mjs";
import { isAssignableRetailerUser, retailerAssignments, validateRepAssignments } from "../domain/assignments.mjs";
import { findDuplicateRetailer, validateRetailer } from "../domain/retailers.mjs";
import { retailerTerritoryFields, territoryDisplay } from "../domain/territories.mjs";
import { auth, db } from "./firebase.mjs";

const FIRESTORE_API = { collection, doc, getDocs, query, runTransaction, serverTimestamp, where };

export function createRetailerService({ db: database, auth: authentication, api = FIRESTORE_API }) {
  const checkNewRepAssignments = async (transaction, next, previous) => {
    validateRepAssignments(next);
    for (const uid of next.filter((id) => !previous.includes(id))) {
      const profile = await transaction.get(api.doc(database, "users", uid));
      if (!profile.exists() || !isAssignableRetailerUser(profile.data())) throw new Error("A selected user is no longer an active Owner, Admin, or Field Rep. Reopen assignment controls and try again.");
    }
  };

  const saveRetailerAssignments = async (id, next, expected, uid, requirePermission) => {
    const permitted = () => authentication.currentUser?.uid === uid && requirePermission("canAssignRetailers");
    if (!permitted()) throw new Error("You are not authorized to change retailer assignments.");
    validateRepAssignments(next);
    await api.runTransaction(database, async (transaction) => {
      const profile = await transaction.get(api.doc(database, "users", uid));
      if (!permitted() || !getProfilePermissions(profile.exists() ? profile.data() : null).canAssignRetailers) throw new Error("You are not authorized to change retailer assignments.");
      const ref = api.doc(database, "retailers", id), snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error("This retailer no longer exists.");
      const previous = retailerAssignments(snapshot.data());
      if (JSON.stringify(previous) !== JSON.stringify(expected)) throw new Error("Assignments changed while you were editing. Close and reopen to review the latest assignments.");
      await checkNewRepAssignments(transaction, next, previous);
      if (!permitted()) throw new Error("Your retailer assignment access changed.");
      transaction.update(ref, { assignedRepUids: next, updatedAt: api.serverTimestamp() });
    });
  };

  const saveRetailerProfile = async (id, input, uid, requirePermission) => {
    const permitted = () => authentication.currentUser?.uid === uid && requirePermission("canUseRetailers");
    if (!permitted()) throw new Error("You are not authorized to manage retailers.");
    const data = validateRetailer(input);
    if (id && Object.prototype.hasOwnProperty.call(input, "assignedRepUids")) throw new Error("Use Assigned Users to change retailer assignments.");
    if (!id) {
      // Advisory duplicate check, not a global uniqueness guarantee across simultaneous clients.
      const existing = await api.getDocs(api.query(api.collection(database, "retailers"), api.where("active", "==", true)));
      if (!permitted()) throw new Error("Your retailer access changed.");
      const duplicate = findDuplicateRetailer(existing.docs.map((item) => ({ ...item.data(), id: item.id })), data.name);
      if (duplicate) { const error = new Error("An active retailer with this name already exists."); error.retailerId = duplicate.id; throw error; }
    }
    const ref = id ? api.doc(database, "retailers", id) : api.doc(api.collection(database, "retailers"));
    await api.runTransaction(database, async (transaction) => {
      const profile = await transaction.get(api.doc(database, "users", uid));
      const permissions = getProfilePermissions(profile.exists() ? profile.data() : null);
      if (!permitted() || !permissions.canUseRetailers) throw new Error("Your retailer access changed.");
      const hasTerritoryInput = Object.prototype.hasOwnProperty.call(input, "territory") || Object.prototype.hasOwnProperty.call(input, "territoryNormalized");
      if (id && hasTerritoryInput && !permissions.canEditRetailerTerritory) throw new Error("You are not authorized to change retailer territory.");
      if (id) {
        const previous = await transaction.get(ref);
        if (!previous.exists()) throw new Error("This retailer no longer exists.");
        if (!permissions.canChangeRetailerStatus && (!previous.data().active || data.active !== previous.data().active)) throw new Error("You cannot change retailer status or edit an inactive retailer.");
        if (!permitted()) throw new Error("Your retailer access changed.");
        const territoryFields = permissions.canEditRetailerTerritory && hasTerritoryInput ? retailerTerritoryFields(input.territory ?? "") : {};
        transaction.update(ref, { ...data, ...territoryFields, updatedAt: api.serverTimestamp() });
      } else {
        if (!data.active) throw new Error("New retailers must be active.");
        const homeTerritory = territoryDisplay(profile.data().territory);
        if (!permissions.canEditRetailerTerritory && hasTerritoryInput && (input.territory !== homeTerritory || Object.prototype.hasOwnProperty.call(input, "territoryNormalized"))) throw new Error("New retailer territory must match your current user profile.");
        const territoryFields = retailerTerritoryFields(permissions.canEditRetailerTerritory ? (input.territory ?? "") : homeTerritory);
        const assignments = input.assignedRepUids === undefined ? [] : validateRepAssignments(input.assignedRepUids);
        if (!permissions.canAssignRetailers && Object.prototype.hasOwnProperty.call(input, "assignedRepUids")) throw new Error("You are not authorized to choose retailer assignments.");
        if (permissions.canAssignRetailers) await checkNewRepAssignments(transaction, assignments, []);
        if (!permitted()) throw new Error("Your retailer access changed.");
        transaction.set(ref, { ...data, ...territoryFields, assignedRepUids: assignments, schemaVersion: 1, creatorUid: uid, creatorDisplayName: profile.data().displayName, createdAt: api.serverTimestamp(), updatedAt: api.serverTimestamp() });
      }
    });
    return ref.id;
  };

  return { checkNewRepAssignments, saveRetailerAssignments, saveRetailerProfile };
}

export const { checkNewRepAssignments, saveRetailerAssignments, saveRetailerProfile } = createRetailerService({ db, auth });
