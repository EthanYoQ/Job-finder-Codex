/** Independent Hengrui Moka original-response review. No fetch, SQL, or native
 * scope-proof call. Cryptographic request bindings and geographic decisions are
 * recomputed here before both output projections are compared. */
import assert from 'node:assert/strict';
import {createDecipheriv,createHash} from 'node:crypto';
import {load} from 'cheerio';
import {hasUniqueJsonObjectKeys} from '../vendor/c60-source/src/crawler/strictJsonObjectKeys.ts';
import {containsSensitiveAdapterValue} from '../vendor/c60-source/src/crawler/adapters/safeAdapterValue.ts';
import type {PersistentSourceFetchEvidence,SourceFetchArtifactDraft} from '../vendor/c60-source/src/crawler/sourceFetchEvidence.ts';

const CAMPAIGN='https://app.mokahr.com/social-recruitment/hengrui/145996';
const LIST='https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2';
const DETAIL='https://app.mokahr.com/api/outer/ats-apply/website/job';
const CHAIN='https://www.hengrui.com/development/joinUs.html';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const clean=(value:string)=>value.replace(/\s+/gu,' ').trim();
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function json(body:string):Record<string,any>{assert(hasUniqueJsonObjectKeys(body),'HENGRUI_DUPLICATE_JSON_KEY');const value=JSON.parse(body);assert(object(value),'HENGRUI_JSON_OBJECT_REQUIRED');return value;}
function text(value:unknown):string{assert(typeof value==='string'&&value.trim(),'HENGRUI_TEXT_REQUIRED');return value.trim();}
function idOf(row:Record<string,any>):string{return typeof row.id==='number'?(assert(Number.isSafeInteger(row.id),'HENGRUI_JOB_ID'),String(row.id)):text(row.id);}
function canonical(value:any):any{return Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([k,v])=>[k,canonical(v)])):value;}
function contract(base:string,role:string,url:string,body:any,coordinate:any):string{return base+'|request-contract-v2|sha256:'+hash(JSON.stringify(canonical({v:2,family:'moka',role,method:'POST',url,body,coordinate})));}
function sameIds(actual:readonly string[],expected:string[],label:string){assert.equal(actual.length,new Set(actual).size,label);assert.deepEqual([...actual].sort(),[...expected].sort(),label);}
function bodyOf(a:SourceFetchArtifactDraft):string{return typeof a.body==='string'?a.body:Buffer.from(a.body).toString('utf8');}
function decrypt(a:SourceFetchArtifactDraft,iv:string):Record<string,any>{const e=json(bodyOf(a));assert(typeof e.data==='string'&&typeof e.necromancer==='string'&&Buffer.byteLength(e.necromancer)===16,'HENGRUI_ENVELOPE');const d=createDecipheriv('aes-128-cbc',Buffer.from(e.necromancer),Buffer.from(iv));return json(d.update(e.data,'base64','utf8')+d.final('utf8'));}
function locationShape(v:any):void{
 assert(object(v)&&Object.keys(v).every(k=>['id','country','cityName','cityId','provinceName','provinceId'].includes(k)),'HENGRUI_LOCATION_SHAPE');text(v.country);
 for(const k of ['cityName','provinceName'])if(v[k]!==undefined)text(v[k]);
 for(const k of ['cityId','provinceId'])if(v[k]!==undefined)assert(Number.isSafeInteger(v[k])&&v[k]>0,'HENGRUI_LOCATION_ID');
 if(v.id!==undefined)assert(typeof v.id==='string'&&v.id.trim()||typeof v.id==='number'&&Number.isSafeInteger(v.id)&&v.id>=0,'HENGRUI_LOCATION_RECORD_ID');
 for(const v2 of [v.country,v.cityName,v.provinceName])if(v2!==undefined)assert(!containsSensitiveAdapterValue(v2),'HENGRUI_SENSITIVE_LOCATION');
}
function hk(v:any):boolean{return v.country==='中国'&&v.cityName==='香港'&&v.provinceName==='香港'&&v.cityId===810000&&v.provinceId===810000;}
function waltham(v:any):boolean{return ['美国','United States','US','USA'].includes(v.country)&&['沃尔瑟姆','Waltham'].includes(v.cityName)&&['马萨诸塞州','Massachusetts','MA'].includes(v.provinceName)&&v.cityId===undefined&&v.provinceId===undefined;}

// Positive geography vocabulary is pinned to the reviewed source definitions.
// The following decision procedure is independently implemented.
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
  ["景洪", 532801], ["兴义", 522301], ["慈溪", 330282], ["余姚", 330281],
  ["普宁", 445281], ["开远", 532502], ["莱西", 370285], ["平度", 370283],
  ["邛崃", 510183], ["西昌", 513401], ["乐昌", 440281], ["福清", 350181],
  ["阿克苏地区", 652900], ["伊犁哈萨克自治州", 654000], ["博尔塔拉蒙古自治州", 652700],
  ["雷州", 440882], ["乐清", 330382], ["泰兴", 321283], ["长葛", 411082], ["枣阳", 420683]
]);
const COUNTRIES = new Set(["中国", "中国大陆", "中华人民共和国", "China", "CN"]);


function mainland(v:any):boolean{
 if(!COUNTRIES.has(v.country))return false;
 if(v.cityName===undefined&&v.provinceName===undefined)return v.cityId===undefined&&v.provinceId===undefined;
 const province=v.provinceName===undefined?undefined:PROVINCES.get(v.provinceName.trim().replace(/(?:维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/u,''));
 if(v.provinceName!==undefined&&!province)return false;
 const city=v.cityName===undefined?undefined:v.cityName.trim().replace(/市$/u,'');
 const county=city===undefined?undefined:ADDITIONAL_LOCALITIES.get(city);
 const cityProvince=city===undefined?undefined:county===undefined?CITY_PROVINCES.get(city):String(county).slice(0,2);
 if(city!==undefined&&!cityProvince||province&&cityProvince&&province!==cityProvince)return false;
 if(county!==undefined&&v.cityId!==county)return false;
 const code=cityProvince??province;
 return !!code&&(v.provinceId===undefined||v.provinceId===Number(code+'0000'))&&(v.cityId===undefined||/^\d{6}$/u.test(String(v.cityId))&&String(v.cityId).startsWith(code));
}
export type HengruiRawReviewEvidence=Pick<PersistentSourceFetchEvidence,'artifacts'|'pages'|'fetchCounts'|'fetchLosses'|'declaredCompleteness'>;
export interface HengruiReviewedRecord {sourceJobId:string;officialTitle:string;officialUrl:string;listUrl:string;locationRaw:string;cities:string[];}

/** Every original entry/page/detail is consumed exactly once in request order.
 * The official total includes independently proved exclusions; return value is
 * only the included mainland projection, never a rewritten official total. */
export function reviewHengruiRawPages(evidence:HengruiRawReviewEvidence,currentRows:readonly any[],nativeRows:readonly any[]):HengruiReviewedRecord[]{
 assert(object(evidence)&&Array.isArray(evidence.artifacts)&&Array.isArray(evidence.pages),'HENGRUI_FULL_ARCHIVE_REQUIRED');
 assert(evidence.pages.length>0&&evidence.pages.length<=100,'HENGRUI_PAGE_LIMIT');
 assert.equal(new Set(evidence.artifacts.map(a=>a.logicalKey)).size,evidence.artifacts.length,'HENGRUI_DUPLICATE_ARTIFACT');
 const artifacts=new Map(evidence.artifacts.map(a=>[a.logicalKey,a]));let artifactIndex=0,lastTime=-Infinity;
 const take=(key:string,kind:SourceFetchArtifactDraft['kind'],url:string,locator?:string)=>{
  const a=artifacts.get(key);assert(a,'HENGRUI_MISSING_ARTIFACT:'+key);assert.equal(evidence.artifacts[artifactIndex++]?.logicalKey,key,'HENGRUI_REQUEST_ORDER');
  assert.equal(a.kind,kind);assert.equal(a.requestedUrl,url);assert.equal(a.finalUrl,url);assert.equal(a.httpStatus,200);assert.equal(a.channelId,undefined);
  assert(a.bodyRepresentation===undefined||a.bodyRepresentation==='EXACT','HENGRUI_EXACT_ORIGINAL_REQUIRED');assert.equal(a.rawBodySha256,undefined);assert.equal(a.redactionDescriptors,undefined);
  assert((kind==='OFFICIAL_COMPANY_PAGE'?/^text\/html\b/iu:/^(?:application|text)\/json\b/iu).test(a.contentType??''),'HENGRUI_CONTENT_TYPE');
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(a.capturedAt));const at=Date.parse(a.capturedAt);assert(Number.isFinite(at)&&new Date(at).toISOString()===a.capturedAt&&at>=lastTime,'HENGRUI_CAPTURE_ORDER');lastTime=at;
  if(locator!==undefined)assert.equal(a.extractorLocator,locator,'HENGRUI_REQUEST_BINDING');return a;
 };
 const entry=take('moka-entry-0000','OFFICIAL_COMPANY_PAGE',CAMPAIGN,'html:#init-data[value]');const $=load(bodyOf(entry));assert.equal($('#init-data').length,1);const init=json($('#init-data').attr('value')??'');
 assert.equal(init.org?.id,'hengrui');assert.equal(String(init.siteId??init.org?.siteId),'145996');assert.equal(init.mode,'social');const iv=text(init.aesIv);assert.equal(Buffer.byteLength(iv),16);
 const declared=evidence.declaredCompleteness;assert(declared&&declared.kind==='OFFICIAL_TOTAL_COUNT'&&declared.scope==='SOURCE'&&declared.channelId===undefined,'HENGRUI_OFFICIAL_TOTAL_REQUIRED');
 assert(Number.isSafeInteger(declared.value)&&declared.value>=0);assert.equal(declared.artifactLogicalKey,'moka-page-0000');
 assert.equal(evidence.pages.length,Math.max(1,Math.ceil(declared.value/50)),'HENGRUI_MISSING_OR_EXTRA_PAGE');
 const records:HengruiReviewedRecord[]=[],seen=new Set<string>(),expectedLosses:any[]=[];let rawCount=0;
 for(const [sequence,page]of evidence.pages.entries()){
  const offset=sequence*50,key=`moka-page-${String(sequence).padStart(4,'0')}`;assert.equal(page.artifactLogicalKey,key);assert.equal(page.sequence,sequence);assert.equal(page.requestedOffset,offset);assert.equal(page.requestedPageSize,50);
  for(const k of ['channelId','requestedCursor','returnedCursor','requestedPage','returnedPage','returnedPageSize','declaredCount','declaredPages'])assert((page as any)[k]==null,'HENGRUI_UNEXPECTED_PAGE_COORDINATE:'+k);
  const a=take(key,'PAGINATION_PAGE',LIST),root=decrypt(a,iv);assert.equal(root.success,true);assert(object(root.data)&&Array.isArray(root.data.jobs),'HENGRUI_JOB_COLLECTION');
  const d=root.data,candidates:[[any,string],[any,string],[any,string]]=[[d.jobStats?.total,'$.data.jobStats.total'],[d.total,'$.data.total'],[d.count,'$.data.count']];
  const total=candidates.find(([v])=>Number.isSafeInteger(v)&&v>=0);assert(total,'HENGRUI_TOTAL_MISSING');assert.equal(total[0],declared.value,'HENGRUI_TOTAL_CHANGED');
  // Reject contradictory totals if the response supplies more than one count.
  for(const [value]of candidates)if(value!==undefined)assert.equal(value,declared.value,'HENGRUI_CONTRADICTORY_TOTAL');
  assert.equal(page.declaredTotal,declared.value);if(d.offset!==undefined)assert.equal(d.offset,offset);assert.equal(page.returnedOffset??undefined,d.offset);
  assert.equal(page.capturedAt,a.capturedAt);assert.equal(page.responseFingerprintSha256,hash(bodyOf(a)),'HENGRUI_ORIGINAL_BODY_HASH');
  const expectedLocator=contract(`moka-envelope-v1|raw:${key}|request:offset=${offset},limit=50|init:moka-entry-0000|decrypt:aes-128-cbc-v1|json:${total[1]}`,'page',LIST,{orgId:'hengrui',siteId:'145996',limit:50,offset,needStat:true,isCampusJob:false,site:'social',locale:'zh-CN'},{sequence,requestedOffset:offset,requestedPage:null,requestedPageSize:50});
  assert.equal(a.extractorLocator,expectedLocator,'HENGRUI_LIST_REQUEST_BINDING');if(sequence===0)assert.equal(declared.extractorLocator,expectedLocator);
  assert.equal(d.jobs.length,Math.min(50,declared.value-offset),'HENGRUI_PAGE_CARDINALITY');const rawIds:string[]=[],validIds:string[]=[];
  for(const [recordIndex,raw]of d.jobs.entries()){
   assert(object(raw),'HENGRUI_ROW_OBJECT');const id=idOf(raw),title=text(raw.title);assert(!containsSensitiveAdapterValue(id)&&!containsSensitiveAdapterValue(title));assert(!seen.has(id),'HENGRUI_DUPLICATE_ID');seen.add(id);rawCount++;
   const evidenceId='sha256:'+hash(JSON.stringify(id));rawIds.push(evidenceId);const rawLocator=`${key}#page-${sequence}#record-${recordIndex}#sha256:${hash(JSON.stringify(raw))}`;
   let loc=raw.locations;if(loc!==undefined){assert(Array.isArray(loc),'HENGRUI_LOCATIONS_ARRAY');loc.forEach(locationShape);}
   if(!loc?.length){
    const detailKey=`moka-detail-${String(sequence).padStart(4,'0')}-${String(recordIndex).padStart(4,'0')}`;
    const locator=contract(`moka-detail-v2|request:jobId64=${Buffer.from(id).toString('base64url')}`,'detail',DETAIL,{orgId:'hengrui',siteId:'145996',jobId:id,locale:'zh-CN'},{sequence,recordIndex});
    const detail=take(detailKey,'ATS_API_RESPONSE',DETAIL,locator),wire=json(bodyOf(detail));
    const hydrated=typeof wire.data==='string'&&typeof wire.necromancer==='string'?(()=>{const decoded=decrypt(detail,iv);assert.equal(decoded.success,true);return decoded.data;})():wire;
    assert(object(hydrated));assert.equal(idOf(hydrated),id);assert.equal(hydrated.orgId,'hengrui');assert.equal(String(hydrated.siteId),'145996');loc=hydrated.locations;
   }
   assert(Array.isArray(loc)&&loc.length>0,'HENGRUI_DETAIL_LOCATIONS_REQUIRED');loc.forEach(locationShape);
   const isHK=loc.every(hk),isUS=loc.every(waltham);
   if(isHK||isUS){
    assert(Array.isArray(raw.locations)&&raw.locations.length>0&&raw.locations.every(isHK?hk:waltham),'HENGRUI_EXCLUSION_MUST_BE_RAW');
    expectedLosses.push({stage:'VALIDATION',reason:isHK?'Hengrui record is explicitly outside mainland China scope':'Moka record is explicitly outside China scope',rawLocator,details:{code:'OUT_OF_SCOPE',pageSequence:sequence,recordIndex},recordedAt:a.capturedAt});
   }else{
    const domestic=loc.filter((v:any)=>!hk(v));assert(domestic.length>0&&domestic.every(mainland),'HENGRUI_UNPROVEN_MAINLAND');
    const cities=domestic.map((v:any)=>clean(text(v.cityName??v.provinceName??v.country)));const url=new URL(CAMPAIGN);url.hash='/job/'+encodeURIComponent(id);
    records.push({sourceJobId:evidenceId,officialTitle:clean(title),officialUrl:url.toString(),listUrl:CAMPAIGN,locationRaw:cities.join('、'),cities});validIds.push(evidenceId);
   }
  }
  sameIds(page.rawJobIds,rawIds,'HENGRUI_RAW_PAGE_IDS');sameIds(page.validJobIds,validIds,'HENGRUI_VALID_PAGE_IDS');
  const last=sequence===evidence.pages.length-1;assert.equal(page.nextPageSignalBefore??null,sequence===0?null:String(offset));assert.equal(page.nextPageSignalAfter??null,last?null:String(offset+50));
  assert.equal(page.termination,!last?'CONTINUE':declared.value===0?'EMPTY_PAGE':records.length===declared.value?'DECLARED_TOTAL_REACHED':'NEXT_ABSENT','HENGRUI_TERMINATION');
  assert.deepEqual(page.anomalyCodes,[],'HENGRUI_PAGE_ANOMALY');
 }
 assert.equal(artifactIndex,evidence.artifacts.length,'HENGRUI_UNCONSUMED_ARTIFACT');assert.equal(rawCount,declared.value);assert.equal(rawCount,seen.size);assert.equal(rawCount,records.length+expectedLosses.length);
 assert.deepEqual(evidence.fetchCounts,{rawCount,parsedCount:rawCount,validCount:records.length,parseDiscardCount:0,validationDiscardCount:expectedLosses.length},'HENGRUI_ACCOUNTING');
 assert.deepEqual(evidence.fetchLosses,expectedLosses,'HENGRUI_EXACT_EXCLUSION_LEDGER');
 for(const rows of [currentRows,nativeRows]){
  assert.equal(rows.length,records.length,'HENGRUI_OUTPUT_COUNT');const byId=new Map(rows.map(j=>[j.sourceJobId,j]));assert.equal(byId.size,rows.length,'HENGRUI_OUTPUT_DUPLICATE_ID');
  for(const raw of records){const row=byId.get(raw.sourceJobId);assert(row,'HENGRUI_OUTPUT_ID_MISSING');for(const [key,value]of Object.entries(raw))assert.deepEqual(row[key],value,'HENGRUI_OUTPUT_FIELD:'+key);assert.equal(row.sourceId,'source-hengrui-social');assert.equal(row.companyId,'company-hengrui');assert(row.officialPublishedAt==null,'HENGRUI_INVENTED_DATE');}
 }
 for(const row of nativeRows){assert.equal(row.officialPublishedAt,undefined);assert.equal(row.sourceKind,'SOCIAL');assert.equal(row.atsKind,'MOKA');assert.equal(row.officialChineseCompanyName,'江苏恒瑞医药股份有限公司');assert.equal(row.category,'其他');assert.equal(row.auxiliaryChineseTitle,undefined);assert.equal(row.evidence?.officialEntryUrl,CAMPAIGN);assert.equal(row.evidence?.officialChainEvidenceUrl,CHAIN);}
 return records;
}
