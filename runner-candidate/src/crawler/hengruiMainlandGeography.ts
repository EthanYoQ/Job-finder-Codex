import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";
import { CITY_PENDING } from "../domain/jobLocation";

/** Source-local positive mainland geography vocabulary. Prefecture names reuse the
 * reviewed CNSTAFF_MAINLAND_PREFECTURES vocabulary; region prefixes are mainland
 * administrative province codes. These are geography identities, never job IDs.
 * Unknown or contradictory supplied locality values fail closed.
 */
const PROVINCES = new Map<string, string>([
  ["北京", "11"],
  ["天津", "12"],
  ["河北", "13"],
  ["山西", "14"],
  ["内蒙古", "15"],
  ["辽宁", "21"],
  ["吉林", "22"],
  ["黑龙江", "23"],
  ["上海", "31"],
  ["江苏", "32"],
  ["浙江", "33"],
  ["安徽", "34"],
  ["福建", "35"],
  ["江西", "36"],
  ["山东", "37"],
  ["河南", "41"],
  ["湖北", "42"],
  ["湖南", "43"],
  ["广东", "44"],
  ["广西", "45"],
  ["海南", "46"],
  ["重庆", "50"],
  ["四川", "51"],
  ["贵州", "52"],
  ["云南", "53"],
  ["西藏", "54"],
  ["陕西", "61"],
  ["甘肃", "62"],
  ["青海", "63"],
  ["宁夏", "64"],
  ["新疆", "65"],
]);
const PREFECTURES: ReadonlyArray<readonly [string, string]> = [
  ["13", "石家庄 唐山 秦皇岛 邯郸 邢台 保定 张家口 承德 沧州 廊坊 衡水"],
  ["14", "太原 大同 阳泉 长治 晋城 朔州 晋中 运城 忻州 临汾 吕梁"],
  ["15", "呼和浩特 包头 乌海 赤峰 通辽 鄂尔多斯 呼伦贝尔 巴彦淖尔 乌兰察布 兴安盟 锡林郭勒盟 阿拉善盟"],
  ["21", "沈阳 大连 鞍山 抚顺 本溪 丹东 锦州 营口 阜新 辽阳 盘锦 铁岭 朝阳 葫芦岛"],
  ["22", "长春 吉林 四平 辽源 通化 白山 松原 白城 延边 延边朝鲜族自治州"],
  ["23", "哈尔滨 齐齐哈尔 鸡西 鹤岗 双鸭山 大庆 伊春 佳木斯 七台河 牡丹江 黑河 绥化 大兴安岭"],
  ["32", "南京 无锡 徐州 常州 苏州 南通 连云港 淮安 盐城 扬州 镇江 泰州 宿迁"],
  ["33", "杭州 宁波 温州 嘉兴 湖州 绍兴 金华 衢州 舟山 台州 丽水"],
  ["34", "合肥 芜湖 蚌埠 淮南 马鞍山 淮北 铜陵 安庆 黄山 滁州 阜阳 宿州 六安 亳州 池州 宣城"],
  ["35", "福州 厦门 莆田 三明 泉州 漳州 南平 龙岩 宁德"],
  ["36", "南昌 景德镇 萍乡 九江 新余 鹰潭 赣州 吉安 宜春 抚州 上饶"],
  ["37", "济南 青岛 淄博 枣庄 东营 烟台 潍坊 济宁 泰安 威海 日照 临沂 德州 聊城 滨州 菏泽"],
  ["41", "郑州 开封 洛阳 平顶山 安阳 鹤壁 新乡 焦作 濮阳 许昌 漯河 三门峡 南阳 商丘 信阳 周口 驻马店 济源"],
  ["42", "武汉 黄石 十堰 宜昌 襄阳 鄂州 荆门 孝感 荆州 黄冈 咸宁 随州 恩施 神农架 潜江 仙桃 天门"],
  ["43", "长沙 株洲 湘潭 衡阳 邵阳 岳阳 常德 张家界 益阳 郴州 永州 怀化 娄底 湘西"],
  ["44", "广州 韶关 深圳 珠海 汕头 佛山 江门 湛江 茂名 肇庆 惠州 梅州 汕尾 河源 阳江 清远 东莞 中山 潮州 揭阳 云浮"],
  ["45", "南宁 柳州 桂林 梧州 北海 防城港 钦州 贵港 玉林 百色 贺州 河池 来宾 崇左"],
  ["46", "海口 三亚 三沙 儋州"],
  ["51", "成都 自贡 攀枝花 泸州 德阳 绵阳 广元 遂宁 内江 乐山 南充 眉山 宜宾 广安 达州 雅安 巴中 资阳 阿坝 甘孜 凉山"],
  ["52", "贵阳 六盘水 遵义 安顺 毕节 铜仁 黔西南 黔东南 黔南"],
  ["53", "昆明 曲靖 玉溪 保山 昭通 丽江 普洱 临沧 楚雄 红河 文山 西双版纳 大理 德宏 怒江 迪庆"],
  ["54", "拉萨 日喀则 昌都 林芝 山南 那曲 阿里"],
  ["61", "西安 铜川 宝鸡 咸阳 渭南 延安 汉中 榆林 安康 商洛"],
  ["62", "兰州 嘉峪关 金昌 白银 天水 武威 张掖 平凉 酒泉 庆阳 定西 陇南 临夏 甘南"],
  ["63", "西宁 海东 海北 黄南 海南州 果洛 玉树 海西"],
  ["64", "银川 石嘴山 吴忠 固原 中卫"],
  ["65", "乌鲁木齐 克拉玛依 吐鲁番 哈密 昌吉 博尔塔拉 巴音郭楞 阿克苏 克孜勒苏 喀什 和田 伊犁 塔城 阿勒泰 石河子 阿拉尔 图木舒克 五家渠 北屯 铁门关 双河 可克达拉 昆玉 胡杨河 新星"],
];
const CITY_PROVINCES = new Map<string, string>([
  ...[...PROVINCES].filter(([, code]) => ["11", "12", "31", "50"].includes(code)),
  ...PREFECTURES.flatMap(([code, names]) => names.split(" ").map(name => [name, code] as [string, string]))
]);
// Explicit county-level and autonomous-prefecture tuples. Their official region
// IDs are required rather than inferred from a broad country/province label.
const ADDITIONAL_LOCALITIES = new Map<string, number>([
  ["天长", 341181], ["界首", 341282],
  ["景洪", 532801], ["兴义", 522301], ["慈溪", 330282], ["余姚", 330281],
  ["普宁", 445281], ["开远", 532502], ["莱西", 370285], ["平度", 370283],
  ["邛崃", 510183], ["西昌", 513401], ["乐昌", 440281], ["福清", 350181],
  ["阿克苏地区", 652900], ["伊犁哈萨克自治州", 654000], ["博尔塔拉蒙古自治州", 652700],
  ["开州区", 500154], ["浦东新区", 310115],
  ["阆中", 511381], ["雷州", 440882], ["乐清", 330382], ["泰兴", 321283], ["长葛", 411082], ["枣阳", 420683]
]);
const COUNTRIES = new Set(["中国", "中国大陆", "中华人民共和国", "China", "CN"]);

/** An official country field admits a locality even when its display name is unmapped. */
export function hasMainlandCountryLocation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const location = value as Record<string, unknown>;
  if (typeof location.country !== "string" || !COUNTRIES.has(location.country)) return false;
  for (const field of ["cityName", "provinceName", "countryDescription"]) {
    if (location[field] !== undefined && (typeof location[field] !== "string" || !location[field].trim() ||
      explicitlyForeignOrNonMainlandLocation(location[field]))) return false;
  }
  for (const field of ["cityId", "provinceId"]) {
    if (location[field] !== undefined && (!Number.isSafeInteger(location[field]) ||
      ![...PROVINCES.values()].includes(String(location[field]).slice(0, 2)))) return false;
  }
  return true;
}

export function mokaDisplayCities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cities = value.flatMap(location => {
    if (!location || typeof location !== "object") return [];
    if (typeof location.country === "string" && explicitlyForeignOrNonMainlandLocation(location.country)) return [];
    const label=location.cityName ?? location.provinceName;
    if (label == null) return typeof location.country === "string" && location.country.trim() ? [CITY_PENDING] : [];
    if (hasMainlandCountryLocation(location) && !isHengruiMainlandLocation(location)) return [CITY_PENDING];
    return typeof label === "string" && label.trim() ? [label.replace(/\s+/gu," ").trim()] : [];
  });
  return cities.includes(CITY_PENDING) ? [CITY_PENDING] : cities;
}

export function isHengruiMainlandLocation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const location = value as Record<string, unknown>;
  if (typeof location.country !== "string" || !COUNTRIES.has(location.country)) return false;
  const city = location.cityName, province = location.provinceName;
  // Explicit China-wide evidence is retained only in the absence of locality claims.
  if (city === undefined && province === undefined) return location.cityId === undefined && location.provinceId === undefined;
  if (city !== undefined && (typeof city !== "string" || !city.trim()) ||
      province !== undefined && (typeof province !== "string" || !province.trim())) return false;
  const provinceCode = typeof province === "string" ? PROVINCES.get(provinceCore(province)) : undefined;
  if (province !== undefined && !provinceCode) return false;
  const cityCore = typeof city === "string" ? city.trim().replace(/市$/u, "") : undefined;
  const explicitCityId = cityCore === undefined ? undefined : ADDITIONAL_LOCALITIES.get(cityCore);
  let cityProvince = explicitCityId === undefined
    ? cityCore === undefined ? undefined : CITY_PROVINCES.get(cityCore)
    : String(explicitCityId).slice(0, 2);
  // County names need not be pre-enumerated when the official mainland province and region ID agree.
  if (!cityProvince && cityCore && provinceCode && /^[\p{Script=Han}]{2,20}$/u.test(cityCore) &&
      !explicitlyForeignOrNonMainlandLocation(cityCore) && typeof location.cityId === "number" &&
      /^\d{6}$/u.test(String(location.cityId)) && String(location.cityId).startsWith(provinceCode)) cityProvince = provinceCode;
  if (cityCore !== undefined && !cityProvince || cityProvince && provinceCode && cityProvince !== provinceCode) return false;
  if (explicitCityId !== undefined && location.cityId !== explicitCityId) return false;
  const expectedProvince = cityProvince ?? provinceCode;
  if (!expectedProvince) return false;
  if (location.provinceId !== undefined && location.provinceId !== Number(`${expectedProvince}0000`)) return false;
  if (location.cityId !== undefined && (typeof location.cityId !== "number" || !Number.isSafeInteger(location.cityId) ||
      !/^\d{6}$/u.test(String(location.cityId)) || String(location.cityId).slice(0, 2) !== expectedProvince)) return false;
  return true;
}
function provinceCore(value: string): string {
  return value.trim().replace(/(?:维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/u, "");
}
