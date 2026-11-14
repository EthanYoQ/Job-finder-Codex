import { reviewedMainlandCity, reviewedMainlandCityLabel } from "./reviewedMainlandCity";
import { CITY_PENDING } from "../domain/jobLocation";
import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";

/** Standardized country establishes scope; city mappings only supply display labels. */
export const BMS_GEOGRAPHY_POLICY = "BMS_LOCATIONS_STANDARDIZED_MAINLAND_V1" as const;

const DISPLAY_CITIES = new Map<string, string>([
  ["Xi'an - CN", "西安"], ["Chongqing - CN", "重庆"], ["Huhehaote - CN", "呼和浩特"],
  ["Beijing - CN", "北京"], ["Zhengzhou - CN", "郑州"], ["Shijiazhuang - CN", "石家庄"],
  ["Tianjin - CN", "天津"], ["Nanjing - CN", "南京"], ["Qingdao - CN", "青岛"],
  ["Zibo - CN", "淄博"], ["Hangzhou - CN", "杭州"], ["Shanghai - CN", "上海"]
]);

export function bmsMainlandCities(raw: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(raw.locations) || raw.locations.length === 0 ||
    !Array.isArray(raw.standardizedLocations) || raw.standardizedLocations.length !== raw.locations.length) return undefined;
  const cities: string[] = [];
  for (let index = 0; index < raw.locations.length; index += 1) {
    const location = raw.locations[index], standardized = raw.standardizedLocations[index];
    if (typeof location !== "string" || typeof standardized !== "string" ||
      explicitlyForeignOrNonMainlandLocation(location) || explicitlyForeignOrNonMainlandLocation(standardized)) return undefined;
    const parts = standardized.split(",").map(part => part.trim());
    if (parts.pop() !== "CN") return undefined;
    const display = DISPLAY_CITIES.get(location) ??
      reviewedMainlandCityLabel(location.replace(/\s*-\s*CN$/u, ""), "China");
    let city = reviewedMainlandCity(parts[0] ?? "", parts[1] ?? "") ??
      reviewedMainlandCityLabel(parts[0] ?? "", "China") ?? display ?? CITY_PENDING;
    if (display && city !== CITY_PENDING && display !== city) city = CITY_PENDING;
    cities.push(city);
  }
  return cities.includes(CITY_PENDING) ? [CITY_PENDING] : [...new Set(cities)];
}
