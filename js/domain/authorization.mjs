export const ROLE_LABELS = Object.freeze({ owner: "Owner", admin: "Admin", field_rep: "Field Rep", viewer: "Viewer" });
export const NO_PERMISSIONS = Object.freeze({
  canEditCatalog: false, canEditPackages: false, canUseOrderBuilder: false,
  canUseFinalReview: false, canManageUsers: false, canMigrateLegacyData: false,
  canManageOwners: false, canUseRetailers: false, canChangeRetailerStatus: false, canAssignRetailers: false, canFilterOwnRetailers: false, canEditRetailerTerritory: false,
});
export const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze({ ...NO_PERMISSIONS, canEditCatalog: true, canEditPackages: true, canUseOrderBuilder: true, canUseFinalReview: true, canManageUsers: true, canUseRetailers: true, canChangeRetailerStatus: true, canAssignRetailers: true, canEditRetailerTerritory: true, canFilterOwnRetailers: true, canMigrateLegacyData: true, canManageOwners: true }),
  admin: Object.freeze({ ...NO_PERMISSIONS, canEditCatalog: true, canEditPackages: true, canUseOrderBuilder: true, canUseFinalReview: true, canManageUsers: true, canUseRetailers: true, canChangeRetailerStatus: true, canAssignRetailers: true, canEditRetailerTerritory: true, canFilterOwnRetailers: true }),
  field_rep: Object.freeze({ ...NO_PERMISSIONS, canUseOrderBuilder: true, canUseFinalReview: true, canUseRetailers: true, canFilterOwnRetailers: true }),
  viewer: NO_PERMISSIONS,
});
export const isValidRole = (role) => typeof role === "string" && Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role);
export const isActiveProfile = (profile) => profile?.active === true && isValidRole(profile.role);
export const getProfilePermissions = (profile) => isActiveProfile(profile) ? ROLE_PERMISSIONS[profile.role] : NO_PERMISSIONS;
export const getAssignableRoles = (managerProfile) => {
  const permissions = getProfilePermissions(managerProfile);
  if (!permissions.canManageUsers) return [];
  return Object.keys(ROLE_LABELS).filter((role) => role !== "owner" || permissions.canManageOwners);
};
export const canManageAuthorizationProfile = (managerProfile, profile) => Boolean(profile &&
  getProfilePermissions(managerProfile).canManageUsers &&
  (getProfilePermissions(managerProfile).canManageOwners || getAssignableRoles(managerProfile).includes(profile.role)));
export const authorizationUpdateError = (managerProfile, currentUid, targetUid, profile, changes) => {
  if (!canManageAuthorizationProfile(managerProfile, profile)) return "You are not authorized to edit this authorization profile.";
  if (!getAssignableRoles(managerProfile).includes(changes.role)) return "You are not authorized to assign this role.";
  if (currentUid === targetUid) {
    if (changes.role !== profile.role) return "You cannot change your own authorization role.";
    if (changes.active !== true) return "You cannot disable your own authorization profile.";
  }
  return "";
};
