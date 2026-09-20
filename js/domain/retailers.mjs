export const RETAILER_FIELDS = Object.freeze({ name: "Retailer Name", contactName: "Contact Name", email: "Email", phone: "Phone", address1: "Address 1", address2: "Address 2", city: "City", state: "State", postalCode: "Postal Code", country: "Country", website: "Website", notes: "Customer Notes" });
export const RETAILER_AUTOCOMPLETE = Object.freeze({ contactName: "name", email: "email", phone: "tel", address1: "address-line1", address2: "address-line2", city: "address-level2", state: "address-level1", postalCode: "postal-code", country: "country-name", website: "url" });
export const normalizeRetailerName = (name) => name.trim().toLowerCase();
export const retailerLocation = (retailer) => [retailer.city, retailer.state].map((value) => (value || "").trim().replace(/\s+/g, " ")).filter(Boolean).join(", ");
export const normalizeRetailerSearch = (value) => normalizeRetailerName(value || "").replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ");
export const retailerSearch = (retailer, search) => [retailer.name, retailer.contactName, retailer.city, retailer.state, retailerLocation(retailer), retailer.territory].some((value) => normalizeRetailerSearch(value).includes(normalizeRetailerSearch(search)));
export const validRetailerId = (id) => typeof id === "string" && id.length > 0 && id.length <= 128 && !id.includes("/");

export function formatRetailerPhone(phone = "", country = "") {
  if (!["", "united states", "usa", "us"].includes(country.trim().toLowerCase())) return phone;
  // Preserve extensions, explicit foreign country codes, and overlong numbers.
  if (!/^[\d\s()+.\-]*$/.test(phone)) return phone;
  let digits = phone.replace(/\D/g, "");
  if (phone.includes("+") && !(phone.trim().startsWith("+1") && digits.length === 11)) return phone;
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length > 10) return phone;
  if (digits.length < 3) return digits;
  const area = `(${digits.slice(0, 3)})`;
  if (digits.length === 3) return area;
  return `${area} ${digits.slice(3, 6)}${digits.length > 6 ? "-" + digits.slice(6) : ""}`;
}

export function validateRetailer(input) {
  const result = {};
  for (const key of Object.keys(RETAILER_FIELDS)) {
    if (typeof input[key] !== "string") throw new Error(`Invalid ${RETAILER_FIELDS[key]}.`);
    result[key] = input[key].trim();
    if (result[key].length > (key === "notes" ? 5000 : 500)) throw new Error(`${RETAILER_FIELDS[key]} is too long.`);
  }
  result.phone = formatRetailerPhone(result.phone, result.country);
  if (!result.name) throw new Error("Retailer Name is required.");
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error("Enter a valid email address.");
  if (typeof input.active !== "boolean") throw new Error("Invalid retailer status.");
  return { ...result, active: input.active, nameNormalized: normalizeRetailerName(result.name) };
}

export function findDuplicateRetailer(retailers, name, exceptId = null) {
  return retailers.find((retailer) => retailer.id !== exceptId && retailer.active && retailer.nameNormalized === normalizeRetailerName(name));
}
