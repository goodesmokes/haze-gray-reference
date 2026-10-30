export const SIZE_AVAILABILITY = Object.freeze({
  AVAILABLE: "available",
  BACKORDERED: "backordered",
  OUT_OF_STOCK: "out_of_stock",
});

export const SIZE_AVAILABILITY_OPTIONS = Object.freeze([
  Object.freeze({ value: SIZE_AVAILABILITY.AVAILABLE, label: "Available" }),
  Object.freeze({ value: SIZE_AVAILABILITY.BACKORDERED, label: "Backordered" }),
  Object.freeze({ value: SIZE_AVAILABILITY.OUT_OF_STOCK, label: "Out of Stock" }),
]);

const AVAILABILITY_LABELS = Object.freeze(Object.fromEntries(
  SIZE_AVAILABILITY_OPTIONS.map(({ value, label }) => [value, label])
));

export function validateSizeAvailability(value) {
  if (!Object.prototype.hasOwnProperty.call(AVAILABILITY_LABELS, value)) {
    throw new Error("Invalid cigar-size availability status.");
  }
  return value;
}

export function getSizeAvailability(size) {
  if (!size || typeof size !== "object" || Array.isArray(size)) {
    throw new Error("Invalid cigar-size record.");
  }
  if (!Object.prototype.hasOwnProperty.call(size, "availability")) return SIZE_AVAILABILITY.AVAILABLE;
  return validateSizeAvailability(size.availability);
}

export const isSizeOrderable = (size) => getSizeAvailability(size) === SIZE_AVAILABILITY.AVAILABLE;
export const sizeAvailabilityLabel = (size) => AVAILABILITY_LABELS[getSizeAvailability(size)];
