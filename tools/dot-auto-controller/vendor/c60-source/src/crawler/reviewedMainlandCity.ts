import { astraZenecaCity } from "./astraZenecaLocations";
import { PFIZER_OFFICIAL_LOCALITIES } from "./pfizerOfficialLocalities";

/** Reuse reviewed city/province identities; callers must establish the country. */
export function reviewedMainlandCity(city: string, province: string): string | undefined {
  const region = province.replace(/ Province$/iu, "");
  return astraZenecaCity(city, region) ?? Object.entries(PFIZER_OFFICIAL_LOCALITIES)
    .find(([location]) => location.toLowerCase() === `China - ${region} - ${city}`.toLowerCase())?.[1];
}

/** Exact unambiguous city labels only; the caller must have observed China. */
export function reviewedMainlandCityLabel(city: string, country: string): string | undefined {
  if (country !== "China") return undefined;
  const key = city.trim().toLowerCase();
  const cities = new Set(Object.entries(PFIZER_OFFICIAL_LOCALITIES).flatMap(([location, chinese]) => {
    const [nation, , label] = location.split(" - ");
    // STIT is a reviewed office label, not a city name.
    return nation === "China" && label !== "STIT" && label?.toLowerCase() === key ? [chinese] : [];
  }));
  return cities.size === 1 ? [...cities][0] : undefined;
}
