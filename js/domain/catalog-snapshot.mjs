import { isValidCatalogImageUrl } from "./catalog-images.mjs";

export const CATALOG_SNAPSHOT_SCHEMA_VERSION = 1;

// These are storage-safety bounds, not catalog business limits. They are far
// above the current data and prevent a malformed value from monopolizing local
// browser storage or parser memory.
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_SNAPSHOT_BYTES = 8_000_000;
const DOCUMENT_ID_BYTES = 1_500;

const RECORD_FIELDS = [
  "id", "name", "line", "imageUrl", "wrapper", "binder", "filler", "origin",
  "strength", "body", "tastingNotes", "pairings", "sizes", "notes"
];
const SIZE_FIELDS = [
  "key", "vitola", "dims", "msrp", "keystoneSingle", "keystoneBox10",
  "keystoneBox20", "keystoneBundle20", "pricing"
];
const PRICING_FIELDS = ["msrp", "boxSingle", "bundleSingle", "box10", "box20", "bundle20"];
const ENVELOPE_FIELDS = ["schemaVersion", "serverConfirmedAt", "records", "confirmedEmpty"];

const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function assertExactKeys(value, allowed, label, required = allowed) {
  if (!plainObject(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${label} contains unsupported fields.`);
  }
  if (required.some((key) => !(key in value))) throw new Error(`${label} is missing required fields.`);
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) throw new Error(`${label} must be a string.`);
  return value;
}

function optionalString(value, label, strict = false) {
  if (value === undefined && !strict) return "";
  return requiredString(value, label);
}

function stringArray(value, label, strict = false) {
  if (value === undefined && !strict) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item, index) => requiredString(item, `${label}[${index}]`));
}

function rating(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function validDocumentId(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("/") &&
    new TextEncoder().encode(value).length <= DOCUMENT_ID_BYTES;
}

function projectPricing(value, label, strict) {
  if (value === undefined) return undefined;
  if (!plainObject(value)) throw new Error(`${label} must be an object.`);
  if (strict) assertExactKeys(value, PRICING_FIELDS, label, []);
  const pricing = {};
  for (const field of PRICING_FIELDS) {
    if (!(field in value)) continue;
    const amount = value[field];
    if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount))) {
      throw new Error(`${label}.${field} must be a finite number or null.`);
    }
    pricing[field] = amount;
  }
  return pricing;
}

function projectSize(value, index, strict) {
  const label = `sizes[${index}]`;
  if (!plainObject(value)) throw new Error(`${label} must be an object.`);
  if (strict) assertExactKeys(value, SIZE_FIELDS, label, SIZE_FIELDS.filter((field) => field !== "pricing"));
  const size = {
    key: optionalString(value.key, `${label}.key`, strict),
    vitola: optionalString(value.vitola, `${label}.vitola`, strict),
    dims: optionalString(value.dims, `${label}.dims`, strict),
    msrp: optionalString(value.msrp, `${label}.msrp`, strict),
    keystoneSingle: optionalString(value.keystoneSingle, `${label}.keystoneSingle`, strict),
    keystoneBox10: optionalString(value.keystoneBox10, `${label}.keystoneBox10`, strict),
    keystoneBox20: optionalString(value.keystoneBox20, `${label}.keystoneBox20`, strict),
    keystoneBundle20: optionalString(value.keystoneBundle20, `${label}.keystoneBundle20`, strict)
  };
  const pricing = projectPricing(value.pricing, `${label}.pricing`, strict);
  if (pricing !== undefined) size.pricing = pricing;
  return size;
}

function projectRecord(value, strict) {
  if (!plainObject(value)) throw new Error("Catalog record must be an object.");
  if (strict) assertExactKeys(value, RECORD_FIELDS, "Catalog record");
  if (!validDocumentId(value.id)) throw new Error("Catalog document ID is invalid.");
  if (!Array.isArray(value.sizes)) throw new Error(`Catalog record ${value.id} sizes must be an array.`);
  const imageUrl = optionalString(value.imageUrl, `Catalog record ${value.id} imageUrl`, strict);
  if (!isValidCatalogImageUrl(imageUrl)) throw new Error(`Catalog record ${value.id} imageUrl is invalid.`);
  return {
    id: value.id,
    name: requiredString(value.name, `Catalog record ${value.id} name`),
    line: optionalString(value.line, `Catalog record ${value.id} line`, strict),
    imageUrl,
    wrapper: optionalString(value.wrapper, `Catalog record ${value.id} wrapper`, strict),
    binder: optionalString(value.binder, `Catalog record ${value.id} binder`, strict),
    filler: optionalString(value.filler, `Catalog record ${value.id} filler`, strict),
    origin: optionalString(value.origin, `Catalog record ${value.id} origin`, strict),
    strength: rating(value.strength, `Catalog record ${value.id} strength`),
    body: rating(value.body, `Catalog record ${value.id} body`),
    tastingNotes: stringArray(value.tastingNotes, `Catalog record ${value.id} tastingNotes`, strict),
    pairings: stringArray(value.pairings, `Catalog record ${value.id} pairings`, strict),
    sizes: value.sizes.map((size, index) => projectSize(size, index, strict)),
    notes: optionalString(value.notes, `Catalog record ${value.id} notes`, strict)
  };
}

function assertSnapshotSize(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes > MAX_SNAPSHOT_BYTES) throw new Error("Catalog snapshot exceeds the local storage safety limit.");
}

export function projectPublicCatalog(records) {
  if (!Array.isArray(records)) throw new Error("Catalog records must be an array.");
  const projected = records.map((record) => projectRecord(record, false));
  const ids = new Set();
  for (const record of projected) {
    if (ids.has(record.id)) throw new Error(`Duplicate catalog document ID: ${record.id}`);
    ids.add(record.id);
  }
  assertSnapshotSize(projected);
  return projected;
}

export function isTrustedCatalogEvent(event) {
  return Boolean(event?.complete === true && event.metadata?.fromCache === false && event.metadata?.hasPendingWrites === false);
}

export function createCatalogSnapshot(event, observedAt = new Date()) {
  if (!isTrustedCatalogEvent(event)) throw new Error("Catalog event is not server-confirmed.");
  const records = projectPublicCatalog(event.records);
  const date = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (!Number.isFinite(date.getTime())) throw new Error("Catalog confirmation time is invalid.");
  const snapshot = {
    schemaVersion: CATALOG_SNAPSHOT_SCHEMA_VERSION,
    serverConfirmedAt: date.toISOString(),
    records,
    confirmedEmpty: records.length === 0
  };
  assertSnapshotSize(snapshot);
  return snapshot;
}

export function validateCatalogSnapshot(value) {
  assertExactKeys(value, ENVELOPE_FIELDS, "Catalog snapshot");
  if (value.schemaVersion !== CATALOG_SNAPSHOT_SCHEMA_VERSION) throw new Error("Unsupported catalog snapshot schema.");
  if (typeof value.serverConfirmedAt !== "string" || !Number.isFinite(Date.parse(value.serverConfirmedAt))) {
    throw new Error("Catalog snapshot confirmation time is invalid.");
  }
  if (typeof value.confirmedEmpty !== "boolean") throw new Error("Catalog snapshot empty marker is invalid.");
  if (!Array.isArray(value.records)) throw new Error("Catalog snapshot records must be an array.");
  const records = value.records.map((record) => projectRecord(record, true));
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`Duplicate catalog document ID: ${record.id}`);
    ids.add(record.id);
  }
  if (value.confirmedEmpty !== (records.length === 0)) throw new Error("Catalog snapshot empty marker does not match its records.");
  const snapshot = { schemaVersion: value.schemaVersion, serverConfirmedAt: value.serverConfirmedAt, records, confirmedEmpty: value.confirmedEmpty };
  assertSnapshotSize(snapshot);
  return snapshot;
}
