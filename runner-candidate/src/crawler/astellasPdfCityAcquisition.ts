import { isDeepStrictEqual } from "node:util";
import { ASTELLAS_PDF_CITY_CONFIG, astellasPdfCityEnvelopeSchema } from "./astellasPdfCityContract";
import { assertAstellasPdfArtifact, inspectAstellasPdfRuntime, ASTELLAS_PDF_LIMITS, extractAstellasPdfLocationEvidence, fetchAstellasPdfLocation, type AstellasPdfLocationEvidence } from "./astellasPdfLocations";
import {readField} from './adapters/htmlTable';
import {load} from 'cheerio';
import {selectHtmlTableRows} from './htmlTableRows';
import {reviewHtmlJobRows} from './htmlJobQuarantine';
import {quarantineCompleteList,restoreQuarantinedList,JOB_QUARANTINE_PAGINATION,type JobQuarantine} from './jobQuarantine';
import {evaluatePaginationEvidence} from './paginationEvidence';
import { validateStrictHtmlCompletenessProof } from "./strictHtmlCompletenessProof";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import { parsePersistentSourceFetchEvidence, type PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import type { SourceFetchResult } from "./runSourceCrawl";
import type { NormalizedJobRecord } from "./normalizedJob";

export function hasAstellasPdfCityPlan(plan: SourceCrawlPlan): boolean {
  return plan.source.id === "source-astellas-china-social" && plan.company.id === "company-astellas-china" &&
    plan.adapterId === "html-table" && isDeepStrictEqual(plan.table.astellasPdfLocations, ASTELLAS_PDF_CITY_CONFIG);
}
function listJobs(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence, capturedAt: string, isBaseline: boolean) {
  if (!hasAstellasPdfCityPlan(plan) || plan.adapterId !== "html-table" || !validateStrictHtmlCompletenessProof(plan,evidence)) throw Error("ASTELLAS_LIST_PROOF_INVALID");
  const artifact=evidence.artifacts[0]!;
  if (typeof artifact.body!=="string") throw Error("ASTELLAS_LIST_BODY_INVALID");
  const reviewed=reviewHtmlJobRows(plan,evidence,capturedAt,isBaseline),jobs=reviewed.jobs;
  if(jobs.length+reviewed.quarantines.length!==evidence.fetchCounts.rawCount||evidence.fetchCounts.rawCount>ASTELLAS_PDF_CITY_CONFIG.maxDocuments||
    jobs.some(j=>!j.sourceJobId)||new Set(jobs.map(j=>j.officialUrl)).size!==jobs.length)throw Error('ASTELLAS_LIST_IDENTITY_INVALID');
  return jobs;
}
/** Called only by the ordinary owned route, without injected transport. Every URL
 * comes from this acquisition's verified HTML. Sequential parsing caps subprocess
 * concurrency and the retained evidence budget; failures keep their list rows. */
export async function acquireAstellasPdfCities(plan: SourceCrawlPlan, fetched: SourceFetchResult): Promise<SourceFetchResult> {
  if(!hasAstellasPdfCityPlan(plan)||!fetched.ok)return fetched;
  if(!('html' in fetched)||!fetched.fetchEvidence)throw Error("ASTELLAS_LIST_EVIDENCE_REQUIRED");
  const list=parsePersistentSourceFetchEvidence(fetched.fetchEvidence);
  const jobs=listJobs(plan,list,fetched.capturedAt,true);
  const entries: NonNullable<PersistentSourceFetchEvidence['astellasPdfLocations']>['entries']=[];
  const artifacts=[...list.artifacts];let retained=0;
  const runtimeCapability=await inspectAstellasPdfRuntime();
  for(const job of jobs){
    if(!runtimeCapability.available){
      entries.push({sourceJobId:job.sourceJobId!,officialUrl:job.officialUrl,outcome:{ok:false,code:"PDF_RUNTIME_UNAVAILABLE"}});
      continue;
    }
    if(retained > ASTELLAS_PDF_CITY_CONFIG.maxRetainedBytes - ASTELLAS_PDF_LIMITS.maxBytes){
      entries.push({sourceJobId:job.sourceJobId!,officialUrl:job.officialUrl,outcome:{ok:false,code:"PDF_RETAINED_BUDGET_EXCEEDED"}});
      continue;
    }
    const captured=await fetchAstellasPdfLocation(job.officialUrl);
    const artifact=captured.artifact;
    if(artifact){
      retained+=artifact.body.length;
      if(retained>ASTELLAS_PDF_CITY_CONFIG.maxRetainedBytes)throw Error("ASTELLAS_RETAINED_BUDGET_EXCEEDED");
      artifacts.push(artifact);
    }
    entries.push({sourceJobId:job.sourceJobId!,officialUrl:job.officialUrl,...(artifact?{artifactLogicalKey:artifact.logicalKey}:{}),
      outcome:captured.ok?{ok:true,evidence:captured.evidence}:{ok:false,code:captured.code}});
  }
  const evidence=parsePersistentSourceFetchEvidence({...list,artifacts,astellasPdfLocations:{
    schemaVersion:"astellas-owned-pdf-cities-v1",runtimeCapability,sourceConfigSha256:sourcePlanConfigSha256(plan),listArtifactLogicalKey:list.artifacts[0]!.logicalKey,entries}});
  const replay=await replayAstellasPdfCities(plan,evidence,fetched.capturedAt,true);
  const fetchEvidence={...replay.listEvidence,artifacts,astellasPdfLocations:evidence.astellasPdfLocations!};
  return {...fetched,fetchEvidence,paginationEvaluation:evaluatePaginationEvidence({evidence:fetchEvidence,expectedChannelIds:[],filteredOutput:true,allowMissingReturnedPage:true,...JOB_QUARANTINE_PAGINATION})};
}

/** Fully validates the explicit envelope before exposing its one-list projection.
 * Generic HTML replay remains unchanged and rejects the multi-artifact envelope.
 * No caller-provided city map, success boolean or text artifact grants authority. */
export async function replayAstellasPdfCities(plan: SourceCrawlPlan, supplied: PersistentSourceFetchEvidence,
  capturedAt: string, isBaseline: boolean):Promise<{listEvidence:PersistentSourceFetchEvidence;jobs:NormalizedJobRecord[]}> {
  if(!hasAstellasPdfCityPlan(plan)||plan.adapterId!=='html-table')throw Error("ASTELLAS_PDF_PLAN_INVALID");
  const evidence=parsePersistentSourceFetchEvidence(structuredClone(supplied));
  const envelope=astellasPdfCityEnvelopeSchema.parse(evidence.astellasPdfLocations);
  if(envelope.sourceConfigSha256!==sourcePlanConfigSha256(plan))throw Error("ASTELLAS_PDF_CONFIG_INVALID");
  const listArtifact=evidence.artifacts.find(a=>a.logicalKey===envelope.listArtifactLogicalKey);
  if(!listArtifact||typeof listArtifact.body!=="string")throw Error("ASTELLAS_LIST_ARTIFACT_INVALID");
  const {astellasPdfLocations:_envelope,...base}=evidence;
  const rawList=restoreQuarantinedList(parsePersistentSourceFetchEvidence({...base,artifacts:[listArtifact]}));
  const listReview=reviewHtmlJobRows(plan,rawList,capturedAt,isBaseline);
  const listEvidence=quarantineCompleteList(rawList,listReview.quarantines);
  const jobs=listJobs(plan,listEvidence,capturedAt,isBaseline);
  if(envelope.entries.length!==jobs.length)throw Error("ASTELLAS_PDF_ROW_COUNT_INVALID");
  const expectedKeys=[envelope.listArtifactLogicalKey,...envelope.entries.flatMap(e=>e.artifactLogicalKey?[e.artifactLogicalKey]:[])];
  if(new Set(expectedKeys).size!==expectedKeys.length||expectedKeys.length!==evidence.artifacts.length||
    evidence.artifacts.some(a=>!expectedKeys.includes(a.logicalKey)))throw Error("ASTELLAS_PDF_ARTIFACT_SET_INVALID");
  const runtimeAvailable=envelope.runtimeCapability.available;
  if(runtimeAvailable){
    const actual=await inspectAstellasPdfRuntime();
    if(!actual.available||!isDeepStrictEqual(actual,envelope.runtimeCapability))throw Error("ASTELLAS_PDF_RUNTIME_UNAVAILABLE");
  } else if(envelope.entries.some(e=>e.artifactLogicalKey||e.outcome.ok||e.outcome.code!=="PDF_RUNTIME_UNAVAILABLE"))throw Error("ASTELLAS_PDF_RUNTIME_OUTCOME_INVALID");
  let retained=0;const quarantines:JobQuarantine[]=[],accepted:NormalizedJobRecord[]=[];
  const $=load(listArtifact.body),rawRows=selectHtmlTableRows($,plan.table);
  for(let i=0;i<jobs.length;i++){
    const job=jobs[i]!,entry=envelope.entries[i]!;
    if(entry.sourceJobId!==job.sourceJobId||entry.officialUrl!==job.officialUrl)throw Error("ASTELLAS_PDF_ROW_BINDING_INVALID");
    if(runtimeAvailable&&!entry.outcome.ok&&entry.outcome.code==="PDF_RUNTIME_UNAVAILABLE")throw Error("ASTELLAS_PDF_RUNTIME_OUTCOME_INVALID");
    const artifact=entry.artifactLogicalKey?evidence.artifacts.find(a=>a.logicalKey===entry.artifactLogicalKey):undefined;
    let claim:AstellasPdfLocationEvidence|undefined;
    if(artifact){
      retained+=artifact.body.length;
      if(!(artifact.body instanceof Uint8Array)||retained>ASTELLAS_PDF_CITY_CONFIG.maxRetainedBytes||artifact.requestedUrl!==job.officialUrl||
        artifact.finalUrl!==job.officialUrl||artifact.bodyRepresentation!=="EXACT"||artifact.rawBodySha256||artifact.redactionDescriptors)throw Error("ASTELLAS_PDF_BINARY_BINDING_INVALID");
      assertAstellasPdfArtifact(artifact);
      try{claim=await extractAstellasPdfLocationEvidence(artifact);}catch{if(entry.outcome.ok||entry.outcome.code!=="PDF_PARSER_FAILED")throw Error("ASTELLAS_PDF_REPLAY_FAILED");}
    }
    if(entry.outcome.ok){if(!artifact||!claim||!isDeepStrictEqual(claim,entry.outcome.evidence))throw Error("ASTELLAS_PDF_CLAIM_INVALID");}
    else if(artifact?(entry.outcome.code!=="PDF_PARSER_FAILED"||claim!==undefined):entry.outcome.code==="PDF_PARSER_FAILED")throw Error("ASTELLAS_PDF_FAILURE_INVALID");
    const result=claim?.result;
    const status=result?.status??"UNRESOLVED";
    // Country metadata is intentionally nonempty for the existing storage model.
    // The public matcher does not interpret 中国 as a city or nationwide wildcard.
    if(status==="CITY_SPECIFIC"){
      job.cities=[...result!.cities];job.locationRaw=result!.fields[0]!.rawValue.trim();
    }
    if(status!=='CITY_SPECIFIC'&&status!=='COUNTRY_ONLY'){
      const recordIndex=rawRows.findIndex(row=>readField($,row,plan.table.fields.sourceJobId!)===job.sourceJobId);
      if(recordIndex<0)throw Error('ASTELLAS_PDF_LIST_POSITION_INVALID');
      quarantines.push({sourceJobId:job.sourceJobId!,officialUrl:job.officialUrl,pageSequence:0,recordIndex,validJobId:listEvidence.pages[0]!.rawJobIds[recordIndex]!,rawLocator:`${listEvidence.pages[0]!.artifactLogicalKey}#row:${recordIndex}`,code:'ASTELLAS_PDF_UNVERIFIED'});continue;
    }
    job.evidence.astellasPdfLocation={...(status==="CITY_SPECIFIC"||status==="COUNTRY_ONLY"?{country:"中国" as const}:{sourceCountryContext:"中国" as const}),status,...(artifact?{artifactLogicalKey:artifact.logicalKey}:{}),
      ...(claim?{pdfSha256:claim.pdfSha256}:{})};
    accepted.push(job);
  }
  const isolated=quarantineCompleteList(listEvidence,quarantines);
  if(evidence.jobQuarantines?.some(q=>q.code==='ASTELLAS_PDF_UNVERIFIED')&&!isDeepStrictEqual(evidence.jobQuarantines,isolated.jobQuarantines))throw Error('ASTELLAS_PDF_QUARANTINE_INVALID');
  return {listEvidence:isolated,jobs:accepted};
}
