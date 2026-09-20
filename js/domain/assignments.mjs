import { ROLE_LABELS } from "./authorization.mjs";

export const retailerAssignments = (retailer) => Array.isArray(retailer?.assignedRepUids) ? retailer.assignedRepUids : [];
export const isAssignableRetailerUser = (profile) => profile?.active === true && ["owner", "admin", "field_rep"].includes(profile.role);

export function validateRepAssignments(uids) {
  if (!Array.isArray(uids) || uids.length > 10 || new Set(uids).size !== uids.length || uids.some((uid) => typeof uid !== "string" || !uid.length || uid.length > 128 || uid.includes("/"))) throw new Error("Choose up to 10 different users.");
  return [...uids];
}

export function assignedRepLabel(uid, currentUid, canResolve, profiles) {
  if (!canResolve) return uid === currentUid ? "You" : "Other assigned user";
  const profile = profiles.find((item) => item.uid === uid);
  if (!profile) return "Unavailable user";
  const name = profile.displayName || "Unnamed user";
  const role = ROLE_LABELS[profile.role] || "Unknown role";
  if (profile.active !== true) return name + " — Inactive " + role;
  return name + " — " + role + (isAssignableRetailerUser(profile) ? " (Active)" : " (Active; not assignable)");
}

export function assignmentSummary(retailer, uid, canResolve, profiles, compact = false) {
  const assigned = retailerAssignments(retailer);
  if (!assigned.length) return "Unassigned";
  const labels = assigned.map((id) => assignedRepLabel(id, uid, canResolve, profiles));
  return "Assigned (" + assigned.length + "): " + (compact && labels.length > 2 ? labels[0] + " +" + (labels.length - 1) : labels.join(", "));
}

export function filterRetailerAssignments(records, filter, uid) {
  return records.filter((retailer) => {
    const assigned = retailerAssignments(retailer);
    if (filter === "mine") return assigned.includes(uid);
    if (filter === "assigned") return assigned.length > 0;
    if (filter === "unassigned") return assigned.length === 0;
    if (filter.startsWith("rep:")) return assigned.includes(filter.slice(4));
    return true;
  });
}
