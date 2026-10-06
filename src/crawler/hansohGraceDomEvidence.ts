import { createHash } from "node:crypto";
import { load } from "cheerio";
import { z } from "zod";
import { buildJobDedupeKey, type NormalizedJobRecord } from "./normalizedJob";
import { applyCrawlObservation, type JobSnapshot } from "./lifecycle";
import { persistentOfficialJsonJobId } from "./officialJsonEvidence";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import type { PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";

export const HANSOH_GRACE_DOM_KEY = "hansoh-grace-dom-v1";
export const HANSOH_GRACE_DOM_LOCATOR = "hansoh-grace-dom-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP";
const sha=z.string().regex(/^[a-f0-9]{64}$/u),id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),iso=z.string().datetime();
export const hansohGraceBindingSchema=z.object({releaseCandidateId:id,batchId:id,sourceResultId:id,sourceId:z.literal("source-hansoh-social"),sourceConfigSha256:sha,adapterVersion:sha}).strict();
const targetSchema=z.object({dedupeKey:z.string().min(1),sourceJobId:z.string().min(1),officialUrl:z.string().url(),officialTitle:z.string().min(1),locationRaw:z.string().min(1)}).strict();
export const hansohGraceRequestSchema=z.object({schemaVersion:z.literal(1),kind:z.literal("HANSOH_GRACE_FRESH_DOM_REQUEST"),nonce:z.string().uuid(),binding:hansohGraceBindingSchema,companyId:z.literal("company-hansoh"),contextSha256:sha,listEvidenceSha256:sha,requestedAt:iso,deadlineAt:iso,targets:z.array(targetSchema).min(1).max(1000)}).strict();
export const hansohGraceResponseSchema=z.object({schemaVersion:z.literal(1),kind:z.literal("BROWSER_UI_DOM_OBSERVATION_NOT_HTTP"),captureTool:z.object({name:z.literal("dot-cloud-browser-dom"),version:z.literal("1")}).strict(),requestSha256:sha,captures:z.array(z.object({requestedUrl:z.string().url(),finalUrl:z.string().url(),capturedAt:iso,documentHtml:z.string().min(1).max(4_000_000),documentHtmlSha256:sha}).strict()).min(1).max(1000)}).strict();
const envelopeSchema=z.object({request:hansohGraceRequestSchema,response:hansohGraceResponseSchema}).strict();
export type HansohGraceRequest=z.infer<typeof hansohGraceRequestSchema>;
export type HansohGraceBinding=z.infer<typeof hansohGraceBindingSchema>;
export interface HansohGracePreviousContext {previousJobs:readonly JobSnapshot[];visibilityFloor:string|null}
export function hansohGraceDigest(value:unknown):string {
  const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical).join(",")}]`:v&&typeof v==="object"?`{${Object.entries(v).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`:JSON.stringify(v);
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export const hansohDomHash=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
export function hansohGraceContextHash(context:HansohGracePreviousContext):string {
  return hansohGraceDigest({...context,previousJobs:[...context.previousJobs].sort((a,b)=>a.dedupeKey.localeCompare(b.dedupeKey,"en"))});
}
export function hansohGraceTargets(context:HansohGracePreviousContext,current:readonly NormalizedJobRecord[]):z.infer<typeof targetSchema>[] {
  // Reuse the ordinary lifecycle validator, including duplicate and timestamp checks.
  if(context.previousJobs.length)applyCrawlObservation(context.previousJobs,[],{observation:{disposition:"UNAUDITED",atomicCommitEligible:false},observedAt:context.previousJobs.map(j=>j.lastSeenAt).sort().at(-1)!,baselineCompletedBeforeCrawl:true});
  const floor=context.visibilityFloor===null?null:Date.parse(context.visibilityFloor);
  if(floor!==null&&(!Number.isFinite(floor)||new Date(floor).toISOString()!==context.visibilityFloor))throw Error("HANSOH_GRACE_FLOOR_INVALID");
  const keys=new Set(current.map(buildJobDedupeKey));
  return context.previousJobs.filter(j=>j.lifecycleStatus==="ACTIVE"&&j.missingSuccessfulCrawlCount===1&&!keys.has(j.dedupeKey)&&floor!==null&&Date.parse(j.lastSeenAt)>=floor)
    .map(j=>{
      if(j.record.sourceId!=="source-hansoh-social"||j.record.companyId!=="company-hansoh")throw Error("HANSOH_GRACE_PRIOR_SOURCE_MISMATCH");
      const target=targetSchema.parse({dedupeKey:j.dedupeKey,sourceJobId:j.record.sourceJobId,officialUrl:j.record.officialUrl,officialTitle:j.record.officialTitle,locationRaw:j.record.locationRaw});
      assertTargetIdentity(target);return target;
    }).sort((a,b)=>a.dedupeKey.localeCompare(b.dedupeKey,"en"));
}
function assertTargetIdentity(target:z.infer<typeof targetSchema>){
  const match=/^https:\/\/hspharm\.zhiye\.com\/social\/detail\?jobAdId=([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.exec(target.officialUrl);
  if(!match||persistentOfficialJsonJobId(match[1]!)!==target.sourceJobId)throw Error("HANSOH_GRACE_ID_URL_MISMATCH");
}
/** Parse full native DOM. An Apply control alone is never positive presence. */
export function assertHansohSubstantiveDom(html:string,target:z.infer<typeof targetSchema>):void {
  assertTargetIdentity(target);
  const $=load(html),clean=(s:string)=>s.replace(/\s+/gu," ").trim();
  if($("script[type='application/ld+json']").length)throw Error("HANSOH_GRACE_UNREVIEWED_STRUCTURED_DETAIL");
  const globals=$("script").toArray().map(n=>$(n).text().trim()).filter(s=>/^var\s+BSGlobal\s*=/u.test(s));
  if(globals.length!==1)throw Error("HANSOH_GRACE_COMPANY_UNPROVEN");
  const match=/^var\s+BSGlobal\s*=\s*([\s\S]+);\s*$/u.exec(globals[0]!);
  if(!match||!hasUniqueJsonObjectKeys(match[1]!))throw Error("HANSOH_GRACE_COMPANY_UNPROVEN");
  const tenant=JSON.parse(match[1]!).tenantInfo;
  if(tenant?.Id!==604317||tenant.Name!=="hspharm"||tenant.Domain!=="hspharm"||tenant.Abbreviation!=="豪森"||tenant.Alias!=="江苏豪森药业集团有限公司"||clean($("title").text())!=="豪森")throw Error("HANSOH_GRACE_COMPANY_MISMATCH");
  $("script,style,noscript,template,[hidden],[aria-hidden='true']").remove();
  $("[style]").filter((_,n)=>/(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;\s]|$))/iu.test($(n).attr("style")??"")).remove();
  const text=clean($("body").text());
  if(/职位(?:已|已经)?(?:关闭|下线|失效|结束|暂停|过期|撤销|取消|招满|下架)|岗位(?:已|已经)?(?:关闭|下线|失效|过期|撤销|取消|招满|下架)|招聘(?:已|已经)?(?:结束|停止|截止)|停止招聘|该职位不存在|职位不存在|页面不存在|页面未找到|无权访问|访问受限|404\s*(?:Not Found|错误)|position (?:is )?(?:closed|no longer available)|job (?:is )?no longer available|no longer accepting applications|not accepting applications|(?:job|position) (?:has )?(?:expired|(?:been )?filled)/iu.test(text))throw Error("HANSOH_GRACE_CLOSED_OR_UNAVAILABLE_CONFLICT");
  const title=$("[class*='STJobNameLeft-editor']"),info=$("[class*='STJobInfoLeft-editor']");
  if(title.length!==1||clean(title.text())!==clean(target.officialTitle)||!/[（(]J\d+[)）]$/u.test(clean(title.text()))||info.length!==1)throw Error("HANSOH_GRACE_DETAIL_IDENTITY_UNPROVEN");
  const tags=info.find("[class*='STJobTabInner-editor']").toArray().map(n=>clean($(n).text()));
  if(!tags.includes("社会招聘")||!tags.includes(clean(target.locationRaw))||tags.includes("校园招聘"))throw Error("HANSOH_GRACE_DETAIL_SCOPE_UNPROVEN");
  const apply=$("[class*='STDeliverBtn-editor']"),disabled="[disabled],[aria-disabled='true'],[class*='disabled']";
  if(apply.is(disabled)||apply.find(disabled).length)throw Error("HANSOH_GRACE_APPLY_UNAVAILABLE_CONFLICT");
  const sections=$("[class*='STDutyContainer-editor']");
  if(sections.length!==2)throw Error("HANSOH_GRACE_SUBSTANTIVE_DETAIL_REQUIRED");
  const found=new Set<string>();
  sections.each((_,n)=>{const section=$(n),heading=clean(section.find("[class*='STDutyTitle-editor']").text()),body=clean(section.find("[class*='STDutyContent-editor']").text());
    if(!["工作职责","任职资格"].includes(heading)||found.has(heading)||body.length<40||!/\p{Script=Han}/u.test(body))throw Error("HANSOH_GRACE_SUBSTANTIVE_DETAIL_REQUIRED");found.add(heading);
  });
}
export function hansohListEvidence(evidence:PersistentSourceFetchEvidence):PersistentSourceFetchEvidence {
  const pageKeys=new Set(evidence.pages.map(p=>p.artifactLogicalKey));
  return {...evidence,artifacts:evidence.artifacts.filter(a=>pageKeys.has(a.logicalKey))};
}
/** Extra artifacts have no authority unless replayed here. No HTTP status is invented. */
export function replayHansohGraceDom(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence,current:readonly NormalizedJobRecord[],expectedBinding?:HansohGraceBinding,context?:HansohGracePreviousContext):Set<string>{
  const pageKeys=new Set(evidence.pages.map(p=>p.artifactLogicalKey)),extra=evidence.artifacts.filter(a=>!pageKeys.has(a.logicalKey));
  if(!extra.length){if(context&&hansohGraceTargets(context,current).length)throw Error("HANSOH_GRACE_FRESH_DOM_REQUIRED");return new Set();}
  if(plan.source.id!=="source-hansoh-social"||plan.company.id!=="company-hansoh"||extra.length!==1)throw Error("HANSOH_GRACE_UNKNOWN_ARTIFACT");
  const a=extra[0]!;
  if(a.logicalKey!==HANSOH_GRACE_DOM_KEY||a.kind!=="COMMAND_OUTPUT"||a.extractorLocator!==HANSOH_GRACE_DOM_LOCATOR||a.bodyRepresentation!=="EXACT"||typeof a.body!=="string"||[a.requestedUrl,a.finalUrl,a.httpStatus,a.contentType,a.channelId,a.rawBodySha256,a.redactionDescriptors].some(v=>v!==undefined)||!hasUniqueJsonObjectKeys(a.body))throw Error("HANSOH_GRACE_ARTIFACT_INVALID");
  const {request:r,response:s}=envelopeSchema.parse(JSON.parse(a.body));
  if(r.binding.sourceConfigSha256!==sourcePlanConfigSha256(plan)||s.requestSha256!==hansohGraceDigest(r)||r.listEvidenceSha256!==hansohGraceDigest(hansohListEvidence(evidence))||expectedBinding&&hansohGraceDigest(r.binding)!==hansohGraceDigest(expectedBinding))throw Error("HANSOH_GRACE_BINDING_MISMATCH");
  const start=Date.parse(r.requestedAt),deadline=Date.parse(r.deadlineAt),times=s.captures.map(c=>Date.parse(c.capturedAt));
  if(deadline<=start||deadline-start>20*60_000||evidence.pages.some(p=>Date.parse(p.capturedAt)>start)||times.some(t=>t<start||t>deadline)||a.capturedAt!==new Date(Math.max(...times)).toISOString())throw Error("HANSOH_GRACE_CAPTURE_TIME_INVALID");
  if(context&&(r.contextSha256!==hansohGraceContextHash(context)||hansohGraceDigest(r.targets)!==hansohGraceDigest(hansohGraceTargets(context,current))))throw Error("HANSOH_GRACE_CONTEXT_DRIFT");
  const keys=new Set<string>(),urls=new Set<string>(),currentKeys=new Set(current.map(buildJobDedupeKey));
  if(s.captures.length!==r.targets.length)throw Error("HANSOH_GRACE_CAPTURE_SET_MISMATCH");
  for(let i=0;i<r.targets.length;i++){
    const t=r.targets[i]!,c=s.captures[i]!;
    if(keys.has(t.dedupeKey)||urls.has(t.officialUrl)||currentKeys.has(t.dedupeKey)||c.requestedUrl!==t.officialUrl||c.finalUrl!==t.officialUrl||hansohDomHash(c.documentHtml)!==c.documentHtmlSha256)throw Error("HANSOH_GRACE_CAPTURE_IDENTITY_MISMATCH");
    assertHansohSubstantiveDom(c.documentHtml,t);keys.add(t.dedupeKey);urls.add(t.officialUrl);
  }
  return keys;
}
