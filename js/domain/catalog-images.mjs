// Image bytes live in the repository; Firestore stores only the reference.
// Missing imageUrl remains supported for older records without a photo.
export function isValidCatalogImageUrl(value) {
  if (value === undefined || value === "") return true;
  if (typeof value !== "string" || value.length > 240) return false;
  const match = value.match(/^\/haze-gray-reference\/assets\/cigars\/[A-Za-z0-9][A-Za-z0-9_-]*\.webp$/);
  return match !== null && match[0] === value;
}

export const CATALOG_IMAGE_ERROR = "Use a WebP image already in /haze-gray-reference/assets/cigars/ (letters, numbers, hyphens or underscores), or leave the path empty.";

export function validateCatalogImage(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) || !isValidCatalogImageUrl(record.imageUrl)) {
    throw new Error(CATALOG_IMAGE_ERROR);
  }
}
