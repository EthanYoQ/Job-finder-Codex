import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";

// Country establishes admission; coordinates and city dictionaries only affect display.
export function phenomMainlandGeography(raw: Record<string, unknown>): boolean {
  if (raw.country !== "China" || typeof raw.location !== "string" || !raw.location.trim()) return false;
  const foreign = (value: unknown) => typeof value === "string" && explicitlyForeignOrNonMainlandLocation(value);
  for (const field of ["location", "city", "state", "cityState", "cityStateCountry", "address", "workLocation"]) {
    if (foreign(raw[field])) return false;
  }
  if (Array.isArray(raw.multi_location) && raw.multi_location.some(foreign)) return false;
  if (Array.isArray(raw.multi_location_array)) {
    for (const value of raw.multi_location_array) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const place = value as Record<string, unknown>;
      if (place.country !== undefined && place.country !== "China") return false;
      if (["location", "city", "state", "cityState", "cityStateCountry", "cityCountry", "stateCountry", "mapQueryLocation"].some(field => foreign(place[field]))) return false;
      // A nested country may be omitted only when its location explicitly names China.
      if (place.country === undefined && (typeof place.location !== "string" || !/(?:^|,)\s*China\s*$/iu.test(place.location))) return false;
    }
  }
  return true;
}

// Disagreement changes display confidence, never country admission.
export function phenomPrimaryLocationAgrees(raw: Record<string, unknown>): boolean {
  const cityState = [raw.city, raw.state].filter(value => typeof value === "string" && value).join(", ");
  const expected = `${cityState}, China`;
  if (!cityState || raw.location !== expected ||
    (raw.cityState !== undefined && raw.cityState !== cityState) ||
    (raw.cityStateCountry !== undefined && raw.cityStateCountry !== expected)) return false;
  if (Array.isArray(raw.multi_location) && raw.multi_location.some(value => value !== expected)) return false;
  const expectedFields={city:raw.city,state:raw.state,cityState,cityStateCountry:expected,mapQueryLocation:expected,
    cityCountry:raw.city ? `${raw.city}, China` : "China",stateCountry:`${raw.state}, China`};
  if (Array.isArray(raw.multi_location_array) && raw.multi_location_array.some(value => value.location !== expected ||
    Object.entries(expectedFields).some(([field,expectedValue]) => value[field] !== undefined && value[field] !== expectedValue))) return false;
  const city = typeof raw.city === "string" && raw.city ? raw.city : raw.state;
  if (typeof city !== "string") return false;
  const tokens = (value: string) => value.toLowerCase().split(/\s*[,–-]\s*/u);
  for (const field of ["address", "workLocation"]) {
    if (raw[field] !== undefined && (typeof raw[field] !== "string" || !tokens(raw[field]).includes(city.toLowerCase()))) return false;
  }
  return true;
}
