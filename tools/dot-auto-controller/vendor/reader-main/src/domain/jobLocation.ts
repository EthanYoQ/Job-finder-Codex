import { reviewedMainlandCityProvince } from "../crawler/hengruiMainlandGeography";

/** Unresolved official city evidence. The original location remains visible. */
export const CITY_PENDING = "城市待核";
export const ALL_PROVINCES = "全部地区";
export const ALL_CITIES = "全部城市";
export const NATIONWIDE = "全国";

interface JobLocation {
  city: string;
  cities: readonly string[];
  locationRaw?: string;
}

function structuredLocations(job: JobLocation): string[] {
  return [job.city, ...job.cities].map(location => location.trim()).filter(Boolean);
}

const PROVINCES = new Set("河北 山西 辽宁 吉林 黑龙江 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 海南 四川 贵州 云南 陕西 甘肃 青海 台湾 内蒙古 广西 西藏 宁夏 新疆".split(" "));
const MUNICIPALITIES = new Set(["北京", "上海", "天津", "重庆"]);
// Exact city and province pairs already present in accepted official location fields.
// A province alone, an arbitrary substring or an unrecognized compound is not a city.
const ENGLISH_CITIES: ReadonlyArray<readonly [string, string, string]> = [
  ["Anyang", "安阳", "Henan Province"], ["Beijing", "北京", "Beijing"],
  ["Changchun", "长春", "Jilin Province"], ["Changsha", "长沙", "Hunan Province"],
  ["Changshu", "常熟", "Jiangsu Province"], ["Chengdu", "成都", "Sichuan Province"],
  ["Chongqing", "重庆", "Chongqing Province"], ["Eerduosi", "鄂尔多斯", "Neimenggu Province"],
  ["Foshan", "佛山", "Guangdong Province"], ["Fuzhou", "福州", "Fujian Province"],
  ["Guangzhou", "广州", "Guangdong Province"], ["Guiyang", "贵阳", "Guizhou Province"],
  ["Hangzhou", "杭州", "Zhejiang Province"], ["Harbin", "哈尔滨", "Heilongjiang Province"],
  ["Hefei", "合肥", "Anhui Province"], ["Hengyang", "衡阳", "Hunan Province"],
  ["Honghe", "红河", "Yunnan Province"], ["Huaian", "淮安", "Jiangsu Province"],
  ["Jiaxing", "嘉兴", "Zhejiang Province"], ["Jinan", "济南", "Shandong Province"],
  ["Kunming", "昆明", "Yunnan Province"], ["Liaocheng", "聊城", "Shandong Province"],
  ["Linyi", "临沂", "Shandong Province"], ["Maoming", "茂名", "Guangdong Province"],
  ["Nanchang", "南昌", "Jiangxi Province"], ["Nanjing", "南京", "Jiangsu Province"],
  ["Nanning", "南宁", "Guangxi Province"], ["Ningbo", "宁波", "Zhejiang Province"],
  ["Shanghai", "上海", "Shanghai"], ["Shenyang", "沈阳", "Liaoning Province"],
  ["Shenzhen", "深圳", "Guangdong Province"], ["Shijiazhuang", "石家庄", "Hebei Province"],
  ["Suzhou", "苏州", "Jiangsu Province"], ["Taiyuan", "太原", "Shanxi Province"],
  ["Tianjin", "天津", "Tianjin"], ["Urumqi", "乌鲁木齐", "Xinjiang Province"],
  ["Weifang", "潍坊", "Shandong Province"], ["Wuhan", "武汉", "Hubei Province"],
  ["Wuhu", "芜湖", "Anhui Province"], ["Xi an", "西安", "Shaanxi Province"],
  ["Xiamen", "厦门", "Fujian Province"], ["Xuzhou", "徐州", "Jiangsu Province"],
  ["Yangzhou", "扬州", "Jiangsu Province"], ["Yichang", "宜昌", "Hubei Province"],
  ["Yiyang", "益阳", "Hunan Province"], ["Zaozhuang", "枣庄", "Shandong Province"],
  ["Zhengzhou", "郑州", "Henan Province"], ["Zhuhai", "珠海", "Guangdong Province"]
];
const key = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
const ENGLISH_ALIASES = new Map(ENGLISH_CITIES.flatMap(([english, city, province]) => [
  [key(english), city], [key(`${english} (${province})`), city],
  ...(MUNICIPALITIES.has(city) ? [[key(`${english} Municipality`), city] as [string,string]] : [])
]));
ENGLISH_ALIASES.set(key("Changping County (Beijing)"), "北京");
ENGLISH_ALIASES.set(key("Changsha Shi"), "长沙");
ENGLISH_ALIASES.set(key("Hengyang Shi"), "衡阳");
ENGLISH_ALIASES.set(key("深圳-罗湖区"), "深圳");
ENGLISH_ALIASES.set(key("郑州-经开区"), "郑州");

function isProvince(label: string): boolean {
  return PROVINCES.has(label.replace(/(?:省|壮族自治区|回族自治区|维吾尔自治区|自治区)$/u, ""));
}

function cityLabel(location: string): string | null {
  const label = location.normalize("NFKC").trim();
  const english = ENGLISH_ALIASES.get(key(label));
  if (english) return english;
  // Only parse explicit administrative components; never search prose for a city.
  const parts = label.split(/[-·]/u);
  const qualified = parts.length > 1 && isProvince(parts[0]!);
  const place = qualified ? parts[1]! : parts[0]!;
  if (parts.length > 1 && !qualified && !MUNICIPALITIES.has(place) && !/市$/u.test(place)) return null;
  if (!/^[\p{Script=Han}]{2,18}$/u.test(place) || [CITY_PENDING, ALL_CITIES, NATIONWIDE, "中国", "中国大陆", "中华人民共和国"].includes(place)) return null;
  if (/省$|自治区$|县$/u.test(place) || (/区$/u.test(place) && !/地区$/u.test(place))) return null;
  if (!qualified && !/市$/u.test(place) && isProvince(place)) return null;
  return place.replace(/市$/u, "");
}

export function normalizePublicSearchCityLabel(location: string): string {
  return cityLabel(location) ?? location.normalize("NFKC").trim();
}

/** All explicit cities/regions, once per job. District-only fields can reuse an
 * explicit parent city in the same official structured location, never geocoding. */
export function publicSearchCities(job: JobLocation): string[] {
  const locations = structuredLocations(job);
  if (locations.includes(CITY_PENDING)) return [];
  const cities = locations.flatMap(location => {
    const direct = cityLabel(location);
    if (direct) return [direct];
    const parts = job.locationRaw?.split("·").map(part => part.trim()) ?? [];
    if (!parts.includes(location) || !/区$|县$/u.test(location)) return [];
    return parts.filter(part => /市$/u.test(part)).flatMap(part => cityLabel(part) ?? []);
  });
  return [...new Set(cities)];
}


const ENGLISH_PROVINCES: Readonly<Record<string,string>> = {
  anhui:"安徽", beijing:"北京", fujian:"福建", gansu:"甘肃", guangdong:"广东", guangxi:"广西",
  guizhou:"贵州", hainan:"海南", hebei:"河北", heilongjiang:"黑龙江", henan:"河南", hubei:"湖北", hunan:"湖南",
  jiangsu:"江苏", jiangxi:"江西", jilin:"吉林", liaoning:"辽宁", neimenggu:"内蒙古", innermongolia:"内蒙古",
  ningxia:"宁夏", qinghai:"青海", shaanxi:"陕西", shandong:"山东", shanghai:"上海", shanxi:"山西",
  sichuan:"四川", tianjin:"天津", tibet:"西藏", xinjiang:"新疆", yunnan:"云南", zhejiang:"浙江", chongqing:"重庆"
};
function provinceLabel(value:string):string|null {
  const label=value.normalize("NFKC").trim().replace(/(?:省|壮族自治区|回族自治区|维吾尔自治区|自治区|市)$/u, "");
  if(PROVINCES.has(label)||MUNICIPALITIES.has(label))return label;
  return ENGLISH_PROVINCES[key(value).replace(/(?:province|municipality|zhuangautonomousregion|autonomousregion)$/u, "")]??null;
}
export function publicSearchCityProvince(job:JobLocation,city:string):string|null {
  const known=reviewedMainlandCityProvince(city);
  if(known)return known;
  const english=ENGLISH_CITIES.find(([,chinese])=>chinese===city);
  if(english)return provinceLabel(english[2]);
  for(const location of structuredLocations(job))if(cityLabel(location)===city){
    const province=provinceLabel(location.split(/[-·]/u)[0]!);
    if(province)return province;
  }
  const rawParts=job.locationRaw?.split(/[·/]/u).map(part=>part.trim())??[];
  if(rawParts.some(part=>cityLabel(part)===city)){
    const provinces=[...new Set(rawParts.flatMap(part=>provinceLabel(part)??[]))];
    if(provinces.length===1)return provinces[0]!;
  }
  return null;
}
export function publicSearchProvinces(job:JobLocation):string[] {
  const locations=structuredLocations(job);
  if(locations.includes(CITY_PENDING))return [];
  return [...new Set([
    ...publicSearchCities(job).flatMap(city=>publicSearchCityProvince(job,city)??[]),
    ...locations.flatMap(location=>provinceLabel(location.split(/[-·]/u)[0]!)??provinceLabel(/\(([^()]*)\)$/u.exec(location)?.[1]??"")??[])
  ])];
}
export function matchesPortableSearchProvince(job:JobLocation,province:string):boolean {
  return province===ALL_PROVINCES||publicSearchProvinces(job).includes(province);
}

export function isCityPendingJob(job: JobLocation): boolean {
  const locations = structuredLocations(job);
  return locations.includes(CITY_PENDING) || (!locations.includes(NATIONWIDE) && publicSearchCities(job).length === 0);
}

export function matchesPortableSearchCity(job: JobLocation, selectedCity: string, province = ALL_PROVINCES): boolean {
  if (!matchesPortableSearchProvince(job,province)) return false;
  if (selectedCity === ALL_CITIES) return true;
  if (selectedCity === CITY_PENDING) return isCityPendingJob(job);
  const locations = structuredLocations(job);
  if (locations.includes(CITY_PENDING)) return false;
  if (selectedCity === NATIONWIDE) return locations.includes(NATIONWIDE);
  return (province===ALL_PROVINCES&&locations.includes(NATIONWIDE)) || publicSearchCities(job).some(city=>city===selectedCity&&(province===ALL_PROVINCES||publicSearchCityProvince(job,city)===province));
}
