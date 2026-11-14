import { reviewedMainlandCity } from "./reviewedMainlandCity";
import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";
import { load } from "cheerio";

// Reviewed city identities; a known mainland province can admit a city-pending row.
const MAINLAND_CITY_PROVINCE = new Map(Object.entries({
  Beijing: "Beijing", Changchun: "Jilin", Changsha: "Hunan", Chengdu: "Sichuan",
  Chongqing: "Chongqing", Deyang: "Sichuan", Puyang: "Henan", Guangzhou: "Guangdong Province", Guiyang: "Guizhou",
  Hangzhou: "Zhejiang", Harbin: "Heilongjiang", Hefei: "Anhui", Hohhot: "Inner Mongolia", Jinan: "Shandong",
  Kunming: "Yunnan", Nanjing: "Jiangsu", Nanning: "Guangxi", Shanghai: "Shanghai",
  Shenzhen: "Guangdong Province", Shijiazhuang: "Hebei", Taiyuan: "Shanxi",
  Tianjin: "Tianjin", Wenzhou: "Zhejiang", Wuhan: "Hubei", "Xi'An": "Shaanxi", Xiamen: "Fujian",
  Yancheng: "Jiangsu", Yangzhou: "Jiangsu", Zhanjiang: "Guangdong Province",
  Zhengzhou: "Henan", "Ürümqi": "Xinjiang"
}).map(([city, province]) => [city.toLowerCase(), province.toLowerCase()]));
const MAINLAND_CITY_NAMES: Readonly<Record<string,string>> = Object.freeze({
  beijing:"北京",changchun:"长春",changsha:"长沙",chengdu:"成都",chongqing:"重庆",deyang:"德阳",puyang:"濮阳",guangzhou:"广州",
  guiyang:"贵阳",hangzhou:"杭州",harbin:"哈尔滨",hefei:"合肥",hohhot:"呼和浩特",jinan:"济南",kunming:"昆明",
  nanjing:"南京",nanning:"南宁",shanghai:"上海",shenzhen:"深圳",shijiazhuang:"石家庄",taiyuan:"太原",
  tianjin:"天津",wenzhou:"温州",wuhan:"武汉","xi'an":"西安",xiamen:"厦门",yancheng:"盐城",yangzhou:"扬州",
  zhanjiang:"湛江",zhengzhou:"郑州","ürümqi":"乌鲁木齐"
});
/** Only a validated city/province pair can produce a city. The raw pair stays
 * intact on the record; province labels are never appended to cities. */
export function reviewedAbbvieCity(locationRaw:string,locationHint=""):string|undefined {
  const parts=normalized(locationRaw).split(",").map(part=>part.trim());
  if (locationHint.trim() && !isChina(locationHint) && !parts.some(part=>provinceName(part)===provinceName(locationHint))) return undefined;
  return parts.length !== 2 ? undefined : MAINLAND_CITY_PROVINCE.get(parts[0]!) === parts[1]
    ? MAINLAND_CITY_NAMES[parts[0]!] : reviewedMainlandCity(parts[0]!, parts[1]!);
}
const MAINLAND_PROVINCES = "beijing|shanghai|tianjin|chongqing|hebei|shanxi|liaoning|jilin|heilongjiang|jiangsu|zhejiang|anhui|fujian|jiangxi|shandong|henan|hubei|hunan|guangdong|hainan|sichuan|guizhou|yunnan|shaanxi|gansu|qinghai|inner mongolia|guangxi|tibet|ningxia|xinjiang".split("|");
const provinceName = (value:string) => normalized(value).replace(/ province$/u, "");
export function isReviewedAbbvieLocation(locationRaw:string,countryHint=""):boolean {
  if (!locationRaw.trim() || explicitlyForeignOrNonMainlandLocation(locationRaw)) return false;
  if (isChina(countryHint) || reviewedAbbvieCity(locationRaw) || /^guangdong\s*,\s*gd$/u.test(normalized(locationRaw))) return true;
  const parts=normalized(locationRaw).split(",").map(part=>part.trim());
  return parts.length===2 && !!parts[0] && MAINLAND_PROVINCES.includes(provinceName(parts[1]!));
}
const normalized = (value: string) => value.replace(/\s+/gu, " ").trim().toLowerCase();
const isChina = (value:string) => ["china","中国","cn","chn"].includes(normalized(value));

// Optional display fields do not determine scope; missing/foreign geography does.
export function validateAbbvieChinaRowScope(html: string): boolean {
  const $ = load(html), rows = $(".attrax-vacancy-tile").toArray();
  if (rows.length === 0) return false;
  return rows.every(row => {
    const $row=$(row);
    const location=$row.find(".attrax-vacancy-tile__location-freetext .attrax-vacancy-tile__item-value");
    const option=$row.find(".attrax-vacancy-tile__option-location .attrax-vacancy-tile__item-value");
    if (location.length!==1 || option.length>1) return false;
    const hint=option.text();
    if (explicitlyForeignOrNonMainlandLocation(hint)) return false;
    const countries=$row.find("[itemprop='addressCountry'],[data-country]").toArray()
      .map(n=>$(n).attr("data-country") ?? $(n).attr("content") ?? $(n).text());
    if ($row.attr("data-country")) countries.push($row.attr("data-country")!);
    countries.push(...$row.find('.attrax-vacancy-tile__country .attrax-vacancy-tile__item-value').toArray().map(n=>$(n).text()));
    const locationAttributes=[$row.attr("data-location"),...$row.find('[data-location]').toArray().map(n=>$(n).attr('data-location'))];
    if (locationAttributes.some(value=>typeof value==="string" && explicitlyForeignOrNonMainlandLocation(value))) return false;
    for (const script of $row.find('script[type="application/ld+json"]').toArray()) {
      let root: unknown; try { root=JSON.parse($(script).text()); } catch { return false; }
      const postings: any[]=[];
      const visit=(value:any):void=>{
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (!value || typeof value!=="object") return;
        if (value["@type"]==="JobPosting" || Array.isArray(value["@type"]) && value["@type"].includes("JobPosting")) postings.push(value);
        if (value["@graph"]) visit(value["@graph"]);
      };
      visit(root);
      for (const posting of postings) for (const place of [posting.jobLocation].flat()) {
        const address=place?.address;
        const country=typeof address?.addressCountry==="object" ? address.addressCountry?.name : address?.addressCountry;
        if (typeof country==="string") countries.push(country);
        if ([address?.addressLocality,address?.addressRegion].some(value=>typeof value==="string" && explicitlyForeignOrNonMainlandLocation(value))) return false;
      }
    }
    if (countries.some(value=>value.trim() && !isChina(value))) return false;
    return isReviewedAbbvieLocation(location.text(),hint);
  });
}
