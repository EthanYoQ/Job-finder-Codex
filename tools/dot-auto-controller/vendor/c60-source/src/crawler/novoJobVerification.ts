import {buildNovoSingleClosureDetails,NOVO_CLOSURE_SOURCE,type NovoClosureRaw,type NovoClosureIdentity} from "../domain/novoSingleJobClosure";
import {archiveSourceEvidence,verifyArchivedSourceEvidence,assertVerifiedArchivedEvidenceMetadata,type ArchivedEvidenceArtifact} from "./artifactArchive";
import {bindRuntimeEvidenceArtifactIds} from "./runtimeAtomicEvidence";
export interface NovoVerificationCapture {raw:NovoClosureRaw;identity:NovoClosureIdentity;artifact:ArchivedEvidenceArtifact;evidenceSubdirectory:string}
/** Archive the original captured page once; this does not read or write a database. */
export async function archiveNovoJobVerification(input:{workspaceRoot:string;evidenceSubdirectory:string;releaseCandidateId:string;batchId:string;sourceResultId:string;raw:NovoClosureRaw;identity:NovoClosureIdentity}):Promise<NovoVerificationCapture>{
  buildNovoSingleClosureDetails(input.raw,input.identity);
  const tuple={releaseCandidateId:input.releaseCandidateId,batchId:input.batchId,sourceResultId:input.sourceResultId,sourceId:NOVO_CLOSURE_SOURCE};
  const artifacts=novoVerificationDrafts(tuple,input.raw,input.identity);
  const archived=await archiveSourceEvidence({...tuple,workspaceRoot:input.workspaceRoot,evidenceSubdirectory:input.evidenceSubdirectory,
    captureTool:{name:"novo-native-job-verification",version:"1"},artifacts});
  const checked=await verifyArchivedSourceEvidence({...tuple,workspaceRoot:input.workspaceRoot,evidenceSubdirectory:input.evidenceSubdirectory,artifacts:archived.artifacts});
  return {raw:input.raw,identity:input.identity,artifact:checked[0]!,evidenceSubdirectory:input.evidenceSubdirectory};
}
function novoVerificationDrafts(tuple:{releaseCandidateId:string;batchId:string;sourceResultId:string;sourceId:string},raw:NovoClosureRaw,identity:NovoClosureIdentity){
  const locator=`novo-application-${identity.nativeId}`;
  return bindRuntimeEvidenceArtifactIds({...tuple,artifacts:[{id:locator,logicalKey:locator,kind:"OFFICIAL_COMPANY_PAGE",requestedUrl:raw.requestedUrl,
    finalUrl:raw.finalUrl,httpStatus:raw.httpStatus,contentType:raw.contentType,capturedAt:raw.capturedAt,body:raw.body,bodyRepresentation:"EXACT",extractorLocator:locator}]});
}
export function assertNovoVerificationArchive(tuple:{releaseCandidateId:string;batchId:string;sourceResultId:string;sourceId:string},capture:NovoVerificationCapture):void {
  buildNovoSingleClosureDetails(capture.raw,capture.identity);
  assertVerifiedArchivedEvidenceMetadata({...tuple,evidenceSubdirectory:capture.evidenceSubdirectory,artifacts:[capture.artifact]},novoVerificationDrafts(tuple,capture.raw,capture.identity));
}

import {createHash} from "node:crypto";
import {isJobProjectionDeltaReceipt,parseJobProjectionDeltaReceipt} from "../domain/jobProjectionDeltaReceipt";
import {novoApplicationStatus} from "./novoChinaQuality";
import {NOVO_CLOSURE_COMPANY,type NovoClosureArtifact} from "../domain/novoSingleJobClosure";
export interface NovoPublishedVerificationJob {id:string;companyId:string;sourceId:string;sourceResultId:string;officialUrl:string;lastSeenAt:string;lastConfirmedObservedAt?:string;inGrace:boolean}
export interface NovoVerificationTarget {identity:NovoClosureIdentity;nativeUrl:string;nativeCity:string}
/** Input must come from the existing verified portable reader, never Job.visible alone.
 * A delta GRACE member binds its last actual CURRENT receipt, not its newer missing observation. */
export function planNovoPublishedJobVerifications(input:{publishedJobs:readonly NovoPublishedVerificationJob[];selectedSourceResult:{id:string;completenessCertificate:unknown};jobs:readonly {id:string;dedupeKey:string;officialUrl:string;sourceId:string;companyId:string;locationRaw:string}[];artifacts:readonly NovoClosureArtifact[]}):NovoVerificationTarget[]{
 const delta=isJobProjectionDeltaReceipt(input.selectedSourceResult.completenessCertificate)?parseJobProjectionDeltaReceipt(input.selectedSourceResult.completenessCertificate):undefined;
 const seen=new Set<string>();
 return input.publishedJobs.filter(j=>j.sourceId===NOVO_CLOSURE_SOURCE).map(j=>{
  if(j.companyId!==NOVO_CLOSURE_COMPANY||j.sourceResultId!==input.selectedSourceResult.id||seen.has(j.id))throw Error("NOVO_JOB_VERIFICATION_PUBLIC_IDENTITY");seen.add(j.id);
  const rows=input.jobs.filter(row=>row.id===j.id&&row.sourceId===j.sourceId&&row.companyId===j.companyId&&row.officialUrl===j.officialUrl);
  if(rows.length!==1)throw Error("NOVO_JOB_VERIFICATION_JOB_BINDING");
  const row=rows[0]!,nativeId=/^https:\/\/www\.novonordisk\.com\.cn\/content\/nncorp\/cn\/zh_cn\/careers\/find-a-job\/job-ad\.(\d+\.en_GB)\.html$/.exec(j.officialUrl)?.[1];
  if(!nativeId)throw Error("NOVO_JOB_VERIFICATION_OFFICIAL_ID");
  const members=delta?.members.filter(m=>m.setKind==='VISIBLE'&&m.jobKey===row.dedupeKey);
  if(delta&&members?.length!==1)throw Error("NOVO_JOB_VERIFICATION_VISIBLE_MEMBER");
  const previousSourceResultId=members?.[0]?.lastPresentResultId??input.selectedSourceResult.id;
  const prior=input.artifacts.filter(a=>a.sourceId===NOVO_CLOSURE_SOURCE&&a.sourceResultId===previousSourceResultId&&a.kind==='OFFICIAL_COMPANY_PAGE'&&a.httpStatus===200&&a.extractorLocator===`novo-application-${nativeId}`);
  if(prior.length!==1||!prior[0]!.finalUrl||!/^https:\/\/careers\.novonordisk\.com\/job\/[^/?#]+\/\d+\/$/.test(prior[0]!.finalUrl))throw Error("NOVO_JOB_VERIFICATION_NATIVE_BINDING");
  return {identity:{nativeId,jobId:j.id,jobKey:row.dedupeKey,officialUrl:j.officialUrl,previousSourceResultId,previousApplicationArtifactId:prior[0]!.id},nativeUrl:prior[0]!.finalUrl,nativeCity:row.locationRaw.split(", ").at(-1)??""};
 });
}
/** One original native GET; caller saves the returned exact raw locally. No login or application submission.
 * ACTIVE is native application diagnostics only; it grants no JD or whole-source publication authority. */
export async function captureNovoPublishedJobVerification(target:NovoVerificationTarget,fetchImpl:typeof fetch=fetch):Promise<{status:"CLOSED"|"ACTIVE"|"UNKNOWN";target:NovoVerificationTarget;raw?:NovoClosureRaw;reason?:string}>{
 try {
  const startedAt=new Date().toISOString(),response=await fetchImpl(target.nativeUrl,{method:"GET",redirect:"follow",signal:AbortSignal.timeout(30000)}),body=await response.text();
  const raw:NovoClosureRaw={requestedUrl:target.nativeUrl,finalUrl:response.url,httpStatus:response.status,contentType:response.headers.get('content-type')??'',startedAt,capturedAt:new Date().toISOString(),body,bodySha256:createHash('sha256').update(body,'utf8').digest('hex')};
  if(response.status!==200||raw.finalUrl!==raw.requestedUrl||!/^text\/html\b/i.test(raw.contentType))return {status:"UNKNOWN",target,raw,reason:"NATIVE_HTTP_OR_URL_MISMATCH"};
  const status=novoApplicationStatus(body,raw.finalUrl,target.nativeCity)?.status;
  if(!status)return {status:"UNKNOWN",target,raw,reason:"NATIVE_STATE_UNKNOWN"};
  if(status==="CLOSED")buildNovoSingleClosureDetails(raw,target.identity);
  return {status,target,raw};
 } catch(error){return {status:"UNKNOWN",target,reason:error instanceof Error?error.message:"NATIVE_GET_FAILED"};}
}

import {verifyNovoSingleClosure,type NovoClosureRecord} from "../domain/novoSingleJobClosure";
/** Read-only reconciliation after a connector acknowledgement, including an uncertain one.
 * UNKNOWN or absent records never authorize a blind write retry. */
export function inspectNovoJobVerificationReadback(input:{batches:any[];results:any[];losses:any[];artifacts:NovoClosureArtifact[]},expected:readonly {batchId:string;capture:NovoVerificationCapture}[],now:Date):{outcome:"COMMITTED_EXACT"|"UNKNOWN";verifiedClosedCount:number}{
 try {
  if(![input.batches,input.results,input.losses,input.artifacts].every(Array.isArray))throw Error('NOVO_READBACK_SHAPE');
  if(input.batches.length===0&&input.results.length===0&&input.losses.length===0)return {outcome:"UNKNOWN",verifiedClosedCount:0};
  if(input.batches.length!==expected.length||input.results.length!==expected.length||input.losses.length!==expected.length)throw Error('NOVO_READBACK_CARDINALITY');
  for(const item of expected){
   const batch=input.batches.find(b=>b.id===item.batchId),r=input.results.find(r=>r.batchId===item.batchId),loss=input.losses.find(l=>l.sourceResultId===r?.id);
   if(!batch||!r||!loss||r.id!==item.capture.artifact.sourceResultId||r.releaseCandidateId!==item.capture.artifact.releaseCandidateId)throw Error('NOVO_READBACK_IDENTITY');
   const d=verifyNovoSingleClosure({...loss,sourceResult:{...r,batch}} as NovoClosureRecord,input.artifacts,now),wanted=buildNovoSingleClosureDetails(item.capture.raw,item.capture.identity);
   if(Object.keys(wanted).some(k=>JSON.stringify(d[k as keyof typeof d])!==JSON.stringify(wanted[k as keyof typeof wanted]))||!input.artifacts.some(a=>a.id===item.capture.artifact.id))throw Error('NOVO_READBACK_PROOF');
  }
  return {outcome:"COMMITTED_EXACT",verifiedClosedCount:expected.length};
 } catch{return {outcome:"UNKNOWN",verifiedClosedCount:0};}
}
