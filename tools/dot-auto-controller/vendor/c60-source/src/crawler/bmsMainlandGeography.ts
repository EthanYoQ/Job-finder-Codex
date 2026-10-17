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
  ["Hangzhou - CN", ["Hangzhou, Zhejiang, CN", "杭州"]],
  ["Shanghai - CN", ["Shanghai, Shanghai, CN", "上海"]]
]);
// New fields may carry competing geography. Source schema additions require review;
// only the four known geographic fields below have authority over the location.
const POSITION_FIELDS = new Set([
  "atsJobId", "creationTs", "department", "displayJobId", "id", "isHot",
  "locationFlexibility", "locations", "name", "positionUrl", "postedTs", "solrScore",
  "standardizedLocations", "stars", "workLocationOption"
]);

export function bmsMainlandCities(raw: Record<string, unknown>): string[] | undefined {
  if (Object.keys(raw).some(key => !POSITION_FIELDS.has(key)) ||
    !Array.isArray(raw.locations) || raw.locations.length !== 1 || typeof raw.locations[0] !== "string" ||
    !Array.isArray(raw.standardizedLocations) || raw.standardizedLocations.length !== 1 ||
    typeof raw.standardizedLocations[0] !== "string" || raw.workLocationOption !== "onsite" ||
    raw.locationFlexibility !== null) return undefined;
  const reviewed = GEOGRAPHY.get(raw.locations[0]);
  return reviewed && raw.standardizedLocations[0] === reviewed[0] ? [reviewed[1]] : undefined;
}
