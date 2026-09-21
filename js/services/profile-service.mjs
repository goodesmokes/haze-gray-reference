import { collection, doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { authorizationUpdateError, getAssignableRoles, isValidRole } from "../domain/authorization.mjs";
import { db } from "./firebase.mjs";

const FIRESTORE_API = { collection, doc, getDoc, onSnapshot, updateDoc };

export function createProfileService({ db: database, api = FIRESTORE_API }) {
  const subscribeAuthorizedUsers = (onProfiles, onError) => api.onSnapshot(
    api.collection(database, "users"),
    (snapshot) => {
      const profiles = snapshot.docs.map((item) => ({ ...item.data(), uid: item.id }));
      profiles.sort((a, b) => String(a.displayName || a.email || a.uid).localeCompare(String(b.displayName || b.email || b.uid)));
      onProfiles(profiles);
    },
    onError
  );

  const readAuthorizationProfile = (uid) => api.getDoc(api.doc(database, "users", uid));

  const updateAuthorizationProfile = (uid, changes) => api.updateDoc(api.doc(database, "users", uid), changes);

  const saveAuthorizationProfile = async (uid, changes, { getCurrentUid, getManagerProfile, requirePermission }) => {
    if (!requirePermission("canManageUsers")) throw new Error("You are not authorized to manage users.");
    const actingUid = getCurrentUid();
    if (!isValidRole(changes.role) || typeof changes.territory !== "string" || typeof changes.active !== "boolean") throw new Error("Enter a valid role, territory, and status.");
    if (!getAssignableRoles(getManagerProfile()).includes(changes.role)) throw new Error("You are not authorized to assign this role.");
    const existing = await readAuthorizationProfile(uid);
    if (!requirePermission("canManageUsers") || getCurrentUid() !== actingUid) throw new Error("Your authorization changed. Reopen Authorized Users to continue.");
    if (!existing.exists()) throw new Error("This authorization profile no longer exists.");
    const authorizationError = authorizationUpdateError(getManagerProfile(), actingUid, uid, existing.data(), changes);
    if (authorizationError) throw new Error(authorizationError);
    // updateDoc cannot recreate a deleted profile and preserves identity/other fields.
    await updateAuthorizationProfile(uid, { role: changes.role, territory: changes.territory.trim(), active: changes.active });
  };

  return { subscribeAuthorizedUsers, readAuthorizationProfile, updateAuthorizationProfile, saveAuthorizationProfile };
}

export const { subscribeAuthorizedUsers, readAuthorizationProfile, updateAuthorizationProfile, saveAuthorizationProfile } = createProfileService({ db });
