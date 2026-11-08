import { reviewedMainlandCityProvince } from "../crawler/hengruiMainlandGeography";
import { PFIZER_OFFICIAL_LOCALITIES } from "../crawler/pfizerOfficialLocalities";

/** Unresolved official city evidence. The original location remains visible. */
export const CITY_PENDING = "城市待核";
export const ALL_PROVINCES = "全部地区";
export const ALL_CITIES = "全部城市";
export const NATIONWIDE = "全国";
export const MULTI_CITY = "多城市";
export const PROVINCE_PENDING = "省份待核";

interface JobLocation {
  city: string;
  cities: readonly string[];
  locationRaw?: string;
}

interface PublishedJobLocation extends JobLocation {
  sourceId: string;
  officialTitle: string;
  officialUrl: string;
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
  ["Deyang", "德阳", "Sichuan Province"], ["Foshan", "佛山", "Guangdong Province"], ["Fuzhou", "福州", "Fujian Province"],
  ["Guangzhou", "广州", "Guangdong Province"], ["Guiyang", "贵阳", "Guizhou Province"],
  ["Hangzhou", "杭州", "Zhejiang Province"], ["Harbin", "哈尔滨", "Heilongjiang Province"],
  ["Hefei", "合肥", "Anhui Province"], ["Hengyang", "衡阳", "Hunan Province"],
  ["Honghe", "红河", "Yunnan Province"], ["Huaian", "淮安", "Jiangsu Province"],
  ["Jiaxing", "嘉兴", "Zhejiang Province"], ["Jinan", "济南", "Shandong Province"],
  ["Kunming", "昆明", "Yunnan Province"], ["Liaocheng", "聊城", "Shandong Province"],
  ["Linyi", "临沂", "Shandong Province"], ["Maoming", "茂名", "Guangdong Province"],
  ["Nanchang", "南昌", "Jiangxi Province"], ["Nanjing", "南京", "Jiangsu Province"],
  ["Nanning", "南宁", "Guangxi Province"], ["Puyang", "濮阳", "Henan Province"], ["Qingdao", "青岛", "Shandong Province"], ["Ningbo", "宁波", "Zhejiang Province"],
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

const PUBLISHED_CITY_ALIASES = new Map(Object.entries({
  haerbin: "哈尔滨", changpingcounty: "北京", yinchuan: "银川", xinxiang: "新乡",
  xining: "西宁", zhoukou: "周口", datong: "大同", sanya: "三亚", jining: "济宁",
  binzhou: "滨州", taian: "泰安", luzhou: "泸州", haiyan: "海盐", chaozhou: "潮州",
  qingyuan: "清远", jieyang: "揭阳", linfen: "临汾", "guang'an": "广安", xinzhou: "忻州",
  longnan: "陇南", leshan: "乐山", baoshan: "保山", jiangmen: "江门", quzhou: "衢州",
  nantong: "南通", baoding: "保定", nanyang: "南阳", kashi: "喀什", lanzhou: "兰州",
  xiaogan: "孝感", yuncheng: "运城", wuwei: "武威", anqing: "安庆", yichun: "宜春",
  chuzhou: "滁州", "ma'anshan": "马鞍山", "beijinginnovationhub": "北京",
  shanghaiqiantanplaza: "上海", liangshanyiautonomousprefecture: "凉山",
  anshun: "安顺", baise: "百色", beihai: "北海", dezhou: "德州", guilin: "桂林",
  handan: "邯郸", heze: "菏泽", huaibei: "淮北", jiamusi: "佳木斯", jilin: "吉林",
  jingmen: "荆门", meizhou: "梅州", mudanjiang: "牡丹江", putian: "莆田",
  qinzhou: "钦州", rizhao: "日照", shizuishan: "石嘴山", weinan: "渭南",
  wuzhong: "吴忠", xichang: "西昌", xinyang: "信阳", yanbian: "延边",
  yangjiang: "阳江", yining: "伊宁", zhanjiang: "湛江", zhaoqing: "肇庆",
  zhaotong: "昭通", zibo: "淄博", jincheng: "晋城", lvliang: "吕梁", dazhou: "达州",
  yibin: "宜宾", zigong: "自贡", dali: "大理", chifeng: "赤峰",
  baoji: "宝鸡", chengde: "承德", liuzhou: "柳州", urumuqi: "乌鲁木齐", wulumuqi: "乌鲁木齐",
  tianjing: "天津", xian: "西安", "xi'an": "西安", wenzhou: "温州", bengbu: "蚌埠",
  dongguan: "东莞", nanchong: "南充", neijiang: "内江", guangan: "广安"
}));
for (const [label, city] of Object.entries(PFIZER_OFFICIAL_LOCALITIES)) {
  const name = /^China - [^-]+ - (.+)$/u.exec(label)?.[1];
  if (name && name !== "STIT" && !PUBLISHED_CITY_ALIASES.has(key(name))) {
    PUBLISHED_CITY_ALIASES.set(key(name), city);
  }
}

function isProvince(label: string): boolean {
  return PROVINCES.has(label.replace(/(?:省|壮族自治区|回族自治区|维吾尔自治区|自治区)$/u, ""));
}

function cityLabel(location: string): string | null {
  const label = location.normalize("NFKC").trim();
  const english = ENGLISH_ALIASES.get(key(label));
  if (english) return english;
  const pair = /^(.*?)[,，]\s*([^,，]+)$|^(.*?)\s*\(([^()]*)\)$/u.exec(label);
  if (pair) {
    const city = ENGLISH_ALIASES.get(key(pair[1] ?? pair[3] ?? ""));
    const province = provinceLabel(pair[2] ?? pair[4] ?? "");
    if (city && province && publishedCityProvince(city) === province) return city;
  }
  // Only parse explicit administrative components; never search prose for a city.
  const parts = label.split(/[-·]/u);
  const qualified = parts.length > 1 && isProvince(parts[0]!);
  const place = qualified ? parts[1]! : parts[0]!;
  if (parts.length > 1 && !qualified && !MUNICIPALITIES.has(place) && !/市$/u.test(place)) return null;
  if (!/^[\p{Script=Han}]{2,18}$/u.test(place) || [CITY_PENDING, ALL_CITIES, NATIONWIDE, "其他", "其它", "中国", "中国大陆", "中华人民共和国"].includes(place)) return null;
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
    if (location === "吉林" && explicitPublishedCity(job.locationRaw ?? "") === "吉林") return [location];
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
  const english = key(value).replace(/(?:province|municipality|zhuangautonomousregion|autonomousregion)$/u, "");
  return Object.hasOwn(ENGLISH_PROVINCES, english) ? ENGLISH_PROVINCES[english]! : null;
}
const SOURCES_WITH_UNPUBLISHED_LOCATION_CHECKS = new Set([
  "source-amgen-china-social", "source-astrazeneca-social", "source-merck-china-social",
  "source-organon-china-social"
]);
const VERIFIED_DETAIL_LOCATIONS: Readonly<Record<string, readonly string[]>> = {
  "source-takeda-china-social|https://jobs.takeda.com/job/shanghai/china-biomarker-lead/1113/101034777968": ["上海", "北京"],
  "source-merck-china-social|https://careers.emdgroup.com/us/en/job/299857": ["上海", "北京"],
  "source-merck-china-social|https://careers.emdgroup.com/us/en/job/305134": ["无锡"]
};
const CHINA = /^(?:中国大陆|中国|中华人民共和国|China|CN|CHN)$/iu;

const PREFECTURE_LABELS = new Map([
  ["恩施土家族苗族自治州", "恩施"], ["黔西南布依族苗族自治州", "黔西南"],
  ["湘西土家族苗族自治州", "湘西"], ["大理白族自治州", "大理"],
  ["红河哈尼族彝族自治州", "红河"]
]);

const COUNTY_CITY_PROVINCES: Readonly<Record<string, string>> = {
  海盐: "浙江", 伊宁: "新疆", 启东: "江苏", 宜兴: "江苏", 阆中: "四川",
  天长: "安徽", 界首: "安徽", 台山: "广东", 延吉: "吉林"
};

function publishedCityProvince(city: string): string | null {
  return reviewedMainlandCityProvince(city) ?? COUNTY_CITY_PROVINCES[city] ?? null;
}

const AMBIGUOUS_CITY_PROVINCES = new Map<string, Readonly<Record<string, string>>>([
  ["jilin", { 吉林: "吉林" }],
  ["fuyang", { 安徽: "阜阳" }],
  ["longnan", { 甘肃: "陇南" }],
  ["yulin", { 广西: "玉林", 陕西: "榆林" }],
  ["suzhou", { 江苏: "苏州", 安徽: "宿州" }],
  ["taizhou", { 浙江: "台州", 江苏: "泰州" }],
  ["fuzhou", { 福建: "福州", 江西: "抚州" }]
]);

function knownPublishedCity(part: string, province?: string | null): string | undefined {
  const alias = key(part);
  const byProvince = AMBIGUOUS_CITY_PROVINCES.get(alias);
  if (byProvince) return province ? byProvince[province] : undefined;
  const city = PREFECTURE_LABELS.get(part) ?? PUBLISHED_CITY_ALIASES.get(alias) ?? cityLabel(part);
  if (city && publishedCityProvince(city)) return city;
  const municipality = publishedCityProvince(part);
  return municipality && MUNICIPALITIES.has(municipality) ? municipality : undefined;
}

function explicitPublishedProvince(raw: string): string | null {
  const workdayProvince = /^CHN - [A-Z]{2} - (.+)$/u.exec(raw.trim())?.[1];
  return provinceLabel(workdayProvince ?? raw) ?? (/^guangdong,gd$/u.test(key(raw)) ? "广东" : null);
}

function explicitPublishedCity(raw: string): string | undefined {
  const label = raw.normalize("NFKC").trim().replace(/^CN:\s*/iu, "");
  if (Object.hasOwn(PFIZER_OFFICIAL_LOCALITIES, label)) return PFIZER_OFFICIAL_LOCALITIES[label];
  const qualified = label.match(/^(.+?)\s*\(([^()]+)\)$/u);
  const parts = (qualified ? [qualified[1]!, qualified[2]!] : label.split(/\s*[,，·]\s*|\s+-\s+/u))
    .map(part => part.trim()).filter(part => part && !CHINA.test(part));
  if (!parts.length) return undefined;
  const provinceAndCity = parts.length === 1 ? /^(.+?省)(.+?市)/u.exec(parts[0]!) : null;
  if (provinceAndCity) {
    const city = knownPublishedCity(provinceAndCity[2]!);
    return city && provinceLabel(provinceAndCity[1]!) === publishedCityProvince(city) ? city : undefined;
  }
  if (parts.length === 1) return knownPublishedCity(parts[0]!);
  const trailingProvince = provinceLabel(parts[1]!);
  const city = knownPublishedCity(parts[0]!, trailingProvince);
  if (city && trailingProvince === publishedCityProvince(city) && parts.length === 2) return city;
  const province = provinceLabel(parts[0]!);
  if (!province) return undefined;
  const locality = knownPublishedCity(parts[1]!, province);
  if (locality && province === publishedCityProvince(locality) &&
      parts.slice(2).every(part => /(?:区|县)$/u.test(part) || knownPublishedCity(part, province) === locality)) return locality;
  return parts.length === 2 && MUNICIPALITIES.has(province) && /(?:区|县)$/u.test(parts[1]!) ? province : undefined;
}

function titleWorkCities(title: string, province: string | null): string[] {
  const text = title.normalize("NFKC").trim().replace(/\(J\d+\)$/iu, "").trim();
  const parentheses = text.match(/\(([^()]+)\)$/u)?.[1];
  const fields = text.split(/[-–—,，]/u).map(field => field.trim());
  const lastField = fields.at(-1);
  const provincialField = province ? fields.find(field => field.startsWith(province) && field.length > province.length) : undefined;
  const office = lastField?.match(/^(.+?) AI Center$/iu)?.[1];
  const prefix = text.match(/^([\p{Script=Han}]{2,5}?)(?:皮肤科)?(?:代表招聘|医学信息沟通专员)/u)?.[1];
  const trailingCity = text.match(/\s+([\p{Script=Han}]{2,8})$/u)?.[1];
  for (const candidate of [parentheses, office, lastField, provincialField, prefix, trailingCity]) {
    if (!candidate || candidate === text) continue;
    const labels = candidate.trim().split(/\s*[/、]\s*/u);
    const cities = labels.map(label => {
      const name = label.trim().replace(/\d+$/u, "");
      if (name === "全国") return NATIONWIDE;
      if (name === "淮南-凤台" && province === "安徽") return "淮南";
      const city = knownPublishedCity(name, province);
      if (city) return city;
      if (province && name.startsWith(province)) return knownPublishedCity(name.slice(province.length), province);
      if (name === "黄冈蕲春县" && province === "湖北") return "黄冈";
      return undefined;
    });
    if (cities.every(city => city !== undefined)) return [...new Set(cities)];
  }
  return [];
}

function rawPublishedCities(raw: string, separator: RegExp, keepKnownLocations = false): string[] {
  const parts = raw.split(separator).map(part => part.trim()).filter(part => part && !CHINA.test(part));
  const cities = parts.map(explicitPublishedCity);
  const resolved = cities.flatMap(city => city ?? []);
  const provinces = new Set(resolved.map(publishedCityProvince));
  if (!keepKnownLocations && cities.some((city, index) => !city && !provinces.has(explicitPublishedProvince(parts[index]!)))) return [];
  return [...new Set(resolved)];
}

export function resolvedPublishedJobCities(job: PublishedJobLocation): string[] {
  const raw = job.locationRaw?.trim();
  if (!raw) return [];
  const { sourceId, officialTitle } = job;
  const pending = isCityPendingJob(job);
  const province = explicitPublishedProvince(raw);
  if (sourceId === "source-astrazeneca-social" || sourceId === "source-amgen-china-social") {
    const cities = titleWorkCities(officialTitle, province);
    if (cities.length) return cities;
  }
  if (sourceId === "source-cspc-social" && raw === "中华人民共和国" || sourceId === "source-hengrui-social" && raw === "中国") {
    return [NATIONWIDE];
  }
  // These feeds delimit distinct work locations with commas or enumeration marks.
  if (sourceId === "source-cspc-social" || sourceId === "source-daiichi-sankyo-china-social" ||
      sourceId === "source-hengrui-social" && pending && raw.includes("、")) {
    const cities = rawPublishedCities(raw, /[,，、|]/u);
    if (cities.length) return cities;
  }
  if (sourceId === "source-pfizer-china-social" && raw.includes("CHN - BJ - Beijing R&D Center")) {
    const cities = rawPublishedCities(raw, /\s*\|\s*/u);
    if (cities.length) return cities;
  }
  if (!pending) return [];
  const detail = VERIFIED_DETAIL_LOCATIONS[`${sourceId}|${job.officialUrl}`];
  if (detail) return [...detail];
  if (sourceId === "source-novartis-social" && /^Baoji \(Shanxxi Province\)$/iu.test(raw)) return ["宝鸡"];

  const titleCities = titleWorkCities(officialTitle, province);
  if (sourceId === "source-takeda-china-social" && /^(?:Remote|Multiple Locations)$/iu.test(raw) ||
      sourceId === "source-merck-china-social") return titleCities;
  if (sourceId === "source-servier-china-social") {
    if (raw === "朝阳区" && titleCities.includes("北京")) return ["北京"];
    if (raw === "下城区（旧）" && titleCities.includes("杭州")) return ["杭州"];
  }
  if (province && titleCities.length && titleCities.every(city => publishedCityProvince(city) === province)) return titleCities;
  if (sourceId === "source-novo-nordisk-china-social" && /^China,\s*Longnan$/iu.test(raw) && titleCities.includes("陇南")) return ["陇南"];
  if (sourceId === "source-amgen-china-social") {
    const cities = rawPublishedCities(raw, /\s*\|\s*/u);
    if (cities.length && titleCities.length && titleCities.every(city => cities.includes(city))) return cities;
    if (raw === "China - Harbin" && !titleCities.length) return ["哈尔滨"];
    return [];
  }
  if (sourceId === "source-organon-china-social" && /^(?:Taiyuan, Shanxi|Zhengzhou, Henan), China$/iu.test(raw)) {
    return rawPublishedCities(raw, /\s*\|\s*/u);
  }
  if (SOURCES_WITH_UNPUBLISHED_LOCATION_CHECKS.has(sourceId)) return [];
  if (sourceId === "source-abbvie-china-social" && !/^(?:deyang,\s*sichuan|puyang,\s*henan)$/iu.test(raw)) return [];
  if (sourceId === "source-viatris-social" && raw === "大连-沙河口区" && titleCities.includes("大连")) return ["大连"];
  if (sourceId === "source-roche-china-social") {
    // The owner confirmed the Fujian label is Fuzhou despite the official typo.
    const reviewed = raw.split("|").map(part => part.trim().replace(/^抚州, 福建, 中国大陆$/u, "福州, 福建, 中国大陆")).join(" | ");
    return rawPublishedCities(reviewed, /\s*\|\s*/u, true);
  }
  return rawPublishedCities(raw, /\s*\|\s*/u);
}

export function publicSearchCityProvince(job:JobLocation,city:string):string|null {
  const known=publishedCityProvince(city);
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
  if (locations.includes(CITY_PENDING)) {
    const province = explicitPublishedProvince(job.locationRaw ?? "");
    return province ? [province] : [];
  }
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
  const nationwide = structuredLocations(job).includes(NATIONWIDE);
  if (selectedCity === NATIONWIDE) return nationwide;
  if (selectedCity === PROVINCE_PENDING) return province === ALL_PROVINCES && isCityPendingJob(job) && publicSearchProvinces(job).length === 0;
  if (selectedCity === ALL_CITIES && nationwide) return true;
  if (!matchesPortableSearchProvince(job,province)) return false;
  if (selectedCity === ALL_CITIES) return true;
  if (selectedCity === CITY_PENDING) return isCityPendingJob(job);
  const cities = publicSearchCities(job);
  if (selectedCity === MULTI_CITY) return cities.length > 1;
  return (province===ALL_PROVINCES&&nationwide) || cities.some(city=>city===selectedCity&&(province===ALL_PROVINCES||publicSearchCityProvince(job,city)===province));
}
