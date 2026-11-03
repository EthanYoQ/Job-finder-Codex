import { reviewedMainlandCity } from "./reviewedMainlandCity";
import { CITY_PENDING } from "../domain/jobLocation";
import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";

/** Exact, source-local location pairs observed in BMS's China PCSx responses.
 * A Field-China row establishes country only, never nationwide city coverage. */
export const BMS_GEOGRAPHY_POLICY = "BMS_LOCATIONS_STANDARDIZED_MAINLAND_V1" as const;

const GEOGRAPHY = new Map<string, readonly [string, string]>([
  ["Field - China", ["CN", "中国"]],
  ["Field - China - CN", ["CN", "中国"]],
  ["Xi'an - CN", ["Xi'An, Shaanxi, CN", "西安"]],
  ["Chongqing - CN", ["Chongqing, Chongqing, CN", "重庆"]],
  ["Huhehaote - CN", ["Hohhot, Inner Mongolia, CN", "呼和浩特"]],
  ["Beijing - CN", ["Beijing, Beijing, CN", "北京"]],
  ["Zhengzhou - CN", ["Zhengzhou, Henan, CN", "郑州"]],
  ["Shijiazhuang - CN", ["Shijiazhuang, Hebei, CN", "石家庄"]],
  ["Tianjin - CN", ["Tianjin, Tianjin, CN", "天津"]],
  ["Nanjing - CN", ["Nanjing, Jiangsu, CN", "南京"]],
  ["Qingdao - CN", ["Qingdao, Shandong, CN", "青岛"]],
  ["Zibo - CN", ["Zibo, Shandong, CN", "淄博"]],
  ["Hangzhou - CN", ["Hangzhou, Zhejiang, CN", "杭州"]],
  ["Shanghai - CN", ["Shanghai, Shanghai, CN", "上海"]]
]);
export function bmsMainlandCities(raw: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(raw.locations) || raw.locations.length === 0 ||
    !Array.isArray(raw.standardizedLocations) || raw.standardizedLocations.length !== raw.locations.length) return undefined;
  const cities: string[] = [];
  for (let index = 0; index < raw.locations.length; index += 1) {
    const location = raw.locations[index], standardized = raw.standardizedLocations[index];
    if (typeof location !== "string" || typeof standardized !== "string" ||
      explicitlyForeignOrNonMainlandLocation(location) || explicitlyForeignOrNonMainlandLocation(standardized)) return undefined;
    const reviewed = GEOGRAPHY.get(location);
    let city = reviewed && standardized === reviewed[0] ? reviewed[1] : undefined;
    if (!city) {
      const parts = standardized.split(", ");
      if (parts.length !== 3 || parts[2] !== "CN" ||
        (location !== parts[0] && location !== `${parts[0]} - CN`)) return undefined;
      city = reviewedMainlandCity(parts[0]!, parts[1]!) ?? CITY_PENDING;
    }
    if (!city || (city === "中国" && raw.locations.length !== 1)) return undefined;
    cities.push(city);
  }
  return cities.includes(CITY_PENDING) ? [CITY_PENDING] : [...new Set(cities)];
}
