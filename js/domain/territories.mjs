import { normalizeRetailerName } from "./retailers.mjs";
import { retailerAssignments } from "./assignments.mjs";

export const territoryDisplay = (value) => typeof value === "string" ? value.trim() : "";
export const normalizeTerritory = (value) => normalizeRetailerName(territoryDisplay(value)).replace(/\s+/g, " ");
export const retailerTerritoryLabel = (retailer) => territoryDisplay(retailer?.territory) || "Unassigned Territory";

export function retailerTerritoryFields(value) {
  if (typeof value !== "string" || value.trim().length > 500) throw new Error("Territory must be text with at most 500 characters.");
  return { territory: value.trim(), territoryNormalized: normalizeTerritory(value) };
}

export function retailerTerritoryOptions(retailers, profiles, currentProfile) {
  const options = new Map();
  for (const value of [...retailers.map((item) => item.territory), ...profiles.filter((profile) => profile.active === true).map((profile) => profile.territory), currentProfile?.territory]) {
    const key = normalizeTerritory(value);
    if (key && !options.has(key)) options.set(key, territoryDisplay(value).replace(/\s+/g, " "));
  }
  return Array.from(options, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function filterRetailerTerritories(records, filter, homeTerritory) {
  const home = normalizeTerritory(homeTerritory);
  return records.filter((retailer) => {
    const territory = normalizeTerritory(retailer.territory);
    if (filter === "mine") return Boolean(home) && territory === home;
    if (filter === "other") return Boolean(territory) && territory !== home;
    if (filter === "unassigned") return !territory;
    if (filter.startsWith("territory:")) return territory === filter.slice(10);
    return true;
  });
}

export function territoryMismatches(retailer, profiles, canResolve) {
  if (!canResolve) return [];
  const home = normalizeTerritory(retailer?.territory);
  return profiles.filter((profile) => retailerAssignments(retailer).includes(profile.uid) && normalizeTerritory(profile.territory) !== home)
    .map((profile) => ({ uid: profile.uid, name: profile.displayName || "Unnamed user", territory: territoryDisplay(profile.territory) || "Unassigned Territory" }));
}
