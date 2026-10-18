import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { z } from 'zod';
import { ASTRAZENECA_DETAIL_CONFIG as CONFIG, astraZenecaFailureSchema, type AstraZenecaDetailClaim, type AstraZenecaFailure, type AstraZenecaPostedDay } from './astraZenecaDetailContract';
import { astraZenecaCity, astraZenecaListCity, astraZenecaListLocation, astraZenecaRegion, astraZenecaTitleDisagrees, assertAstraZenecaMainlandParts, isAstraZenecaChina } from './astraZenecaLocations';
import { hasUniqueJsonObjectKeys } from './strictJsonObjectKeys';
import { currentOfficialSourceAttemptSignal } from './officialHttpRuntimeLimits';
import { parseArtifactArchiveDrafts, sanitizeEvidenceHttpUrl, sha256Bytes, type SourceFetchArtifactDraft } from './sourceFetchEvidence';

export interface AstraZenecaListRow { sourceJobId:string;officialUrl:string;officialTitle:string;locationRaw:string }
const text=(s:string)=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
// Both retained official pages append this same equal-opportunity footer to the
// JSON-LD description. Only that reviewed suffix is allowed, not arbitrary text.
const EQUAL_OPPORTUNITY_FOOTER_SHA256='b1be57167cfd8583adc23eed28b0513ac20178ec5d37403f937a51bec90532c4';
function descriptionAgrees(schema:string,dom:string):boolean{
  // The official JSON-LD serializer preserves spaces removed by the DOM and
  // changes double quotes to apostrophes. Compare description content only;
  // identity, dates and geography keep their separate strict checks.
  const comparable=(value:string)=>text(value).replace(/\s/gu,'').replace(/"/gu,"'");
  const expected=comparable(load(schema).text()),actual=comparable(dom);
  return actual===expected||(actual.startsWith(expected)&&sha256Bytes(Buffer.from(actual.slice(expected.length))).sha256===EQUAL_OPPORTUNITY_FOOTER_SHA256);
}
const fail=(code:AstraZenecaFailure):never=>{throw Error(code);};
const postingSchema=z.object({
  '@context':z.enum(['http://schema.org','https://schema.org']), '@type':z.literal('JobPosting'),
  identifier:z.union([z.string().regex(/^TP\d+$/u),z.object({'@type':z.literal('PropertyValue'),name:z.literal('Job ID'),value:z.string().regex(/^TP\d+$/u)}).strict().transform(value=>value.value)]),title:z.string().min(1),url:z.string().url(),datePosted:z.string().min(1),description:z.string().min(1),
  hiringOrganization:z.object({'@type':z.literal('Organization'),name:z.string().min(1)}),
  employmentType:z.union([z.string().min(1),z.array(z.string().min(1)).min(1)]).optional(),
  occupationalCategory:z.union([z.string().min(1),z.array(z.string().min(1)).min(1)]).optional(),
  jobLocation:z.array(z.object({'@type':z.literal('Place'),address:z.object({'@type':z.literal('PostalAddress'),addressLocality:z.string(),addressRegion:z.string(),addressCountry:z.string().min(1)})})).min(1).max(100).optional()
});

export function astraZenecaPostedDay(raw:string,visible:string):AstraZenecaPostedDay{
  const parts=/^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(raw);
  const shown=/^发布日期 (\d{2})\/(\d{2})\/(\d{4})$/u.exec(text(visible));
  if(!parts||!shown) return fail('DETAIL_DATE_INVALID');
  const [year,month,day]=parts.slice(1).map(Number) as [number,number,number];
  const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(0,0,0,0);
  if(year<1000||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day||Number(shown[1])!==month||Number(shown[2])!==day||Number(shown[3])!==year)return fail('DETAIL_DATE_INVALID');
  return {raw,calendarDay:date.toISOString().slice(0,10),precision:'DAY',canonicalSortEncoding:date.toISOString()};
}
export function isAstraZenecaDetailUrl(input:string,id:string):boolean{
  try{const u=new URL(input);return u.href===input&&u.origin==='https://job-search.astrazeneca.cn'&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\d+$/u.test(id)&&new RegExp(`/12977/${id}$`,'u').test(u.pathname)&&/^\/[^/]+\/[^/]+\/[^/]+\/12977\/\d+$/u.test(u.pathname);}
  catch{return false;}
}
function visible($:CheerioAPI,node:AnyNode):boolean{
  return !$(node).parents().addBack().toArray().some(el=>{
    const e=$(el);return e.is('[hidden],[aria-hidden="true"],.hidden')||/(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(e.attr('style')??'');
  });
}
function oneVisible($:CheerioAPI,selector:string):ReturnType<CheerioAPI>{
  const matches=$(selector);if(matches.length!==1||!visible($,matches.get(0)!))return fail('DETAIL_IDENTITY_INVALID');return matches;
}
function fieldText($:CheerioAPI,node:AnyNode):string{
  const copy=$(node).clone();copy.find('[hidden],[aria-hidden="true"],.hidden,script,style,template,noscript').remove();
  copy.find('[style]').each((_i,el)=>{if(/(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test($(el).attr('style')??''))$(el).remove();});
  return text(copy.text());
}
function isAstraZenecaBotDocument($:CheerioAPI):boolean{
  return /access denied|just a moment|verify (?:you are|you're) human|robot check/iu.test($('title').text())||
    $('#challenge-form,.g-recaptcha,[data-sitekey]').length>0||($('section.job-description').length===0&&/captcha|cloudflare challenge/iu.test($('body').text()));
}
export function isAstraZenecaBotBody(body:string):boolean{return isAstraZenecaBotDocument(load(body));}
/** Strict source-local JSON-LD parsing. Never evaluates downloaded scripts. */
export function parseAstraZenecaDetail(body:string,row:AstraZenecaListRow,applicationArtifact?:SourceFetchArtifactDraft):AstraZenecaDetailClaim{
  if(!isAstraZenecaDetailUrl(row.officialUrl,row.sourceJobId))return fail('DETAIL_URL_INVALID');
  if(Buffer.byteLength(body,'utf8')>CONFIG.maxBodyBytes)return fail('DETAIL_BODY_TOO_LARGE');
  const $=load(body);if(isAstraZenecaBotDocument($))return fail('DETAIL_BOT_BLOCKED');
  return parseAstraZenecaDetailDocument(body,row,$,applicationArtifact);
}
function parseAstraZenecaDetailDocument(body:string,row:AstraZenecaListRow,$:CheerioAPI,applicationArtifact?:SourceFetchArtifactDraft):AstraZenecaDetailClaim{
  const postings:unknown[]=[];
  for(const script of $('script[type="application/ld+json"]').toArray()){
    // Like Sanofi, escape literal tabs inside JSON-LD strings without changing their values.
    // Preserve invalid backslash-TAB escapes so malformed JSON still fails closed.
    const raw=$(script).text().replace(/"(?:[^"\\]|\\.)*"/gu,token=>token.replace(/(\\*)\t/gu,(tab,slashes:string)=>slashes.length%2?tab:slashes+'\\t'));if(!hasUniqueJsonObjectKeys(raw))return fail('DETAIL_PARSE_INVALID');
    let value:unknown;try{value=JSON.parse(raw);}catch{return fail('DETAIL_PARSE_INVALID');}
    if(value&&typeof value==='object'&&!Array.isArray(value)&&'@type' in value&&value['@type']==='JobPosting')postings.push(value);
  }
  if(postings.length!==1)return fail('DETAIL_PARSE_INVALID');
  const parsed=postingSchema.safeParse(postings[0]);if(!parsed.success)return fail('DETAIL_PARSE_INVALID');const posting=parsed.data;
  const canonical=$('link[rel="canonical"]'),req=$('meta[name="job-ats-req-id"]');
  const title=oneVisible($,'section.job-description-title'),detail=oneVisible($,'section.job-description');
  const h1=oneVisible($,'section.job-description-title h1');
  const reqVisible=detail.find('.job-id').filter((_i,el)=>{const b=$(el).find('b').first().get(0);return b!==undefined&&fieldText($,b)==='职位 ID';});
  const apply=detail.find('a.job-apply'),description=detail.find('.ats-description');
  if(canonical.length!==1||canonical.attr('href')!==row.officialUrl||posting.url!==row.officialUrl||
    title.attr('data-job-id')!==row.sourceJobId||detail.attr('data-job-id')!==row.sourceJobId||
    title.attr('data-org-id')!=='12977'||detail.attr('data-org-id')!=='12977'||
    fieldText($,h1.get(0)!)!==row.officialTitle||text(posting.title)!==row.officialTitle||
    req.length!==1||req.attr('content')!==posting.identifier||reqVisible.length!==1||!visible($,reqVisible.get(0)!)||fieldText($,reqVisible.get(0)!)!==`职位 ID ${posting.identifier}`||
    apply.length===0||apply.toArray().some(el=>$(el).attr('data-job-id')!==row.sourceJobId||!visible($,el))||
    description.length!==1||!visible($,description.get(0)!)||!text(description.text())||
    !descriptionAgrees(posting.description,fieldText($,description.get(0)!))||posting.hiringOrganization.name.toLowerCase()!=='astrazeneca')return fail('DETAIL_IDENTITY_INVALID');
  const applicationUrls=apply.toArray().map(el=>$(el).attr('href')??'');
  if(new Set(applicationUrls).size!==1||!isAstraZenecaApplicationUrl(applicationUrls[0]!))return fail('DETAIL_APPLICATION_INVALID');
  const dom=detail.find('.job-locations');
  if(dom.length!==(posting.jobLocation?.length??1)||dom.toArray().some(el=>!visible($,el)))return fail('DETAIL_LOCATION_INVALID');
  let locationConflict=false;
  const locations:AstraZenecaDetailClaim['locations']=(posting.jobLocation??[]).map(({address},i)=>{
    const raw={city:address.addressLocality,region:address.addressRegion,country:address.addressCountry};
    const visibleRaw=fieldText($,dom.get(i)!);const parts=visibleRaw.split(',').map(text);
    const [city,region,country]=parts.length===1?['','',parts[0]!]:parts;
    if(!isAstraZenecaChina(raw.country)||!country||!isAstraZenecaChina(country))return fail('DETAIL_COUNTRY_INVALID');
    if(parts.length!==1&&parts.length!==3)return fail('DETAIL_LOCATION_INVALID');
    assertAstraZenecaMainlandParts(raw.city,raw.region);assertAstraZenecaMainlandParts(city??'',region??'');
    const normalized=astraZenecaCity(raw.city,raw.region),domCity=astraZenecaCity(city??'',region??'');
    const conflict=normalized!==domCity||(!normalized&&(text(raw.city)!==city||astraZenecaRegion(raw.region)!==astraZenecaRegion(region??'')));
    locationConflict ||= conflict;
    return {visibleRaw,schemaRaw:raw,...(conflict?{conflict:true as const}:normalized?{city:normalized}:{})};
  });
  let application:AstraZenecaDetailClaim['application'];
  if(!posting.jobLocation){
    if(!isAstraZenecaChina(row.locationRaw)||!isAstraZenecaChina(fieldText($,dom.get(0)!)))return fail('DETAIL_LOCATION_INVALID');
    if(!applicationArtifact)return fail('DETAIL_APPLICATION_REQUIRED');
    application=reviewAstraZenecaCountryApplication(applicationArtifact,row,applicationUrls[0]!,posting.description);
    locations.push({visibleRaw:fieldText($,dom.get(0)!)});
  }else if(applicationArtifact)return fail('DETAIL_APPLICATION_INVALID');
  const identities=locations.map(l=>l.city??JSON.stringify(l.schemaRaw));
  if(new Set(identities).size!==identities.length)return fail('DETAIL_LOCATION_INVALID');
  const known=locations.flatMap(l=>l.city?[l.city]:[]);
  const listCity=astraZenecaListCity(row.locationRaw);
  if(listCity&&!known.includes(listCity))locationConflict=true;
  const listLocation=astraZenecaListLocation(row.locationRaw);
  if(listLocation&&!listCity&&!locations.some(l=>l.schemaRaw?.city===listLocation.city&&astraZenecaRegion(l.schemaRaw.region)===astraZenecaRegion(listLocation.region)))locationConflict=true;
  const pending=locationConflict||known.length!==locations.length||astraZenecaTitleDisagrees(row.officialTitle,known)||
    (listCity!==undefined&&astraZenecaTitleDisagrees(row.officialTitle,[listCity]));
  const dates=detail.find('.job-date');if(dates.length!==1||!visible($,dates.get(0)!))return fail('DETAIL_DATE_INVALID');
  const visibleDate=fieldText($,dates.get(0)!);
  let postedDay:AstraZenecaPostedDay|undefined,dateConflict:AstraZenecaDetailClaim['dateConflict'];
  try{postedDay=astraZenecaPostedDay(posting.datePosted,visibleDate);}
  catch{
    const raw=/^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(posting.datePosted),shown=/^发布日期 (\d{2})\/(\d{2})\/(\d{4})$/u.exec(visibleDate);
    if(!raw||!shown)return fail('DETAIL_DATE_INVALID');
    astraZenecaPostedDay(posting.datePosted,`发布日期 ${raw[2]!.padStart(2,'0')}/${raw[3]!.padStart(2,'0')}/${raw[1]}`);
    astraZenecaPostedDay(`${shown[3]}-${shown[1]}-${shown[2]}`,visibleDate);
    dateConflict={status:'UNKNOWN',schemaRaw:posting.datePosted,visibleRaw:visibleDate};
  }
  const scopeReviewCodes:AstraZenecaDetailClaim['scopeReviewCodes']=[];
  const earlyCareer = /\bintern(?:ship)?\b|实习|校园|校招|应届|毕业生|管培生|graduate[ -]*(?:program(?:me)?|trainee)|early[ -]*career/iu;
  if(earlyCareer.test(row.officialTitle))scopeReviewCodes.push('TITLE_EARLY_CAREER');
  if([posting.employmentType].flat().some(v=>v&&/\bintern(?:ship)?\b|实习|校园|graduate/iu.test(v)))scopeReviewCodes.push('EMPLOYMENT_INTERNSHIP');
  if([posting.occupationalCategory].flat().some(v=>v&&earlyCareer.test(v)))scopeReviewCodes.push('CATEGORY_EARLY_CAREER');
  return {sourceJobId:row.sourceJobId,requisitionId:posting.identifier,officialUrl:row.officialUrl,officialTitle:row.officialTitle,
    bodySha256:sha256Bytes(Buffer.from(body,'utf8')).sha256,locations,cities:pending?[CONFIG.pendingCity]:known,
    locationStatus:pending?'CITY_PENDING':'CITY_SPECIFIC',...(postedDay?{postedDay}:{dateConflict}),...(application?{application}:{}),scopeReviewCodes,
    ...(posting.employmentType?{employmentTypeRaw:posting.employmentType}:{}),
    ...(posting.occupationalCategory?{occupationalCategoryRaw:posting.occupationalCategory}:{})};
}
export function isAstraZenecaApplicationUrl(value:string):boolean{
  try{const u=new URL(value);return u.href===value&&u.origin==='https://careersite.tupu360.com'&&u.pathname==='/astrazeneca/position/detail'&&!u.username&&!u.password&&!u.hash&&[...u.searchParams.keys()].join(',')==='positionId'&&/^[a-zA-Z0-9_-]{1,128}$/u.test(u.searchParams.get('positionId')??'');}catch{return false;}
}
export function astraZenecaApplicationKey(id:string):string{return `astrazeneca-application-${id}`;}
function reviewAstraZenecaCountryApplication(a:SourceFetchArtifactDraft,row:AstraZenecaListRow,url:string,description:string):NonNullable<AstraZenecaDetailClaim['application']>{
  parseArtifactArchiveDrafts({captureTool:{name:CONFIG.extractor,version:'1'},artifacts:[a]});
  if(a.httpStatus===403||a.httpStatus===429)return fail('DETAIL_BOT_BLOCKED');
  if(a.id!==astraZenecaApplicationKey(row.sourceJobId)||a.logicalKey!==a.id||a.kind!=='ATS_PAGE'||![url,sanitizeEvidenceHttpUrl(url)].includes(a.requestedUrl??'')||a.finalUrl!==a.requestedUrl||a.channelId!==undefined||a.bodyRepresentation!=='EXACT'||a.rawBodySha256||a.redactionDescriptors||a.extractorLocator!==CONFIG.extractor||!(a.body instanceof Uint8Array)||a.body.byteLength>CONFIG.maxBodyBytes||a.httpStatus!==200||!(/^(?:text\/html|application\/octet-stream)(?:\s*;[^\r\n]*)?$/iu.test(a.contentType??'')))return fail('DETAIL_APPLICATION_INVALID');
  const body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(a.body),$=load(body);if(isAstraZenecaBotDocument($))return fail('DETAIL_BOT_BLOCKED');
  const positionId=new URL(url).searchParams.get('positionId')!;
  for(const [id,value] of [['positionId',positionId],['positionName',row.officialTitle],['positionStatus','PUBLISHING'],['recruitmentType','SOCIALRECRUITMENT']])if($(`#${id}`).length!==1||text($(`#${id}`).attr('value')??'')!==value)return fail('DETAIL_APPLICATION_INVALID');
  for(const [selector,value] of [['.position-header h4.name',row.officialTitle],['.position-extend .city','全国']]){const node=$(selector);if(node.length!==1||!visible($,node.get(0)!)||fieldText($,node.get(0)!)!==value)return fail('DETAIL_APPLICATION_INVALID');}
  const content=$('.position-description');if(content.length!==1||!visible($,content.get(0)!)||!descriptionAgrees(description,fieldText($,content.get(0)!)))return fail('DETAIL_APPLICATION_INVALID');
  return {artifactLogicalKey:a.logicalKey,bodySha256:sha256Bytes(a.body).sha256,officialUrl:url,positionId,locationRaw:'全国'};
}
export type AstraZenecaDetailCapture = ({ok:true;artifact:SourceFetchArtifactDraft;evidence:AstraZenecaDetailClaim}|{ok:false;code:AstraZenecaFailure;artifact?:SourceFetchArtifactDraft})&{applicationArtifact?:SourceFetchArtifactDraft};
export function astraZenecaArtifactKey(id:string):string{return `astrazeneca-detail-${id}`;}
export function reviewAstraZenecaDetailArtifact(artifact:SourceFetchArtifactDraft,row:AstraZenecaListRow,applicationArtifact?:SourceFetchArtifactDraft):AstraZenecaDetailCapture{
  parseArtifactArchiveDrafts({captureTool:{name:CONFIG.extractor,version:'1'},artifacts:[artifact]});
  if(artifact.kind!=='ATS_PAGE'||artifact.logicalKey!==astraZenecaArtifactKey(row.sourceJobId)||artifact.id!==artifact.logicalKey||artifact.requestedUrl!==row.officialUrl||artifact.finalUrl!==row.officialUrl||!isAstraZenecaDetailUrl(row.officialUrl,row.sourceJobId)||artifact.channelId!==undefined||artifact.bodyRepresentation!=='EXACT'||artifact.rawBodySha256||artifact.redactionDescriptors||artifact.extractorLocator!==CONFIG.extractor||!(artifact.body instanceof Uint8Array)||artifact.body.byteLength>CONFIG.maxBodyBytes)throw Error('ASTRAZENECA_DETAIL_ARTIFACT_INVALID');
  if(artifact.httpStatus===403||artifact.httpStatus===429)return {ok:false,code:'DETAIL_BOT_BLOCKED',artifact};
  let body:string;try{body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(artifact.body);}catch{return {ok:false,code:'DETAIL_PARSE_INVALID',artifact};}
  const $=load(body);if(isAstraZenecaBotDocument($))return {ok:false,code:'DETAIL_BOT_BLOCKED',artifact};
  if(artifact.httpStatus!==200||!/^text\/html(?:\s*;[^\r\n]*)?$/iu.test(artifact.contentType??''))return {ok:false,code:'DETAIL_RESPONSE_INVALID',artifact};
  try{return {ok:true,artifact,...(applicationArtifact?{applicationArtifact}:{}),evidence:parseAstraZenecaDetailDocument(body,row,$,applicationArtifact)};}
  catch(error){const code=astraZenecaFailureSchema.safeParse(error instanceof Error?error.message:'');return {ok:false,code:code.success?code.data:'DETAIL_PARSE_INVALID',artifact,...(applicationArtifact?{applicationArtifact}:{})};}
}
/** Byte cap and cancellation cover the complete response body, not just headers.
 * Test-only transport injection is never exposed by the owned source constructor. */
type AstraZenecaFetchDeps={fetchImpl?:typeof fetch;signal?:AbortSignal;now?:()=>Date;onBotBlock?:()=>void};
export async function fetchAstraZenecaDetail(row:AstraZenecaListRow,deps:AstraZenecaFetchDeps={}):Promise<AstraZenecaDetailCapture>{
  if(!isAstraZenecaDetailUrl(row.officialUrl,row.sourceJobId))return {ok:false,code:'DETAIL_URL_INVALID'};
  const first=await fetchAstraZenecaPage(row.officialUrl,astraZenecaArtifactKey(row.sourceJobId),deps);
  if(!first.ok)return first;
  const reviewed=reviewAstraZenecaDetailArtifact(first.artifact,row);
  if(reviewed.ok||reviewed.code!=='DETAIL_APPLICATION_REQUIRED')return reviewed;
  const $=load(Buffer.from(first.artifact.body as Uint8Array).toString('utf8'));
  const url=$('section.job-description a.job-apply').first().attr('href')!;
  const application=await fetchAstraZenecaPage(url,astraZenecaApplicationKey(row.sourceJobId),deps);
  if(!application.ok)return {...application,artifact:first.artifact};
  return reviewAstraZenecaDetailArtifact(first.artifact,row,application.artifact);
}
async function fetchAstraZenecaPage(url:string,key:string,deps:AstraZenecaFetchDeps):Promise<{ok:true;artifact:SourceFetchArtifactDraft}|{ok:false;code:AstraZenecaFailure}>{
  const source=currentOfficialSourceAttemptSignal(),deadline=AbortSignal.timeout(CONFIG.httpTimeoutMs);
  const signal=AbortSignal.any([deadline,...(source?[source]:[]),...(deps.signal?[deps.signal]:[])]);
  let blockedStatus=false;
  try{
    signal.throwIfAborted();
    const response=await (deps.fetchImpl??fetch)(url,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'text/html'},signal});
    blockedStatus=response.status===403||response.status===429;if(blockedStatus)deps.onBotBlock?.();
    if(response.url!==url||!response.body){await response.body?.cancel();return {ok:false,code:blockedStatus?'DETAIL_BOT_BLOCKED':'DETAIL_RESPONSE_INVALID'};}
    const length=response.headers.get('content-length');
    if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>CONFIG.maxBodyBytes)){await response.body.cancel();return {ok:false,code:blockedStatus?'DETAIL_BOT_BLOCKED':'DETAIL_BODY_TOO_LARGE'};}
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    const aborted=()=>{void reader.cancel().catch(()=>undefined);};signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();
    try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.byteLength;if(size>CONFIG.maxBodyBytes){await reader.cancel();return {ok:false,code:blockedStatus?'DETAIL_BOT_BLOCKED':'DETAIL_BODY_TOO_LARGE'};}chunks.push(value);}}
    finally{signal.removeEventListener('abort',aborted);reader.releaseLock();}
    const artifact:SourceFetchArtifactDraft={id:key,logicalKey:key,kind:'ATS_PAGE',requestedUrl:url,finalUrl:response.url,httpStatus:response.status,contentType:response.headers.get('content-type')??'application/octet-stream',capturedAt:(deps.now??(()=>new Date()))().toISOString(),body:Buffer.concat(chunks,size),bodyRepresentation:'EXACT',extractorLocator:CONFIG.extractor};
    return {ok:true,artifact};
  }catch{return {ok:false,code:blockedStatus?'DETAIL_BOT_BLOCKED':signal.aborted?'DETAIL_CANCELLED':'DETAIL_TRANSPORT_FAILED'};}
}
