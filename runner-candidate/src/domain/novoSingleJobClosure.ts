import {createHash} from "node:crypto";
import {load} from "cheerio";
import {z} from "zod";
import {novoApplicationStatus} from "../crawler/novoChinaQuality";

/** Original Novo native identity + explicit closure only; never missing/blank/UNKNOWN. */
export const NOVO_CLOSURE_SOURCE="source-novo-nordisk-china-social";
export const NOVO_CLOSURE_COMPANY="company-novo-nordisk-china";
export const NOVO_CLOSURE_BLOCKER="JOB_SCOPE_ONLY_SOURCE_NOT_CRAWLED";
const digest=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
const requireValue=(value:unknown):void=>{if(!value)throw Error("NOVO_SINGLE_CLOSURE_EVIDENCE_INVALID");};
const iso=(value:unknown):string=>{if(value instanceof Date)return value.toISOString();const s=String(value);return new Date(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(s)?s+"Z":s).toISOString();};
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema=z.object({nativeId:z.string().regex(/^\d+\.en_GB$/),jobId:z.string().min(1),
  jobKey:z.string().regex(/^source-novo-nordisk-china-social:official-json:sha256:[a-f0-9]{64}$/),
  officialUrl:z.string().url(),previousSourceResultId:z.string().min(1),previousApplicationArtifactId:z.string().min(1)}).strict();
export const novoClosureDetailsSchema=identitySchema.extend({schemaVersion:z.literal("novo-single-job-closure-v1"),
  code:z.literal("OFFICIAL_APPLICATION_CLOSED"),recordIndex:z.literal(0),nativeUrl:z.string().url(),capturedAt:z.string().datetime().refine(s=>new Date(s).toISOString()===s),
  nativeBodySha256:sha,nativeClosureHtml:z.string().min(1),nativeClosureSha256:sha}).strict();
export type NovoClosureDetails=z.infer<typeof novoClosureDetailsSchema>;
export type NovoClosureIdentity=z.infer<typeof identitySchema>;
export interface NovoClosureRaw {requestedUrl:string;finalUrl:string;httpStatus:number;contentType:string;startedAt:string;capturedAt:string;body:string;bodySha256:string}
function validateDetails(value:unknown):NovoClosureDetails {
  const d=novoClosureDetailsSchema.parse(value),url=new URL(d.nativeUrl);
  requireValue(d.officialUrl===`https://www.novonordisk.com.cn/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad.${d.nativeId}.html`&&
    url.origin==="https://careers.novonordisk.com"&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/job\/[^/]+\/\d+\/$/.test(url.pathname)&&
    digest(d.nativeClosureHtml)===d.nativeClosureSha256&&novoApplicationStatus(d.nativeClosureHtml,d.nativeUrl,"")?.status==="CLOSED");
  return d;
}
export function buildNovoSingleClosureDetails(raw:NovoClosureRaw,identity:NovoClosureIdentity):NovoClosureDetails {
  identitySchema.parse(identity);
  requireValue(raw.requestedUrl===raw.finalUrl&&raw.httpStatus===200&&/^text\/html\b/i.test(raw.contentType)&&
    digest(raw.body)===raw.bodySha256&&Number.isFinite(Date.parse(raw.startedAt))&&raw.startedAt<=raw.capturedAt&&
    novoApplicationStatus(raw.body,raw.finalUrl,"")?.status==="CLOSED");
  const $=load(raw.body);$(".jobDisplay script,.jobDisplay style").remove();requireValue($(".jobDisplay").length===1);
  const nativeClosureHtml=$(".jobDisplay").toString();
  return validateDetails({...identity,schemaVersion:"novo-single-job-closure-v1",code:"OFFICIAL_APPLICATION_CLOSED",recordIndex:0,
    nativeUrl:raw.finalUrl,capturedAt:raw.capturedAt,nativeBodySha256:raw.bodySha256,nativeClosureHtml,nativeClosureSha256:digest(nativeClosureHtml)});
}
export interface NovoClosureArtifact {id:string;releaseCandidateId:string;batchId:string;sourceId:string;sourceResultId:string;kind:string;requestedUrl?:string|null;finalUrl?:string|null;httpStatus?:number|null;contentType?:string|null;capturedAt:Date|string;sha256:string;extractorLocator:string}
export interface NovoClosureRecord {releaseCandidateId:string;batchId:string;sourceId:string;sourceResultId:string;stage:string;reason:string;rawLocator:string;recordedAt:Date|string;details:unknown;sourceResult:{id:string;releaseCandidateId:string;batchId:string;sourceId:string;transportState:string;adapterState:string;completenessState:string;atomicCommitState:string;startedAt:Date|string;finishedAt:Date|string|null;completenessCertificate:unknown;completenessCertificateSha256:string|null;blockerCode:string|null;failureCode:string|null;failureReason:string|null;rawCount:number;parsedCount:number;validCount:number;dedupeOutputCount:number;validationDiscardCount:number;batch:{id:string;kind:string|null;status:string}}}
/** The reader receives these rows in the original snapshot's repeatable-read transaction. */
export function verifyNovoSingleClosure(record:NovoClosureRecord,artifacts:readonly NovoClosureArtifact[],now:Date):NovoClosureDetails {
  const r=record.sourceResult,d=validateDetails(record.details),locator=`novo-application-${d.nativeId}`;
  requireValue(record.sourceId===NOVO_CLOSURE_SOURCE&&record.stage==="VALIDATION"&&record.reason==="Novo official application explicitly no longer accepts applicants"&&
    record.rawLocator===`novo-single-job-${d.nativeId}`&&iso(record.recordedAt)===d.capturedAt&&
    r.id===record.sourceResultId&&r.sourceId===NOVO_CLOSURE_SOURCE&&r.batchId===record.batchId&&r.releaseCandidateId===record.releaseCandidateId&&
    r.batch.id===record.batchId&&r.batch.kind==="JOB_VERIFICATION"&&r.batch.status==="INCOMPLETE"&&
    r.transportState==="SUCCEEDED"&&r.adapterState==="SUCCEEDED"&&r.completenessState==="INCOMPLETE"&&r.atomicCommitState==="COMMITTED"&&
    r.completenessCertificate===null&&r.completenessCertificateSha256===null&&r.blockerCode===NOVO_CLOSURE_BLOCKER&&r.failureCode===null&&r.failureReason===null&&
    r.rawCount===1&&r.parsedCount===1&&r.validCount===0&&r.dedupeOutputCount===0&&r.validationDiscardCount===1&&
    Number.isFinite(Date.parse(iso(r.startedAt)))&&iso(r.startedAt)<=d.capturedAt&&r.finishedAt!==null&&
    iso(r.finishedAt)>=d.capturedAt&&Date.parse(iso(r.finishedAt))<=now.getTime());
  const current=artifacts.filter(a=>a.sourceResultId===r.id);requireValue(current.length===1);const a=current[0]!;
  requireValue(a.releaseCandidateId===r.releaseCandidateId&&a.batchId===r.batchId&&a.sourceId===NOVO_CLOSURE_SOURCE&&
    a.kind==="OFFICIAL_COMPANY_PAGE"&&a.requestedUrl===d.nativeUrl&&a.finalUrl===d.nativeUrl&&a.httpStatus===200&&
    /^text\/html\b/i.test(a.contentType??"")&&iso(a.capturedAt)===d.capturedAt&&a.sha256===d.nativeBodySha256&&a.extractorLocator===locator);
  const prior=artifacts.filter(a=>a.id===d.previousApplicationArtifactId);
  requireValue(prior.length===1&&prior[0]!.sourceId===NOVO_CLOSURE_SOURCE&&prior[0]!.sourceResultId===d.previousSourceResultId&&
    prior[0]!.kind==="OFFICIAL_COMPANY_PAGE"&&prior[0]!.finalUrl===d.nativeUrl&&prior[0]!.httpStatus===200&&
    prior[0]!.extractorLocator===locator&&Date.parse(iso(prior[0]!.capturedAt))<Date.parse(d.capturedAt));
  return d;
}
export function novoSingleClosureRemoves(job:{id:string;companyId:string;sourceId:string;sourceResultId:string;officialUrl:string;lastSeenAt:string;lastConfirmedObservedAt?:string},d:NovoClosureDetails):boolean {
  return job.id===d.jobId&&job.companyId===NOVO_CLOSURE_COMPANY&&job.sourceId===NOVO_CLOSURE_SOURCE&&job.officialUrl===d.officialUrl&&
    Date.parse(job.lastConfirmedObservedAt??job.lastSeenAt)<=Date.parse(d.capturedAt);
}
