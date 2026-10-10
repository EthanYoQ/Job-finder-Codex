/** Persist unresolved official city evidence as this singleton in both city and cities.
 * The original official location remains in locationRaw. This marker is not a city. */
export const CITY_PENDING = "城市待核";

interface JobLocation {
  city: string;
  cities: readonly string[];
}

function structuredLocations(job: JobLocation): string[] {
  return [job.city, ...job.cities].map(location => location.trim()).filter(Boolean);
}

/** Country-only evidence establishes China scope, but cannot establish a city.
 * A nationwide label alone never means city pending. An explicit marker dominates
 * inconsistent mixed records so they remain discoverable for review. */
export function isCityPendingJob(job: JobLocation): boolean {
  const locations = structuredLocations(job);
  return locations.includes(CITY_PENDING) || (locations.length > 0 &&
    locations.every(location => location === "中国" || location.toLowerCase() === "china"));
}

export function matchesPortableSearchCity(job: JobLocation, selectedCity: string): boolean {
  if (selectedCity === CITY_PENDING) return isCityPendingJob(job);
  const locations = structuredLocations(job);
  // Defensive reader policy: a mixed marker must never authorize an exact-city match.
  if (locations.includes(CITY_PENDING)) return false;
  return locations.some(location => location === "全国" || location.replace(/市$/u, "") === selectedCity);
}
