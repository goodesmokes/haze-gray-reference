import { getNumericPrice, getSinglePrice } from "./pricing.mjs";
import { normalizeRetailerName, validRetailerId } from "./retailers.mjs";

export const nonnegativeMoney = (value) => Number.isFinite(value) && value >= 0 && value <= 1000000000;

export function isReadableSavedOrder(order) {
  // Rules deliberately do not validate every line. Do not render arbitrary objects as React children.
  return order && ["retailerName", "retailerNameNormalized", "retailerEmail", "notes", "creatorDisplayName"]
    .every((key) => order[key] == null || typeof order[key] === "string") &&
    Array.isArray(order.lineItems) && order.lineItems.length > 0 && order.lineItems.length <= 100 &&
    order.lineItems.every((line) => line &&
      ["cigarId", "sizeKey", "packKey", "cigarName", "vitola", "dims", "packLabel"].every((key) => typeof line[key] === "string") &&
      Number.isSafeInteger(line.qty) && line.qty > 0 && nonnegativeMoney(line.unitPrice) && nonnegativeMoney(line.wholesaleTotal)) &&
    order.totals && ["wholesaleTotal", "retailTotal", "grossProfit", "marginPct", "totalQuantity", "lineCount"]
      .every((key) => Number.isFinite(order.totals[key]));
}

export function buildSavedOrder(draft, user, profile) {
  if (!Array.isArray(draft.orderItems) || !draft.orderItems.length || draft.orderItems.length > 100) throw new Error("Save between 1 and 100 order lines.");
  if (![draft.orderRetailer, draft.orderEmail, draft.orderNotes].every((v) => typeof v === "string")) throw new Error("Invalid retailer or order information.");
  if (typeof profile.displayName !== "string" || profile.displayName.length > 500) throw new Error("Your authorization profile needs a valid display name.");
  const seen = new Set();
  const lineItems = draft.orderItems.map((line) => {
    // Existing drafts encode sizeKey in lineKey. Preserve that format; new records store it explicitly.
    if (!line || typeof line.lineKey !== "string") throw new Error("Invalid order line.");
    const prefix = `${line.cigarId}__`, suffix = `__${line.packKey}`;
    const sizeKey = line.sizeKey || (line.lineKey.startsWith(prefix) && line.lineKey.endsWith(suffix) ? line.lineKey.slice(prefix.length, -suffix.length) : "");
    if (typeof sizeKey !== "string" || !sizeKey || sizeKey.length > 500 || typeof line.cigarId !== "string" || !line.cigarId || line.cigarId.includes("/") || line.lineKey !== `${line.cigarId}__${sizeKey}__${line.packKey}` || seen.has(line.lineKey) || !["single", "box10", "box20", "bundle20"].includes(line.packKey) ||
        ![line.lineKey, line.cigarId, line.cigarName, line.vitola, line.dims, line.packLabel].every((v) => typeof v === "string" && v.length <= 500) ||
        !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 1000000 || !nonnegativeMoney(line.unitPrice) ||
        !(line.retailUnitValue === null || nonnegativeMoney(line.retailUnitValue))) throw new Error("The active order contains an invalid line. Review quantities and prices before saving.");
    seen.add(line.lineKey);
    const wholesaleTotal = line.unitPrice * line.qty;
    const retailTotal = (line.retailUnitValue ?? 0) * line.qty;
    if (!nonnegativeMoney(wholesaleTotal) || !nonnegativeMoney(retailTotal)) throw new Error("An order line exceeds the supported amount.");
    return { lineKey: line.lineKey, cigarId: line.cigarId, cigarName: line.cigarName, sizeKey, vitola: line.vitola, dims: line.dims,
      packKey: line.packKey, packLabel: line.packLabel, unitPrice: line.unitPrice, retailUnitValue: line.retailUnitValue, qty: line.qty,
      wholesaleTotal, retailTotal, grossProfit: retailTotal - wholesaleTotal };
  });
  const wholesaleTotal = lineItems.reduce((sum, line) => sum + line.wholesaleTotal, 0);
  const retailTotal = lineItems.reduce((sum, line) => sum + line.retailTotal, 0);
  if (!nonnegativeMoney(wholesaleTotal) || !nonnegativeMoney(retailTotal)) throw new Error("The order exceeds the supported total.");
  if (draft.orderRetailer.length > 500 || draft.orderEmail.length > 500 || draft.orderNotes.length > 10000) throw new Error("Retailer/email must be at most 500 characters and notes at most 10,000.");
  if (draft.retailerId != null && draft.retailerId !== "" && !validRetailerId(draft.retailerId)) throw new Error("Invalid retailer link.");
  const snapshot = { ...(draft.retailerId ? { retailerId: draft.retailerId } : {}), schemaVersion: 1, status: "saved", retailerName: draft.orderRetailer, retailerNameNormalized: normalizeRetailerName(draft.orderRetailer),
    retailerEmail: draft.orderEmail, notes: draft.orderNotes, creatorUid: user.uid, creatorDisplayName: profile.displayName || "", lineItems,
    totals: { wholesaleTotal, retailTotal, grossProfit: retailTotal - wholesaleTotal, marginPct: retailTotal > 0 ? ((retailTotal - wholesaleTotal) / retailTotal) * 100 : 0,
      totalQuantity: lineItems.reduce((sum, line) => sum + line.qty, 0), lineCount: lineItems.length } };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > 900000) throw new Error("Order snapshot exceeds the supported document size.");
  return snapshot;
}

export function buildReorderPlan(order, cigars, packOptions, activeItems) {
  const available = [], unavailable = [];
  for (const historical of order.lineItems || []) {
    const cigar = cigars.find((item) => item.id === historical.cigarId);
    const size = cigar?.sizes?.find((item) => item.key === historical.sizeKey);
    const pack = packOptions.find((item) => item.key === historical.packKey);
    const price = size && pack ? (pack.key === "single" ? getSinglePrice(size, "box") : getNumericPrice(size, pack.key)) : null;
    if (!cigar || !size || !pack || !nonnegativeMoney(price) || !Number.isSafeInteger(historical.qty) || historical.qty < 1) {
      unavailable.push({ ...historical, reason: !cigar ? "Product unavailable" : !size ? "Size unavailable" : !pack ? "Package unavailable" : "Current price or quantity unavailable" });
      continue;
    }
    const msrp = getNumericPrice(size, "msrp");
    const count = pack.key === "single" ? 1 : pack.key === "box10" ? 10 : 20;
    const lineKey = `${cigar.id}__${size.key}__${pack.key}`;
    const existing = activeItems.find((line) => line.lineKey === lineKey);
    available.push({ historicalPrice: historical.unitPrice, activePrice: existing?.unitPrice,
      line: { lineKey, cigarId: cigar.id, cigarName: cigar.name, vitola: size.vitola, dims: size.dims, packKey: pack.key, packLabel: pack.label,
        unitPrice: price, retailUnitValue: nonnegativeMoney(msrp) ? msrp * count : null, qty: historical.qty } });
  }
  return { available, unavailable };
}

export function mergeReorderItems(activeItems, newItems) {
  const merged = activeItems.map((line) => ({ ...line }));
  for (const line of newItems) {
    const index = merged.findIndex((item) => item.lineKey === line.lineKey);
    const qty = line.qty + (index >= 0 ? merged[index].qty : 0);
    if (!Number.isSafeInteger(qty) || qty < 1) throw new Error("Combined quantity is too large.");
    if (index >= 0) merged[index] = { ...line, qty };
    else merged.push({ ...line });
  }
  return merged;
}
