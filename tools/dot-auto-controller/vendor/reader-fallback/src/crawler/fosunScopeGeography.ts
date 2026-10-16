/** Source-local independent Fosun geography replay. Province/prefecture names
 * reuse the repository CNSTAFF vocabulary; this does not call the fetch classifier.
 * Unknown locality labels and unreviewed administrative tails remain unproven. */
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

type Place = { province?: string; city?: string };
const COUNTRIES = new Set(["中国", "中国大陆", "中华人民共和国", "中国境内", "china", "mainland china", "china mainland", "prc", "cn"]);
function country(value:string):boolean { return COUNTRIES.has(value.normalize("NFKC").trim().toLowerCase()); }
function provinceCore(value:string):string { return value.trim().replace(/(?:维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/u, ""); }
function segment(value:string):Place|undefined {
  const clean=value.normalize("NFKC").trim();
  if (country(clean) || clean === "全国" || clean === "全国各地") return {};
  const hierarchy=clean.split(/[·・]/u).map(part=>part.trim());
  if(hierarchy.length>2 || hierarchy.some(part=>!part))return undefined;
  if(hierarchy.length===2){
    if(country(hierarchy[0]!))return segment(hierarchy[1]!);
    const province=PROVINCES.get(provinceCore(hierarchy[0]!));
    const city=hierarchy[1]!.replace(/市$/u, "");
    return province && CITY_PROVINCES.get(city)===province ? {province,city} : undefined;
  }
  const city=clean.replace(/市$/u, "");
  if(CITY_PROVINCES.has(city))return {province:CITY_PROVINCES.get(city)!,city};
  const province=PROVINCES.get(provinceCore(clean));
  return province ? {province} : undefined;
}
function places(value:string):Place[]|undefined {
  const parts=value.split(/[,，;；/／|｜、()（）\r\n]+/u).map(x=>x.trim()).filter(Boolean);
  if(!parts.length)return undefined;
  const parsed=parts.map(segment);
  return parsed.every(x=>x!==undefined) ? parsed as Place[] : undefined;
}
function absent(value:unknown):boolean { return value===undefined || value===null || value===""; }

export function hasExactFosunMainlandGeography(raw:Record<string,unknown>):boolean {
  if(!Array.isArray(raw.LocNames) || raw.LocNames.length===0 ||
      !raw.LocNames.every(value=>typeof value==="string" && value.trim()))return false;
  const primary=raw.LocNames.map(value=>places(value as string));
  if(primary.some(value=>value===undefined))return false;
  const coordinates=(primary as Place[][]).flat();
  if(![raw.Country,raw.CountryName].every(value=>absent(value) || typeof value==="string" && country(value)))return false;
  for(const value of [raw.LocName,raw.LocationName,raw.City]){
    if(absent(value))continue;
    if(typeof value!=="string")return false;
    const alternate=places(value);if(!alternate)return false;
    if(!alternate.every(shadow=>coordinates.some(original=>
        (shadow.province===undefined || original.province===undefined || shadow.province===original.province) &&
        (shadow.city===undefined || original.city===undefined || shadow.city===original.city))))return false;
  }
  return true;
}
