import { reviewedMainlandCity } from "./reviewedMainlandCity";
import { load } from "cheerio";

// Source-specific reviewed spelling, not a title/URL-to-location lookup. New
// geography is retained by acquisition but cannot certify completeness until reviewed.
const MAINLAND_CITY_PROVINCE = new Map(Object.entries({
  Beijing: "Beijing", Changchun: "Jilin", Changsha: "Hunan", Chengdu: "Sichuan",
  Chongqing: "Chongqing", Guangzhou: "Guangdong Province", Guiyang: "Guizhou",
  Hangzhou: "Zhejiang", Harbin: "Heilongjiang", Hefei: "Anhui", Hohhot: "Inner Mongolia", Jinan: "Shandong",
  Kunming: "Yunnan", Nanjing: "Jiangsu", Nanning: "Guangxi", Shanghai: "Shanghai",
  Shenzhen: "Guangdong Province", Shijiazhuang: "Hebei", Taiyuan: "Shanxi",
  Tianjin: "Tianjin", Wenzhou: "Zhejiang", Wuhan: "Hubei", "Xi'An": "Shaanxi", Xiamen: "Fujian",
  Yancheng: "Jiangsu", Yangzhou: "Jiangsu", Zhanjiang: "Guangdong Province",
  Zhengzhou: "Henan", "Ürümqi": "Xinjiang"
}).map(([city, province]) => [city.toLowerCase(), province.toLowerCase()]));
const MAINLAND_CITY_NAMES: Readonly<Record<string,string>> = Object.freeze({
  beijing:"北京",changchun:"长春",changsha:"长沙",chengdu:"成都",chongqing:"重庆",guangzhou:"广州",
  guiyang:"贵阳",hangzhou:"杭州",harbin:"哈尔滨",hefei:"合肥",hohhot:"呼和浩特",jinan:"济南",kunming:"昆明",
  nanjing:"南京",nanning:"南宁",shanghai:"上海",shenzhen:"深圳",shijiazhuang:"石家庄",taiyuan:"太原",
  tianjin:"天津",wenzhou:"温州",wuhan:"武汉","xi'an":"西安",xiamen:"厦门",yancheng:"盐城",yangzhou:"扬州",
  zhanjiang:"湛江",zhengzhou:"郑州","ürümqi":"乌鲁木齐"
});
/** Only a validated city/province pair can produce a city. The raw pair stays
 * intact on the record; province labels are never appended to cities. */
export function reviewedAbbvieCity(locationRaw:string):string|undefined {
  const parts=normalized(locationRaw).split(",").map(part=>part.trim());
  return parts.length !== 2 ? undefined : MAINLAND_CITY_PROVINCE.get(parts[0]!) === parts[1]
    ? MAINLAND_CITY_NAMES[parts[0]!] : reviewedMainlandCity(parts[0]!, parts[1]!);
}
export function isReviewedAbbvieLocation(locationRaw:string):boolean {
  // Official province-only posting: mainland scope is known, but no city is given.
  return !!reviewedAbbvieCity(locationRaw) || /^guangdong\s*,\s*gd$/u.test(normalized(locationRaw));
}
const GEO_CLASS = /^attrax-vacancy-tile__(?:.*-)?(?:location|country|city|province|region|address)(?:-|$)/u;
const KNOWN_GEO_CLASS = /^attrax-vacancy-tile__(?:location-freetext|option-location(?:--[^ ]+|-label|-valueset)?|option-work-location-type(?:--(?:remote|onsite)|-label|-valueset)?)$/u;
const normalized = (value: string) => value.replace(/\s+/gu, " ").trim().toLowerCase();

/** Independently checks each raw listing's two location fields and the reviewed
 * undated/full-time shape. A date sentinel is not turned into an actual date.
 * Unknown/conflicting rows fail the source proof; they are never silently removed. */
export function validateAbbvieChinaRowScope(html: string): boolean {
  const $ = load(html), rows = $(".attrax-vacancy-tile").toArray();
  if (rows.length === 0) return false; // No reviewed official-empty claim for this source.
  return rows.every(row => {
    const $row = $(row);
    const unknownGeoClass = $row.find("[class]").toArray().some(element =>
      ($(element).attr("class") ?? "").split(/\s+/u).some(name => GEO_CLASS.test(name) && !KNOWN_GEO_CLASS.test(name)));
    const unknownDateClass = $row.find("[class]").toArray().some(element =>
      ($(element).attr("class") ?? "").split(/\s+/u).some(name =>
        /^attrax-vacancy-tile__(?:.*-)?(?:date|posted|published|closing|expiry)(?:-|$)/u.test(name) &&
        !/^attrax-vacancy-tile__expiry(?:-label|-value)?$/u.test(name)));
    if (unknownGeoClass || unknownDateClass || $row.find("[itemprop='addressCountry'],[data-country],[data-location],script[type='application/ld+json']").length > 0) return false;
    const location = $row.find(".attrax-vacancy-tile__location-freetext .attrax-vacancy-tile__item-value");
    const option = $row.find(".attrax-vacancy-tile__option-location");
    const optionValues = option.find(".attrax-vacancy-tile__item-value");
    const workType = $row.find(".attrax-vacancy-tile__option-job-type .attrax-vacancy-tile__item-value");
    const expiry = $row.find(".attrax-vacancy-tile__expiry-value");
    if (location.length !== 1 || option.length !== 1 || optionValues.length !== 1 || workType.length !== 1 || expiry.length !== 1) return false;
    const parts = normalized(location.text()).split(",").map(part => part.trim());
    if (parts.length !== 2 || !isReviewedAbbvieLocation(location.text())) return false;
    const declaredLocation = normalized(optionValues.text());
    if (declaredLocation !== "china" && declaredLocation !== parts[0]) return false;
    const locationClasses = (option.attr("class") ?? "").split(/\s+/u)
      .filter(name => name.startsWith("attrax-vacancy-tile__option-location--"));
    if (locationClasses.length !== 1 || locationClasses[0] !== `attrax-vacancy-tile__option-location--${declaredLocation}`) return false;
    if (normalized(workType.text()) !== "full-time" || expiry.text().trim() !== "01/01/0001") return false;
    // New structured date fields need a separately reviewed date contract.
    if ($row.find("time,[datetime],[itemprop='datePosted'],[itemprop='validThrough'],[data-date-posted]").length > 0) return false;
    return true;
  });
}
