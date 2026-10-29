import { CITY_PENDING } from "../domain/jobLocation";
import { load } from "cheerio";
import { parse } from "@babel/parser";
import { isDeepStrictEqual } from "node:util";
import { reviewedMainlandCity } from "./reviewedMainlandCity";
import { phenomOfficialPostedDate } from "./phenomOfficialPostedDate";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import type { PersistentSourceFetchEvidence, SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { irreversibleOfficialJsonEvidenceId, persistentOfficialJsonJobId } from "./officialJsonEvidence";

// Reviewed source fields, not a requisition, title, or count allowlist. Unknown
// fields (including shadow geography) require review before this policy expands.
const RAW_FIELDS = new Set([
  "subCategory", "ml_skills", "type", "descriptionTeaser", "state", "siteType", "multi_category", "reqId", "city",
  "latitude", "industry", "multi_location", "address", "applyUrl", "ml_job_parser", "externalApply", "cityState", "country",
  "visibilityType", "longitude", "jobId", "locale", "title", "jobSeqNo", "postedDate", "workLocation", "dateCreated",
  "cityStateCountry", "employeeType", "jobVisibility", "location", "category", "isMultiLocation", "multi_location_array",
  "isMultiCategory", "multi_category_array", "badge"
]);
const LOCALITIES = [
  { city:"Shanghai", state:"Shanghai", chinese:"上海", latitude:"31.22222", longitude:"121.45806", path:"CHN---Shanghai---Shanghai", applySuffix:"-[1-9]\\d*" },
  { city:"Wenzhou", state:"Zhejiang", chinese:"温州", latitude:"27.99942", longitude:"120.66682", path:"CHN---Zhejiang---Wenzhou", applySuffix:"-[1-9]\\d*" },
  { city:"Guangzhou", state:"Guangdong", chinese:"广州", latitude:"23.11667", longitude:"113.25", path:"CHN---Guangdong---Guangzhou", applySuffix:"(?:-[1-9]\\d*)?" },
  { city:"", state:"Henan – Zhengzhou", chinese:"郑州", latitude:"33.81876", longitude:"112.13664", path:"CHN---Henan--Zhengzhou", applySuffix:"-[1-9]\\d*" },
  { city:"Nanchang", state:"Jiangxi", chinese:"南昌", latitude:"28.68396", longitude:"115.85306", path:"CHN---Jiangxi---Nanchang", applySuffix:"-[1-9]\\d*" },
  { city:"Shijiazhuang", state:"Hebei", chinese:"石家庄", latitude:"38.04139", longitude:"114.47861", path:"CHN---Hebei---Shijiazhuang", applySuffix:"-[1-9]\\d*" },
  { city:"Taiyuan", state:"Shanxi", chinese:"太原", latitude:"37.86944", longitude:"112.56028", path:"CHN---Shanxi---Taiyuan", applySuffix:"-[1-9]\\d*" },
  // The observed Chengdu schema deliberately leaves city empty in both the
  // primary and nested records. Every redundant field must match this shape.
  { city:"", state:"Chengdu", chinese:"成都", latitude:"30.66667", longitude:"104.06667", path:"CHN---Chengdu", applySuffix:"" }
] as const;
// These official addresses and work-location labels were independently
// inspected. Neither wins over other mainland evidence when cities disagree.
const ADDRESSES = new Map([
  ["1901 Huashan Lu, One ITC, Shanghai, 200030 Shanghai, China", "上海"],
  ["3 Xi Yu Jie, East Tower, Chengdu, 610041 Sichuan, China", "成都"],
  ["28 Zhujiang E Rd, Tianhe Guangzhou, Guangzhou, 510000 Guangdong, China", "广州"]
]);
const WORK_LOCATIONS = new Map([
  ["CHN - Shanghai - Shanghai", "上海"], ["CHN - Zhejiang - Wenzhou", "温州"], ["CHN - Chengdu", "成都"],
  ["CHN - Guangdong - Guangzhou", "广州"]
]);
const PARSER_FIELDS = new Set(["descriptionTeaser", "descriptionTeaser_first200", "descriptionTeaser_keyword", "descriptionTeaser_ats"]);
const ARRAY_FIELDS = new Set(["ml_skills", "multi_category", "multi_location", "jobVisibility"]);
const OBJECT_FIELDS = new Set(["ml_job_parser", "multi_location_array", "multi_category_array"]);
function record(value:unknown): value is Record<string,unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactFields(value:Record<string,unknown>, fields:readonly string[]):boolean {
  return Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value,field));
}
function cityLabel(value:string):string|undefined { return value === "Chengdu" || value === "成都" ? "成都" : LOCALITIES.find(place => (place.city !== "" && place.city === value) || place.chinese === value)?.chinese; }

/** Require matching external requisition identities and a reviewed official
 * Workday path. This proves URL identity, never application availability.
 * The URL locality is separately audited as geographic evidence. */
export function organonOfficialIdentity(raw:Record<string,unknown>):boolean {
  if (typeof raw.reqId !== "string" || !/^R\d+$/u.test(raw.reqId) || raw.jobId !== raw.reqId ||
    raw.jobSeqNo !== `MECEUS${raw.reqId}ZHCN` || raw.locale !== "zh_CN" || raw.siteType !== "external" ||
    raw.visibilityType !== "External" || raw.externalApply !== true || !Array.isArray(raw.jobVisibility) ||
    !raw.jobVisibility.includes("external") || raw.jobVisibility.some(label => label !== "external" && label !== "internal") ||
    new Set(raw.jobVisibility).size !== raw.jobVisibility.length || typeof raw.applyUrl !== "string") return false;
  let url:URL;
  try {url=new URL(raw.applyUrl);} catch {return false;}
  const place=LOCALITIES.find(item=>url.pathname.split("/")[3]===item.path);
  return url.origin === "https://organon.wd5.myworkdayjobs.com" && !url.username && !url.password && !url.search && !url.hash &&
    raw.applyUrl === url.toString() && !!place &&
    new RegExp(`^/SearchJobs/job/${place.path}/[A-Za-z0-9-]+_${raw.reqId}${place.applySuffix}/apply$`,"u").test(url.pathname);
}

/** Audits all redundant primary/nested geography and explicit textual job
 * locations. Known mainland disagreement keeps a singleton city-pending value;
 * foreign, unrecognized, missing or structurally ambiguous structured geography fails.
 * Descriptive ambiguity is field-level uncertainty after the structured proof. */
export function organonOfficialCities(raw:Record<string,unknown>):string[]|undefined {
  const hasWorkLocation=Object.hasOwn(raw,"workLocation");
  if (Object.keys(raw).some(field=>!RAW_FIELDS.has(field)) || raw.country !== "China" || raw.isMultiLocation !== true ||
    typeof raw.title !== "string" || !raw.title.trim() || typeof raw.address !== "string" ||
    (hasWorkLocation && typeof raw.workLocation !== "string")) return undefined;
  for (const [field,value] of Object.entries(raw)) {
    if (ARRAY_FIELDS.has(field)) {if(!Array.isArray(value)||value.some(item=>typeof item!=="string"))return undefined;}
    else if (!OBJECT_FIELDS.has(field) && field!=="externalApply" && field!=="isMultiLocation" && field!=="isMultiCategory" && field!=="postedDate" && typeof value!=="string") return undefined;
  }
  if (Object.hasOwn(raw,"isMultiCategory") && raw.isMultiCategory !== false) return undefined;
  if (Object.hasOwn(raw,"multi_category_array") && (!Array.isArray(raw.multi_category_array) || raw.multi_category_array.some(value =>
    !record(value) || !exactFields(value,["category"]) || typeof value.category!=="string"))) return undefined;
  const primary=LOCALITIES.find(place=>raw.city===place.city && raw.state===place.state);
  if(!primary)return undefined;
  const primaryCityState=[primary.city,primary.state].filter(Boolean).join(", "),location=`${primaryCityState}, China`;
  if(raw.location!==location || raw.cityStateCountry!==location || raw.cityState!==primaryCityState ||
    raw.latitude!==primary.latitude || raw.longitude!==primary.longitude || !Array.isArray(raw.multi_location) || !raw.multi_location.length ||
    !Array.isArray(raw.multi_location_array) || raw.multi_location_array.length!==raw.multi_location.length)return undefined;
  const cities=new Set<string>([primary.chinese]);
  for(let index=0;index<raw.multi_location.length;index++){
    const nested=raw.multi_location_array[index];
    if(!record(nested)||!exactFields(nested,["country","cityState","city","latlong","latitude","location","state","cityCountry","cityStateCountry","mapQueryLocation","stateCountry","longitude"]))return undefined;
    // Additional structured mainland locations reuse the shared exact province/city
    // pairs. They do not replace the reviewed primary locality or infer a city
    // from coordinates; the redundant coordinate representations still agree.
    const known=LOCALITIES.find(item=>nested.city===item.city && nested.state===item.state);
    const chinese=typeof nested.city === "string" && typeof nested.state === "string"
      ? reviewedMainlandCity(nested.city, nested.state) : undefined;
    const coordinate=(value:unknown,max:number)=>typeof value === "string" && /^-?\d+(?:\.\d+)?$/u.test(value) &&
      Number.isFinite(Number(value)) && Math.abs(Number(value)) <= max;
    const place=known ?? (chinese && coordinate(nested.latitude,90) && coordinate(nested.longitude,180)
      ? {city:nested.city as string,state:nested.state as string,chinese,latitude:nested.latitude as string,longitude:nested.longitude as string} : undefined);
    if(!place)return undefined;
    const cityState=[place.city,place.state].filter(Boolean).join(", "),expected=`${cityState}, China`;
    if(nested.country!=="China" || nested.location!==expected || nested.cityStateCountry!==expected || nested.mapQueryLocation!==expected ||
      nested.cityCountry!==(place.city?`${place.city}, China`:"China") || nested.stateCountry!==`${place.state}, China` || nested.cityState!==cityState ||
      raw.multi_location[index]!==expected || nested.latitude!==place.latitude || nested.longitude!==place.longitude ||
      !record(nested.latlong)||!exactFields(nested.latlong,["lat","lon"])||nested.latlong.lat!==Number(place.latitude)||nested.latlong.lon!==Number(place.longitude))return undefined;
    cities.add(place.chinese);
  }
  const address=ADDRESSES.get(raw.address),work=hasWorkLocation?WORK_LOCATIONS.get(raw.workLocation as string):undefined;
  if(!address||(hasWorkLocation&&!work)||!organonOfficialIdentity(raw))return undefined;
  cities.add(address);if(work)cities.add(work);
  const path=new URL(raw.applyUrl as string).pathname.split("/")[3]!;
  const urlPlace=LOCALITIES.find(place=>path===place.path);
  if(!urlPlace)return undefined;
  cities.add(urlPlace.chinese);
  // Only the observed Guangzhou omission is supported. Its audited primary,
  // nested, coordinates, address and native URL must all agree; a blank/null
  // field or another locality is not equivalent official evidence.
  if(!hasWorkLocation&&(primary.city!=="Guangzhou"||cities.size!==1))return undefined;
  // Audit every permitted descriptive surface; an allowed field name is not
  // permission to hide new job geography in a label, skill or category.
  const descriptiveFields = ["title", "descriptionTeaser", "subCategory", "type", "industry", "employeeType", "category", "badge"];
  const texts:unknown[]=descriptiveFields.filter(field=>Object.hasOwn(raw,field)).map(field=>raw[field]);
  for(const field of ["ml_skills", "multi_category"])if(Array.isArray(raw[field]))texts.push(...raw[field]);
  if(Array.isArray(raw.multi_category_array))texts.push(...raw.multi_category_array.map(value=>(value as Record<string,unknown>).category));
  if(Object.hasOwn(raw,"ml_job_parser")){
    if(!record(raw.ml_job_parser)||Object.keys(raw.ml_job_parser).some(key=>!PARSER_FIELDS.has(key)))return undefined;
    texts.push(...Object.values(raw.ml_job_parser));
  }
  let pending = false;
  for (const original of texts) {
    if (typeof original !== "string") return undefined;
    const scope = organonTextLocationScope(original);
    if (!scope) return undefined;
    pending ||= scope.pending;
    scope.cities.forEach(city => cities.add(city));
  }
  // A new dash suffix may name a department, product or sales territory. Its
  // uncertainty is confined to the city field after structured China is proved.
  const suffix = /[-–—]\s*(.+)$/u.exec(raw.title.replace(/\s+/gu, " ").trim())?.[1];
  if (suffix) {
    const labels = suffix.split("/").map(label => cityLabel(label.trim()));
    if (labels.some(label => !label)) pending = true;
    else labels.forEach(label => cities.add(label!));
  }
  return !pending && cities.size === 1 ? [primary.chinese] : [CITY_PENDING];
}

// A known foreign place contradicts China only when it is the target of an
// explicit workplace clause. Foreign customers/territories and unrecognized
// prose remove city confidence without discarding independently scoped jobs.
const FOREIGN_PLACE = /\b(?:united states|usa|u\.s\.?|boston|new york|san francisco|los angeles|seattle|indianapolis|singapore|japan|tokyo|korea|seoul|australia|canada|germany|berlin|france|paris|united kingdom|london|india|malaysia|thailand|vietnam|indonesia|philippines|netherlands|amsterdam|brazil|sao paulo|hong kong|taiwan|macau|macao|overseas|abroad)\b|新加坡|香港|澳门|澳門|台湾|台灣|美国|纽约|波士顿|英國|英国|伦敦|日本|东京|韩国|韓國|德国|柏林|法国|巴黎|加拿大|澳大利亚|印度|荷兰|阿姆斯特丹|巴西|圣保罗|海外|国外/iu;
const WORKPLACE_CLAUSES = [
  /\b(?:(?:work|job|office)\s+(?:location|address|base)|location|office|workplace)\s*(?:[:：]|is(?:\s+in)?)\s*([^.;。；\r\n]+)/giu,
  /\b(?:based|located|stationed|situated)\s+(?:in|at|out\s+of)\s+([^.;。；\r\n]+)/giu,
  /\brelocat(?:ion|e|ing)\s+to\s+([^.;。；\r\n]+)/giu,
  /\bwork(?:ing|s)?\s+(?:in|from|at)\s+([^.;。；\r\n]+)/giu,
  /\b(?:this\s+)?(?:role|position|job|office|workplace)\s+(?:is\s+|will\s+be\s+)(?:in|at)\s+([^.;。；\r\n]+)/giu,
  /\b([A-Za-z]+(?:[ -][A-Za-z]+)*)[ -]based\b/giu,
  /(?:工作地点|工作城市|工作地址|办公地点|办公城市|办公地址|办公地|办公室|岗位驻地|驻地)\s*(?:[:：]|为|是|在)\s*([^。；\r\n]+)/gu,
  /(?:本职位|本岗位|工作|办公)\s*(?:在|位于)\s*([^。；\r\n]+)/gu,
  /\bat\s+our\s+([^.;。；\r\n]+?)\s+site\b/giu
];
const LOCATION_SIGNAL = /\b(?:location|workplace|office|remote|based|located|stationed|headquartered|territory)\b|工作地|工作城市|工作区域|办公|驻地|本职位在|本岗位在/iu;
const BUSINESS_SUBJECT = /\b(?:customers?|clients?|partners?|suppliers?|distributors?|markets?|territor(?:y|ies))\s+(?:(?:who|that)\s+(?:(?:are|work)\s+)?|(?:are|is)\s+)?$/iu;

function organonTextLocationScope(original: string): { pending: boolean; cities: string[] } | undefined {
  const text = original.replace(/\s+/gu, " ").trim();
  // Ordinary software skill language says nothing about where a role works.
  const analysisText = text.replace(/\b(?:ms|microsoft)\s+office\b/giu, "office-software");
  let pending = FOREIGN_PLACE.test(analysisText);
  let residual = analysisText;
  const cities = new Set<string>();
  const foreignAtStart = new RegExp(`^(?:${FOREIGN_PLACE.source})`, "iu");
  const foreignAtEnd = new RegExp(`(?:${FOREIGN_PLACE.source})$`, "iu");
  for (const grammar of WORKPLACE_CLAUSES) {
    // Each grammar examines the full text so later independent workplace
    // clauses remain visible even when an earlier local clause also matches.
    const scanner = new RegExp(grammar.source, grammar.flags);
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(analysisText))) {
      // Overlapping inspection also catches two occurrences of the same
      // grammar, e.g. "based in Shanghai but based in Singapore".
      scanner.lastIndex = match.index + 1;
      const before = analysisText.slice(0, match.index);
      const after = analysisText.slice(match.index + match[0].length);
      const inverted = /[ -]based\b/iu.test(match[0]) && !/^based\b/iu.test(match[0]);
      if (BUSINESS_SUBJECT.test(before) ||
        (inverted && /^\s+(?:customers?|clients?|partners?|suppliers?|distributors?|markets?|territor(?:y|ies))\b/iu.test(after)) ||
        (/\b(?:not|never|no)\s+(?:\w+\s+){0,2}$/iu.test(before) && !/\bnot\s+only\s+(?:\w+\s+){0,2}$/iu.test(before))) {
        pending = true;
        continue;
      }
      const target = match[1]!.trim();
      const targets = target.split(/\s*(?:[/,，]|\band\b|\bor\b|和|或|、)\s*/iu);
      const foreignWorkplace = targets.some(value => {
        const destination = value.replace(/^(?:(?:the|a|an|our|their|its)\s+)/iu, "");
        if (!foreignAtStart.test(destination)) return false;
        // "Shanghai, and Singapore is a key sales territory" contains a new
        // business clause, unlike the direct workplace list "Shanghai and Singapore".
        const remainder = destination.replace(foreignAtStart, "").trim();
        const businessClause = /^(?:is|forms|represents)\s+(?:(?:a|an|the|our|key|major|important|primary|main)\s+)*(?:(?:sales|customer|business)\s+)?(?:territory|market|customer base)\b/iu.test(remainder);
        if (businessClause) { pending = true; return false; }
        return true;
      });
      if (foreignWorkplace || (inverted && foreignAtEnd.test(target))) return undefined;
      const place = cityLabel(target.replace(/,\s*China$/iu, ""));
      if (place) cities.add(place); else pending = true;
      residual = residual.replace(match[0], "");
    }
  }
  if (LOCATION_SIGNAL.test(residual.replaceAll("office-software", "software"))) pending = true;
  return { pending, cities: [...cities] };
}

/** The original keyword entry carries a server-rendered search snapshot. Only a
 * complete, identity-unique snapshot may prove equivalence to all country pages.
 * A partial/missing snapshot remains HOLD; equal totals alone never suffice. */
export function organonKeywordCountryEquivalent(html: string | Uint8Array, rows: readonly Record<string,unknown>[]): boolean {
  try {
    const $ = load(typeof html === "string" ? html : Buffer.from(html).toString("utf8"));
    const assignments: string[] = [];
    let references = 0;
    for (const node of $('script:not([src])').toArray()) {
      const type = ($(node).attr("type") ?? "").trim().toLowerCase();
      if (type && !["text/javascript", "application/javascript", "module"].includes(type)) continue;
      const code = $(node).text();
      const program = parse(code, {sourceType:type === "module" ? "module" : "script"}).program;
      const scan = (value:unknown):void => {
        if (!value || typeof value !== "object") return;
        const item=value as Record<string,any>;
        if (item.type === "MemberExpression" && item.object?.type === "Identifier" && item.object.name === "phApp" &&
          ((!item.computed && item.property?.name === "ddo") || (item.computed && item.property?.value === "ddo"))) references++;
        for (const nested of Object.values(item)) if (Array.isArray(nested)) nested.forEach(scan); else if (nested && typeof nested === "object") scan(nested);
      };
      scan(program);
      for (const statement of program.body) {
        if (statement.type !== "ExpressionStatement" || statement.expression.type !== "AssignmentExpression") continue;
        const expression = statement.expression, left = expression.left;
        if (expression.operator !== "=" || left.type !== "MemberExpression" || left.computed ||
          left.object.type !== "Identifier" || left.object.name !== "phApp" ||
          left.property.type !== "Identifier" || left.property.name !== "ddo" || expression.right.type !== "ObjectExpression") continue;
        assignments.push(code.slice(expression.right.start!, expression.right.end!));
      }
    }
    if (references !== 1 || assignments.length !== 1 || !hasUniqueJsonObjectKeys(assignments[0]!)) return false;
    const search = JSON.parse(assignments[0]!).eagerLoadRefineSearch;
    if (!record(search) || search.status !== 200 || !Number.isSafeInteger(search.totalHits) || (search.totalHits as number) < 0 ||
      search.hits !== search.totalHits || !record(search.data) || search.data.keywords !== "China" ||
      !Array.isArray(search.data.jobs) || search.data.jobs.length !== search.totalHits || rows.length !== search.totalHits) return false;
    const keyword = new Map<string,Record<string,unknown>>();
    for (const row of search.data.jobs) {
      if (!record(row) || !organonOfficialIdentity(row) || keyword.has(row.jobSeqNo as string)) return false;
      keyword.set(row.jobSeqNo as string,row);
    }
    const country = new Set<string>();
    for (const row of rows) {
      const id=row.jobSeqNo as string;
      if (!organonOfficialIdentity(row) || country.has(id) || !isDeepStrictEqual(keyword.get(id),row)) return false;
      country.add(id);
    }
    return country.size === keyword.size;
  } catch { return false; }
}

/** Reuse the existing Lilly Workday HTML proof on Organon's listed native URL.
 * Availability is observed independently from URL identity. No login or submit. */
export function organonNativeDetail(raw: Record<string,unknown>, artifact: SourceFetchArtifactDraft | undefined, startedAt:string): "ACTIVE" | "CLOSED" | undefined {
  if (!artifact || !organonOfficialIdentity(raw) || artifact.logicalKey !== `organon-detail-${raw.reqId}` ||
    artifact.kind !== "OFFICIAL_COMPANY_PAGE" || artifact.extractorLocator !== "organon-workday-jobposting-v1" ||
    artifact.requestedUrl !== raw.applyUrl || artifact.finalUrl !== raw.applyUrl || artifact.httpStatus !== 200 ||
    !/^text\/html(?:;|$)/iu.test(artifact.contentType ?? "") || artifact.bodyRepresentation === "REDACTED" || typeof artifact.body !== "string") return undefined;
  const time=Date.parse(artifact.capturedAt), start=Date.parse(startedAt);
  if (!Number.isFinite(time) || !Number.isFinite(start) || time < start || time > start + 30 * 60_000) return undefined;
  try {
    const $=load(artifact.body), clean=(text:string)=>load(text).text().replace(/\s+/gu," ").trim();
    const jobs=$('script[type="application/ld+json"]').toArray().map(node=>{
      const text=$(node).text(); if(!hasUniqueJsonObjectKeys(text))throw Error("Ambiguous native JSON"); return JSON.parse(text);
    }).filter(value=>record(value) && value["@type"] === "JobPosting");
    // Bind actual static properties, not text in comments/strings or a value
    // later overwritten in the same script. This is the observed Workday shape.
    const assignments: any[] = []; const topLevel=new Set<unknown>(); let overwritten=false;
    const path=(node:any):string|undefined => node?.type === "Identifier" ? node.name : node?.type === "MemberExpression"
      ? `${path(node.object)}.${node.computed ? node.property?.value : node.property?.name}` : undefined;
    for (const script of $('script:not([src])').toArray()) {
      const type=($(script).attr("type")??"").trim().toLowerCase();
      if(type && !["text/javascript","application/javascript","module"].includes(type))continue;
      const program=parse($(script).text(),{sourceType:type === "module" ? "module" : "script"}).program;
      program.body.forEach(statement=>{if(statement.type === "ExpressionStatement")topLevel.add(statement.expression);});
      const scan=(node:any):void=>{
        if(!node || typeof node !== "object")return;
        if(node.type === "AssignmentExpression") {
          const target=path(node.left);
          if(target === "window.workday" || target === "workday") assignments.push(node);
          if(/^(?:window\.)?workday\.(?:tenant|siteId|postingAvailable)$/u.test(target??""))overwritten=true;
        }
        if(node.type === "CallExpression" && node.arguments.some((argument:any)=>["workday","window.workday"].includes(path(argument)??"")))overwritten=true;
        for(const value of Object.values(node))if(Array.isArray(value))value.forEach(scan);else if(value && typeof value === "object")scan(value);
      };scan(program);
    }
    const assignment=assignments.length === 1 ? assignments[0] : undefined;
    const object=assignment?.operator === "=" && path(assignment.left) === "window.workday" &&
      assignment.right.type === "LogicalExpression" && assignment.right.operator === "||" && path(assignment.right.left) === "window.workday"
      ? assignment.right.right : undefined;
    const properties=object?.type === "ObjectExpression" ? object.properties : [];
    const keys=properties.map((property:any)=>property.key?.name??property.key?.value);
    const literal=(key:string)=>properties.find((property:any)=>(property.key?.name??property.key?.value) === key)?.value;
    const bound=!overwritten && topLevel.has(assignment) && properties.length > 0 && properties.every((property:any)=>property.type === "ObjectProperty" && !property.computed && !property.method) &&
      new Set(keys).size === keys.length && literal("tenant")?.type === "StringLiteral" && literal("tenant").value === "organon" &&
      literal("siteId")?.type === "StringLiteral" && literal("siteId").value === "SearchJobs" &&
      literal("postingAvailable")?.type === "BooleanLiteral";
    if (!bound) return undefined;
    // A closed shell must bind its own URL and cannot also contain a job posting.
    if (literal("postingAvailable").value === false) return $('script[type="application/ld+json"]').length === 0 &&
      $('meta[property="og:url"]').length === 1 && $('meta[property="og:url"]').attr("content") === raw.applyUrl ? "CLOSED" : undefined;
    const job=jobs.length === 1 ? jobs[0] : undefined;
    if (!record(job) || !record(job.identifier) || job.identifier.value !== raw.reqId ||
      typeof job.title !== "string" || typeof raw.title !== "string" || clean(job.title) !== clean(raw.title) ||
      typeof job.description !== "string" || !clean(job.description) ||
      typeof job.datePosted !== "string" || phenomOfficialPostedDate(raw.postedDate)?.slice(0,10) !== job.datePosted ||
      !record(job.jobLocation) || !record(job.jobLocation.address)) return undefined;
    const address=job.jobLocation.address;
    // The native primary cannot erase an additional mainland list location.
    const primary=new URL(raw.applyUrl as string).pathname.split("/")[3]!.replaceAll("---"," - ");
    return address.addressCountry === "China" && address.addressLocality === primary ? "ACTIVE" : undefined;
  } catch { return undefined; }
}

export function organonClosedLoss(raw: Record<string, unknown>, pageSequence: number, recordIndex: number,
  recordedAt: string): PersistentSourceFetchEvidence["fetchLosses"][number] {
  return {stage: "VALIDATION", reason: "Organon official application explicitly no longer accepts applicants",
    rawLocator: `phenom-page-${String(pageSequence).padStart(4, "0")}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId([recordIndex, raw])}`,
    details: {code: "ORGANON_OFFICIAL_APPLICATION_CLOSED", pageSequence, recordIndex}, recordedAt};
}

/** Only consumed after the complete source and exact closure ledger have passed replay. */
export function organonClosedSourceJobIds(evidence: PersistentSourceFetchEvidence): Set<string> {
  return new Set(evidence.fetchLosses.filter(loss => loss.details?.code === "ORGANON_OFFICIAL_APPLICATION_CLOSED").map(loss => {
    const page = evidence.artifacts.find(artifact => artifact.logicalKey === `phenom-page-${String(loss.details!.pageSequence).padStart(4, "0")}`)!;
    const raw = JSON.parse(typeof page.body === "string" ? page.body : Buffer.from(page.body).toString("utf8"))
      .refineSearch.data.jobs[loss.details!.recordIndex as number];
    return persistentOfficialJsonJobId(raw.jobSeqNo);
  }));
}
