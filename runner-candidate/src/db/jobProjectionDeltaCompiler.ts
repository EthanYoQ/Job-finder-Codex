import { createHash } from "node:crypto";
import type { IngestionCommand } from "../crawler/ingestion";
import {
  JOB_PROJECTION_DELTA_SCHEMA, JOB_PERSISTED_PROJECTION_SCHEMA,
  hashDeltaManifest, hashJobPersistedProjection, hashProjectionJson,
  isJobProjectionDeltaReceipt, parseJobProjectionDeltaReceipt, sortJobProjectionMembers,
  type JobProjectionDeltaReceipt, type JobProjectionMember
} from "../domain/jobProjectionDeltaReceipt";

interface SourceTuple {id:string; releaseCandidateId:string; batchId:string; sourceId:string;
  finishedAt:Date|null; completenessCertificate:unknown; completenessCertificateSha256:string|null}
function iso(value:unknown):string {
  if(value instanceof Date && Number.isFinite(value.getTime()))return value.toISOString();
  if(typeof value === "string") {const date=new Date(value.endsWith("Z")||/[+-]\d\d:\d\d$/.test(value)?value:value+"Z");if(Number.isFinite(date.getTime()))return date.toISOString();}
  throw Error("JOB_DELTA_ORIGINAL_OBSERVATION_REQUIRED");
}
/** Builds a new observation commitment only after the original full write plan
 * has passed its attestation/certificate/count/lifecycle validation. This does
 * not grant authority and does not drop any full-set evidence members. */
export function buildJobProjectionDeltaReceipt(input:{sourceResult:SourceTuple;
  commands:readonly IngestionCommand[]; previousAccepted:Record<string,unknown>|null;
  projectionForCommand:(command:Extract<IngestionCommand,{type:"UPSERT_JOB"}>)=>Record<string,unknown>
}):{receipt:JobProjectionDeltaReceipt;sha256:string} {
  const source=input.sourceResult;
  if(!source.finishedAt||!source.completenessCertificate||!source.completenessCertificateSha256)throw Error("JOB_DELTA_VERIFIED_CERTIFICATE_REQUIRED");
  const observation=input.commands.filter((c):c is Extract<IngestionCommand,{type:"UPSERT_CRAWL_OBSERVATION"}>=>c.type==="UPSERT_CRAWL_OBSERVATION");
  if(observation.length!==1)throw Error("JOB_DELTA_SINGLE_OBSERVATION_REQUIRED");
  const binding={releaseCandidateId:source.releaseCandidateId,batchId:source.batchId,sourceId:source.sourceId,sourceResultId:source.id};
  const verifiedAt=source.finishedAt.toISOString(),observedAt=iso(observation[0]!.observation.crawledAt);
  const prior=input.previousAccepted;
  const previousReceipt=prior&&isJobProjectionDeltaReceipt(prior.completenessCertificate)
    ?parseJobProjectionDeltaReceipt(prior.completenessCertificate,String(prior.completenessCertificateSha256)):null;
  const members:JobProjectionMember[]=[];
  for(const command of input.commands){
    if(command.type!=="UPSERT_JOB"||command.lifecycleStatus!=="ACTIVE")continue;
    const missingCount=command.missingSuccessfulCrawlCount;
    if(missingCount!==0&&missingCount!==1)throw Error("JOB_DELTA_ACTIVE_MISSING_COUNT");
    let lastConfirmedObservedAt=observedAt,lastPresentResultId=source.id;
    const lifecycleLastSeenAt=iso(command.lastSeenAt);
    if(missingCount===1){
      const previous=previousReceipt?.members.find(m=>m.jobKey===command.dedupeKey&&(m.setKind==="CURRENT"||m.setKind==="GRACE"));
      if(previous){lastConfirmedObservedAt=previous.lastConfirmedObservedAt;lastPresentResultId=previous.lastPresentResultId;
        if(lifecycleLastSeenAt!==previous.lifecycleLastSeenAt)throw Error("JOB_DELTA_GRACE_LIFECYCLE_ANCHOR");
      }else{
        if(!prior||prior.sourceId!==source.sourceId||iso(prior.finishedAt)!==lifecycleLastSeenAt||!Array.isArray(prior.observations)||prior.observations.length!==1)throw Error("JOB_DELTA_LEGACY_CURRENT_OBSERVATION_REQUIRED");
        const old=prior.observations[0] as Record<string,unknown>;
        if(old.sourceResultId!==prior.id||old.sourceId!==source.sourceId||old.batchId!==prior.batchId||old.releaseCandidateId!==prior.releaseCandidateId)throw Error("JOB_DELTA_LEGACY_OBSERVATION_TUPLE");
        lastConfirmedObservedAt=iso(old.crawledAt);lastPresentResultId=String(prior.id);
      }
    }
    const common={...binding,jobKey:command.dedupeKey,
      jobKeySha256:createHash("sha256").update(command.dedupeKey).digest("hex"),
      lifecycleStatus:"ACTIVE" as const,missingCount:missingCount as 0|1,
      jobProjectionSha256:hashJobPersistedProjection(input.projectionForCommand(command)),
      lastConfirmedObservedAt,lifecycleLastSeenAt,lastPresentResultId};
    members.push({...common,setKind:missingCount===0?"CURRENT":"GRACE"},{...common,setKind:"VISIBLE"});
  }
  const sorted=sortJobProjectionMembers(members);
  const receipt=parseJobProjectionDeltaReceipt({schemaVersion:JOB_PROJECTION_DELTA_SCHEMA,
    projectionSchemaVersion:JOB_PERSISTED_PROJECTION_SCHEMA,binding,verifiedAt,observedAt,
    legacyCertificate:source.completenessCertificate,legacyCertificateSha256:source.completenessCertificateSha256,
    detailEvidenceState:"UNKNOWN",members:sorted,manifestSha256:hashDeltaManifest(sorted)});
  return {receipt,sha256:hashProjectionJson(receipt)};
}

/** Legacy readers intentionally see an unknown certificate schema and HOLD.
 * Internal baseline builders unwrap only after outer hash/tuple checks. */
export function unwrapJobProjectionSourceRow<T extends Record<string,unknown>>(row:T):T{
  if(!isJobProjectionDeltaReceipt(row.completenessCertificate))return row;
  const receipt=parseJobProjectionDeltaReceipt(row.completenessCertificate,String(row.completenessCertificateSha256));
  if(hashProjectionJson(receipt.legacyCertificate)!==receipt.legacyCertificateSha256)throw Error("JOB_DELTA_LEGACY_CERTIFICATE_HASH_MISMATCH");
  for(const [field,key] of [["id","sourceResultId"],["releaseCandidateId","releaseCandidateId"],["batchId","batchId"],["sourceId","sourceId"]] as const)
    if(row[field]!==receipt.binding[key])throw Error("JOB_DELTA_BASELINE_TUPLE_MISMATCH");
  if(iso(row.finishedAt)!==receipt.verifiedAt)throw Error("JOB_DELTA_BASELINE_TIME_MISMATCH");
  return {...row,completenessCertificate:receipt.legacyCertificate,completenessCertificateSha256:receipt.legacyCertificateSha256};
}

/** Physical context remains untouched for SQL CAS. Only the private lifecycle
 * projection receives the original acknowledged last-seen value. */
export function restoreJobProjectionLifecycleContext(jobs:readonly Record<string,unknown>[],accepted:Record<string,unknown>|null):Record<string,unknown>[] {
  if(!accepted||!isJobProjectionDeltaReceipt(accepted.completenessCertificate))return jobs.map(job=>({...job}));
  const receipt=parseJobProjectionDeltaReceipt(accepted.completenessCertificate,String(accepted.completenessCertificateSha256));
  unwrapJobProjectionSourceRow(accepted);
  return jobs.map(job=>{
    const member=receipt.members.find(m=>m.jobKey===job.dedupeKey&&m.setKind==="VISIBLE");
    if(!member)return {...job};
    if(hashJobPersistedProjection(job)!==member.jobProjectionSha256)throw Error("JOB_DELTA_BASELINE_JOB_PROJECTION_DRIFT");
    return {...job,lastSeenAt:member.lifecycleLastSeenAt};
  });
}
